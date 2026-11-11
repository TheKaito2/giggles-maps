-- Bookings and visit billing (docs/UPDATE-PLAN.md section 3, bugs 1-3).
-- 1. record_checkin bills a verified visit when the place's shop has a live paid tier, at the v6 price (฿25), instead of
--    needing places.is_partner and bid_thb (only the seeded example partners had them, so real shops were never billed).
--    The body is otherwise the live one from 20261030000092_critic_r3.sql (unchanged since); create or replace keeps its grants.
-- 2. Only record_checkin_v5 completes bookings, and it is the only check-in path (verify-checkin calls it; clients can't call
--    either function): no change needed.
-- 3. Unanswered and no-show bookings close by themselves (expire_bookings, hourly).

-- the price of one verified visit (prices v6), in one place for record_checkin and the shop pages
create or replace function public.visit_fee_thb() returns numeric language sql immutable set search_path = '' as $$ select 25::numeric $$;
grant execute on function public.visit_fee_thb() to anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.record_checkin(p_user uuid, p_place bigint, p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text, p_face_count integer, p_qr text DEFAULT NULL::text, p_client jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_place public.places;
  v_shop public.shops;
  v_here extensions.geography := extensions.st_point(p_lng, p_lat)::extensions.geography;
  v_dist float8;
  v_radius int;
  v_reasons text[] := '{}';
  v_status text;
  v_last record;
  v_kmh float8;
  v_rewarded boolean := false;
  v_checkin uuid;
  v_qr_ok boolean := false;
  v_billed numeric := 0;
  v_billing text := 'not_partner';
  v_badges jsonb := '[]';
  v_spin jsonb := null;
  v_total int;
  v_roll float8;
  v_coupon record;
  v_code text;
  v_demo boolean := coalesce((p_client->>'demo')::boolean, false);
  c record;
begin
  perform 1 from public.profiles where id = p_user for update;   -- one check-in at a time per traveller: parallel ones can't all be first visits
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;

  v_dist := extensions.st_distance(v_place.location, v_here);
  -- the GPS stop zone: big grounds (landmarks, parks) 150 m, everything else 50 m. Any photo; no face check.
  v_radius := 50;
  if v_place.tier >= 3 or v_place.category = 'park' then v_radius := 150; end if;
  if v_dist > v_radius then v_reasons := array_append(v_reasons, 'too_far'); end if;
  if p_selfie_path is null or p_selfie_path not like p_user::text || '/%' then v_reasons := array_append(v_reasons, 'no_selfie'); end if;
  if coalesce((p_client->>'is_mock')::boolean, false) then v_reasons := array_append(v_reasons, 'mock_location'); end if;

  select location, created_at into v_last from public.checkins
   where user_id = p_user and status <> 'rejected' and created_at > now() - interval '24 hours'
     and not coalesce((client->>'demo')::boolean, false)   -- a demo teleport isn't where you really were
   order by created_at desc limit 1;
  if found then
    v_kmh := extensions.st_distance(v_last.location, v_here) / 1000.0
             / greatest(extract(epoch from now() - v_last.created_at) / 3600.0, 1.0 / 3600);
    -- demo mode teleports on purpose (tap the map, fast-forward to a stop): no speed check for it
    if v_kmh > 150 and not v_demo then v_reasons := array_append(v_reasons, 'speed_jump'); end if;
  end if;

  v_status := case
    when v_reasons && array['too_far','no_selfie','mock_location','speed_jump'] then 'rejected'
    when p_accuracy > 75 then 'review'
    else 'approved' end;
  if p_accuracy > 75 then v_reasons := array_append(v_reasons, 'low_accuracy'); end if;

  if v_status = 'approved' then
    -- rewards (and the stamp) only on the first visit; later visits add photos to the passport
    -- a real check-in ignores demo ones here and in the pace limits: a demo visit must not use up the real stamp
    v_rewarded := not exists (select 1 from public.checkins where user_id = p_user and place_id = p_place and rewarded
                                and (v_demo or not coalesce((client->>'demo')::boolean, false)));
    if not v_rewarded then v_reasons := array_append(v_reasons, 'already_stamped'); end if;
    -- pace: at most 12 stamps an hour and 60 a day, 30 s apart. Faster than anyone visits places, so the photo
    -- is kept and the stamp waits (the place can be stamped on a later visit). Nothing else is checked or stored.
    if v_rewarded and (
         exists (select 1 from public.checkins where user_id = p_user and rewarded and created_at > now() - interval '30 seconds' and (v_demo or not coalesce((client->>'demo')::boolean, false)))
      or (select count(*) from public.checkins where user_id = p_user and rewarded and created_at > now() - interval '1 hour' and (v_demo or not coalesce((client->>'demo')::boolean, false))) >= 12
      or (select count(*) from public.checkins where user_id = p_user and rewarded and created_at > now() - interval '24 hours' and (v_demo or not coalesce((client->>'demo')::boolean, false))) >= 60) then
      v_rewarded := false;
      v_reasons := array_append(v_reasons, 'slow_down');
    end if;
  end if;

  -- counter QR: proves the visitor was inside (shown to the shop as "last scan"; no effect on routing)
  v_qr_ok := v_place.qr_code is not null and upper(trim(coalesce(p_qr, ''))) = v_place.qr_code
             and not coalesce((select u.is_anonymous from auth.users u where u.id = p_user), false);   -- guests never bill a shop
  if v_qr_ok and v_status <> 'rejected' then
    update public.places set last_qr_scan_at = now() where id = p_place;
  end if;

  insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, selfie_path,
                               face_count, client, status, reasons, rewarded)
  values (p_user, p_place, v_here, p_accuracy, v_dist, p_selfie_path, p_face_count,
          p_client || jsonb_build_object('qr_ok', v_qr_ok), v_status, v_reasons, v_rewarded)
  returning id into v_checkin;

  -- attribution + billing (tourist-triggered; the shop can't block it). Prices v6: a shop with a live paid tier (Partner or
  -- Giggles Choice: the same rule as places_tiers) pays ฿25 per verified visit. It used to need places.is_partner and
  -- places.bid_thb, which only the seeded example partners had, so no real shop was ever billed. A stay (hotel, homestay)
  -- pays 10% of the booked stay instead, never per visit; an example shop (shops.is_demo) never pays.
  if v_place.shop_id is not null and v_place.category <> 'stay' and exists (select 1 from public.places_tiers(array[p_place])) then
    select * into v_shop from public.shops where id = v_place.shop_id for update;
    v_billing := case
      when v_demo or v_shop.is_demo then 'demo'   -- demo mode's location is faked: never charges a shop
      when not v_rewarded then 'not_rewarded'
      when not v_qr_ok then 'no_qr'
      when not exists (select 1 from public.route_stops rs
                        where rs.user_id = p_user and rs.place_id = p_place
                          and rs.shown_at > now() - interval '3 hours') then 'not_shown_on_route'
      when exists (select 1 from public.billable_visits bv
                    where bv.user_id = p_user and bv.shop_id = v_shop.id
                      and bv.created_at > now() - interval '30 days') then 'repeat_visit_30d'
      when v_shop.wallet_thb < public.visit_fee_thb() then 'wallet_empty'
      else 'charged' end;
    if v_billing = 'charged' then
      v_billed := public.visit_fee_thb();
      update public.shops set wallet_thb = wallet_thb - v_billed where id = v_shop.id;
      insert into public.billable_visits (checkin_id, place_id, shop_id, user_id, amount_thb)
      values (v_checkin, p_place, v_shop.id, p_user, v_billed);
    end if;
  end if;

  if v_rewarded then
    -- badges
    for c in
      select col.id, col.slug, col.name from public.collections col
      join public.collection_places cp on cp.collection_id = col.id and cp.place_id = p_place
      where not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.collection_id = col.id)
        and (select count(distinct ch.place_id) from public.checkins ch
              join public.collection_places cp2 on cp2.place_id = ch.place_id and cp2.collection_id = col.id
             where ch.user_id = p_user and ch.rewarded) >= col.required_count
    loop
      insert into public.user_badges (user_id, collection_id) values (p_user, c.id);
      v_badges := v_badges || jsonb_build_object('slug', c.slug, 'name', c.name);
    end loop;

    -- free coupon spin: active coupons from signed-up shops with credit, within 3 km, one win per coupon per 30 days.
    -- "No prize" carries the same total weight as all prizes, so the overall win chance is 50%.
    select coalesce(sum(cp.weight), 0) into v_total
      from public.coupons cp join public.places pl on pl.id = cp.place_id join public.shops s on s.id = cp.shop_id
     where cp.active and public.shop_funded(s, pl.bid_thb) and not s.is_demo   -- never an example shop's coupon
       and extensions.st_dwithin(pl.location, v_here, 3000)
       and not exists (select 1 from public.coupon_wins w where w.coupon_id = cp.id and w.user_id = p_user
                         and w.created_at > now() - interval '30 days');
    if v_total > 0 and not v_demo then   -- coupons are paid for by real shops: no spin in demo mode
      v_roll := random() * (v_total * 2);
      if v_roll < v_total then
        for v_coupon in
          select cp.id, cp.title, cp.weight, pl.name as place_name
            from public.coupons cp join public.places pl on pl.id = cp.place_id join public.shops s on s.id = cp.shop_id
           where cp.active and public.shop_funded(s, pl.bid_thb) and not s.is_demo   -- never an example shop's coupon
             and extensions.st_dwithin(pl.location, v_here, 3000)
             and not exists (select 1 from public.coupon_wins w where w.coupon_id = cp.id and w.user_id = p_user
                               and w.created_at > now() - interval '30 days')
           order by cp.id
        loop
          v_roll := v_roll - v_coupon.weight;
          if v_roll < 0 then
            v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
            insert into public.coupon_wins (user_id, coupon_id, checkin_id, code) values (p_user, v_coupon.id, v_checkin, v_code);
            v_spin := jsonb_build_object('won', true, 'title', v_coupon.title, 'place', v_coupon.place_name, 'code', v_code,
                                         'odds', round(v_coupon.weight::numeric / (v_total * 2), 3));
            exit;
          end if;
        end loop;
      else
        v_spin := jsonb_build_object('won', false, 'odds', 0.5);
      end if;
    end if;
  end if;

  return jsonb_build_object('checkin_id', v_checkin, 'status', v_status, 'reasons', v_reasons,
                            'rewarded', v_rewarded, 'billed_thb', v_billed, 'billing', v_billing,
                            'qr_ok', v_qr_ok, 'distance_m', round(v_dist::numeric, 1),
                            'new_badges', v_badges, 'spin', v_spin);
end;
$function$
;

-- Bookings: the fee follows prices v6 (฿25 once the guest checks in; stays get their 10% with booking kinds), and open
-- bookings no longer stay open forever (they counted toward a guest's limit of 5 and sat on the shop's list):
--   requested, never answered -> expired when the booked day starts
--   accepted, nobody checked in -> no_show once the check-in window (the day before to the day after) has passed, free
alter table public.bookings alter column fee_thb set default 25;
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('requested', 'accepted', 'declined', 'completed', 'cancelled', 'expired', 'no_show'));

create or replace function public.expire_bookings() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Bangkok')::date; v_n int; v_m int;
begin
  update public.bookings set status = 'expired', answered_at = now() where status = 'requested' and day <= v_today;
  get diagnostics v_n = row_count;
  update public.bookings set status = 'no_show', charged_thb = 0 where status = 'accepted' and day < v_today - 1;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke execute on function public.expire_bookings() from public, anon, authenticated;
select cron.schedule('expire-bookings', '5 * * * *', $$select public.expire_bookings()$$);
