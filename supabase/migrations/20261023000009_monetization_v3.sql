-- Monetization v3 (docs/MONETIZATION.md): no paid placement anywhere.
-- Routes and "Near this spot" cards are ranked by quality only; signing up never changes rank.
-- Shops pay only per verified visit (later also per booking). The Starter flat plan is gone.
-- No Starter shops or payments existed when this ran (checked 23 Oct 2026).

-- ---------- candidates: quality only ----------
drop function public.detour_candidates(float8, float8, float8, float8, float8, int, int);
create or replace function public.detour_candidates(
  o_lat float8, o_lng float8, d_lat float8, d_lng float8, extra_m float8, max_n int default 16)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               open_min int, close_min int, dwell_min int, rating numeric, is_partner boolean, is_demo boolean)
language sql stable security definer set search_path = ''
as $$
  with b as (
    select extensions.st_point(o_lng, o_lat)::extensions.geography o,
           extensions.st_point(d_lng, d_lat)::extensions.geography d
  )
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.open_min, p.close_min, p.dwell_min, p.rating,
         p.is_partner and p.shop_id is not null, p.is_demo
  from public.places p cross join b
  where extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
    and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
        <= extensions.st_distance(b.o, b.d) + extra_m
  order by p.rating desc,  -- ties: the smallest detour first
           extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d), p.id
  limit max_n;
$$;
grant execute on function public.detour_candidates(float8, float8, float8, float8, float8, int) to anon, authenticated;

-- ---------- "Near this spot" cards: best nearby places by quality, signed up or not ----------
drop function public.partners_near(float8, float8, float8);
drop function public.partner_live(public.places);
create or replace function public.places_near(p_lat float8, p_lng float8, p_radius_m float8, p_min_rating numeric default 4.0)
returns table (id bigint, name text, category text, lat float8, lng float8, rating numeric,
               is_partner boolean, dist_m float8, is_demo boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.is_partner and p.shop_id is not null,
         extensions.st_distance(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography), p.is_demo
  from public.places p
  where p.rating >= p_min_rating
    and extensions.st_dwithin(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography, p_radius_m)
  order by p.rating desc, 8;
$$;
grant execute on function public.places_near(float8, float8, float8, numeric) to anon, authenticated;

-- ---------- Starter plan removed ----------
create or replace function public.shop_funded(s public.shops, bid numeric) returns boolean
language sql stable set search_path = '' as $$
  select s.wallet_thb >= bid
$$;

create or replace function public.shop_overview(p_shop uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.shops; r jsonb;
begin
  select * into s from public.shops where id = p_shop;
  if not found or (s.owner_id is distinct from auth.uid() and not s.is_demo) then
    raise exception 'not your shop' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'wallet_thb', s.wallet_thb,
    'places', coalesce(jsonb_agg(jsonb_build_object(
       'id', p.id, 'name', p.name, 'bid_thb', p.bid_thb, 'qr_code', p.qr_code, 'last_qr_scan_at', p.last_qr_scan_at,
       'impressions_30d', (select count(*) from public.route_stops rs where rs.place_id = p.id and rs.shown_at > now() - interval '30 days'),
       'card_impressions_30d', (select count(*) from public.route_stops rs where rs.place_id = p.id and rs.kind = 'card' and rs.shown_at > now() - interval '30 days'),
       'visits_30d', (select count(*) from public.billable_visits bv where bv.place_id = p.id and bv.created_at > now() - interval '30 days')
     )) filter (where p.id is not null), '[]'))
  into r
  from public.places p where p.shop_id = s.id;
  return r;
end;
$$;

create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric,
                                                p_shop uuid default null, p_user uuid default null)
returns boolean
language plpgsql set search_path = ''
as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind = 'plus' then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now()) + interval '30 days' where id = p_user;
  else
    raise exception 'unknown payment kind %', p_kind;
  end if;
  return true;
exception when unique_violation then
  return false;  -- Stripe retried an event we already applied
end;
$$;

alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('credit', 'plus'));
alter table public.shops drop column plan, drop column plan_until;

-- ---------- check-in: same rules, minus the Starter plan ----------
create or replace function public.record_checkin(
  p_user uuid, p_place bigint, p_lat float8, p_lng float8, p_accuracy float8,
  p_selfie_path text, p_face_count int, p_qr text default null, p_client jsonb default '{}')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_place public.places;
  v_shop public.shops;
  v_here extensions.geography := extensions.st_point(p_lng, p_lat)::extensions.geography;
  v_dist float8;
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
  c record;
begin
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;

  v_dist := extensions.st_distance(v_place.location, v_here);
  if v_dist > 60 then v_reasons := array_append(v_reasons, 'too_far'); end if;
  if p_face_count < 1 then v_reasons := array_append(v_reasons, 'no_face'); end if;
  if p_selfie_path is null or p_selfie_path not like p_user::text || '/%' then v_reasons := array_append(v_reasons, 'no_selfie'); end if;
  if coalesce((p_client->>'is_mock')::boolean, false) then v_reasons := array_append(v_reasons, 'mock_location'); end if;

  select location, created_at into v_last from public.checkins
   where user_id = p_user and status <> 'rejected' and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if found then
    v_kmh := extensions.st_distance(v_last.location, v_here) / 1000.0
             / greatest(extract(epoch from now() - v_last.created_at) / 3600.0, 1.0 / 3600);
    if v_kmh > 150 then v_reasons := array_append(v_reasons, 'speed_jump'); end if;
  end if;

  v_status := case
    when v_reasons && array['too_far','no_face','no_selfie','mock_location','speed_jump'] then 'rejected'
    when p_accuracy > 50 then 'review'
    else 'approved' end;
  if p_accuracy > 50 then v_reasons := array_append(v_reasons, 'low_accuracy'); end if;

  if v_status = 'approved' then
    v_rewarded := not exists (
      select 1 from public.checkins
       where user_id = p_user and place_id = p_place and rewarded
         and (created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date);
    if not v_rewarded then v_reasons := array_append(v_reasons, 'already_rewarded_today'); end if;
  end if;

  -- counter QR: proves the visitor was inside (shown to the shop as "last scan"; no effect on routing)
  v_qr_ok := v_place.qr_code is not null and upper(trim(coalesce(p_qr, ''))) = v_place.qr_code;
  if v_qr_ok and v_status <> 'rejected' then
    update public.places set last_qr_scan_at = now() where id = p_place;
  end if;

  insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, selfie_path,
                               face_count, client, status, reasons, rewarded)
  values (p_user, p_place, v_here, p_accuracy, v_dist, p_selfie_path, p_face_count,
          p_client || jsonb_build_object('qr_ok', v_qr_ok), v_status, v_reasons, v_rewarded)
  returning id into v_checkin;

  -- attribution + billing (tourist-triggered; the shop can't block it)
  if v_place.is_partner and v_place.shop_id is not null then
    select * into v_shop from public.shops where id = v_place.shop_id for update;
    v_billing := case
      when not v_rewarded then 'not_rewarded'
      when not v_qr_ok then 'no_qr'
      when not exists (select 1 from public.route_stops rs
                        where rs.user_id = p_user and rs.place_id = p_place
                          and rs.shown_at > now() - interval '3 hours') then 'not_shown_on_route'
      when exists (select 1 from public.billable_visits bv
                    where bv.user_id = p_user and bv.shop_id = v_shop.id
                      and bv.created_at > now() - interval '30 days') then 'repeat_visit_30d'
      when v_shop.wallet_thb < v_place.bid_thb then 'wallet_empty'
      else 'charged' end;
    if v_billing = 'charged' then
      update public.shops set wallet_thb = wallet_thb - v_place.bid_thb where id = v_shop.id;
      v_billed := v_place.bid_thb;
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
     where cp.active and public.shop_funded(s, pl.bid_thb)
       and extensions.st_dwithin(pl.location, v_here, 3000)
       and not exists (select 1 from public.coupon_wins w where w.coupon_id = cp.id and w.user_id = p_user
                         and w.created_at > now() - interval '30 days');
    if v_total > 0 then
      v_roll := random() * (v_total * 2);
      if v_roll < v_total then
        for v_coupon in
          select cp.id, cp.title, cp.weight, pl.name as place_name
            from public.coupons cp join public.places pl on pl.id = cp.place_id join public.shops s on s.id = cp.shop_id
           where cp.active and public.shop_funded(s, pl.bid_thb)
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
$$;
revoke execute on function public.record_checkin(uuid, bigint, float8, float8, float8, text, int, text, jsonb) from public, anon, authenticated;
