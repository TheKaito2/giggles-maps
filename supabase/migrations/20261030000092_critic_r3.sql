-- Critic round 3.
-- record_checkin: takes the traveller's profile row lock first (like buy_item / shake_fortune), so parallel check-ins run
--   one at a time and the first-visit rule and pace limits see each other; the coupon spin never offers an example
--   (shops.is_demo) shop's coupon.
-- record_checkin_v5: a demo check-in's new province gives no bonus shake ticket (bonus pulls have no check-in, so the
--   real-only leaderboard couldn't subtract their XP).
-- shake_fortune: a demo check-in's shake never wins an XP boost (the boost would multiply later real stamps); it pays the
--   coins prize of that rarity instead.
-- selfie_orphans: nomination photos are purged 30 days after the nomination closes (live, rejected or expired) instead of
--   being kept forever; purge-selfies deletes what it lists.
-- Bodies are otherwise the live ones (pg_get_functiondef, 2026-10-30); create or replace keeps their grants.

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

  -- attribution + billing (tourist-triggered; the shop cant block it)
  if v_place.is_partner and v_place.shop_id is not null then
    select * into v_shop from public.shops where id = v_place.shop_id for update;
    v_billing := case
      when v_demo then 'demo'   -- demo mode's location is faked: never charges a shop
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

CREATE OR REPLACE FUNCTION public.record_checkin_v5(p_user uuid, p_place bigint, p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text, p_face_count integer, p_qr text DEFAULT NULL::text, p_client jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_place public.places;
  v_level int := public.unlock_level(p_user);
  v_result jsonb;
  v_before int;
  v_after int;
  v_member boolean;
  v_booking public.bookings;
  v_charge numeric;
  v_plus boolean;
  v_new_province boolean := false;
  v_xp int := 0;
  v_coins int := 0;
  v_event text;
  v_challenges jsonb := '[]';
  v_trip uuid;
  v_badges_before jsonb := public.achievements(p_user);
  v_badges_new jsonb := '[]';
  ch jsonb;
  v_group boolean := false;
  b record;
begin
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;
  if not public.place_open_to(v_place, v_level) then
    return jsonb_build_object('status', 'rejected', 'reasons', jsonb_build_array('level_locked'),
                              'rewarded', false, 'required_level', v_place.min_level, 'level', v_level,
                              'new_badges', '[]'::jsonb, 'xp_gained', 0);
  end if;

  v_result := public.record_checkin(p_user, p_place, p_lat, p_lng, p_accuracy, p_selfie_path, p_face_count, p_qr, p_client);
  select xp, member_since is not null, coalesce(plus_until > now(), false) into v_before, v_member, v_plus
    from public.profiles where id = p_user;

  if (v_result->>'rewarded')::boolean then
    -- first visit: a stamp. XP and coins for everyone.
    v_new_province := v_place.province_id is not null
      and not exists (select 1 from public.stamps where user_id = p_user and province_id = v_place.province_id);
    v_xp := case least(v_place.tier, 3) when 3 then 150 when 2 then 75 else 30 end + case when v_new_province then 100 else 0 end;
    v_coins := case least(v_place.tier, 3) when 3 then 30 when 2 then 10 else 3 end;
    if v_plus then v_coins := round(v_coins * 1.25); end if;
    -- supporting OTOP and community enterprises pays more
    if v_place.otop or v_place.community then v_xp := round(v_xp * 1.5); end if;
    -- a Siam Si XP boost (Rare/Epic prize) still running
    if exists (select 1 from public.profiles where id = p_user and xp_boost_until > now()) then v_xp := round(v_xp * 1.5); end if;

    -- ride along: another member of my running trip checked in here in the last hour, so both stamps get +50%
    v_trip := public.active_trip(p_user);
    if v_trip is not null then
      v_group := public.group_partner_here(v_trip, p_user, p_place);
    end if;
    if v_group then
      v_xp := round(v_xp * 1.5); v_coins := round(v_coins * 1.5);
      for b in
        select st.user_id, round(st.xp * 0.5)::int as add_xp, round(st.coins * 0.5)::int as add_coins
          from public.stamps st join public.trip_members m on m.user_id = st.user_id
         where m.trip_id = v_trip and m.left_at is null and st.user_id <> p_user
           and st.place_id = p_place and not st.group_bonus and st.earned_at > now() - interval '60 minutes'
           and st.earned_at >= m.joined_at
           for update of st
      loop
        update public.stamps set group_bonus = true, xp = xp + b.add_xp, coins = coins + b.add_coins
         where user_id = b.user_id and place_id = p_place;
        update public.profiles set xp = xp + b.add_xp where id = b.user_id;
        -- riding along: a bonus shake each, at most 3 a day (so two accounts of one person can't farm them)
        if (select count(*) from public.stamps where user_id = b.user_id and group_bonus and earned_at > now() - interval '24 hours') <= 3 then
          perform public.grant_fortune_ticket(b.user_id);
        end if;
      end loop;
      if (select count(*) from public.stamps where user_id = p_user and group_bonus and earned_at > now() - interval '24 hours') < 3 then
        perform public.grant_fortune_ticket(p_user);
      end if;
    end if;

    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug, group_bonus)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event, v_group)
    on conflict (user_id, place_id) do update   -- a real visit after a demo stamp here: the real one takes the stamp
      set checkin_id = excluded.checkin_id, tier = excluded.tier, province_id = excluded.province_id, xp = excluded.xp,
          coins = excluded.coins, event_slug = excluded.event_slug, group_bonus = excluded.group_bonus, earned_at = now()
      where not coalesce((p_client->>'demo')::boolean, false)
        and exists (select 1 from public.checkins c where c.id = stamps.checkin_id and coalesce((c.client->>'demo')::boolean, false));
    update public.profiles set xp = xp + v_xp where id = p_user;
    -- a new province: a bonus shake (not in demo mode: bonus pulls carry no check-in, so the leaderboard couldn't subtract them)
    if v_new_province and not coalesce((p_client->>'demo')::boolean, false) then perform public.grant_fortune_ticket(p_user); end if;
  end if;
  -- finished quests wait for you to claim them (Quests tab: tap Claim, the chest opens); here they're only reported as ready
  if v_result->>'status' = 'approved' then
    select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', c.coins, 'ready', true)), '[]')
      into v_challenges from public.challenge_progress(p_user) c where c.have >= c.need and not c.claimed;
  end if;
  select xp into v_after from public.profiles where id = p_user;

  -- the feed: what happened on this check-in
  if (v_result->>'rewarded')::boolean then
    insert into public.activity (user_id, kind, place_id, province_id, checkin_id, data)
    values (p_user, 'stamp', p_place, v_place.province_id, (v_result->>'checkin_id')::uuid,
            jsonb_build_object('tier', v_place.tier, 'group_bonus', v_group));
    if v_new_province then
      insert into public.activity (user_id, kind, place_id, province_id, checkin_id)
      values (p_user, 'province', p_place, v_place.province_id, (v_result->>'checkin_id')::uuid);
    end if;
  end if;
  -- a booking made through Giggles Maps is done once the guest's check-in there is approved (around the booked day): the shop pays
  -- the flat fee from its credit. Row locks: a double-tapped check-in can't complete or charge the same booking twice.
  if v_result->>'status' = 'approved' and not coalesce((p_client->>'demo')::boolean, false) then   -- never in demo mode
    select * into v_booking from public.bookings
     where user_id = p_user and place_id = p_place and status = 'accepted'
       and day between (now() at time zone 'Asia/Bangkok')::date - 1 and (now() at time zone 'Asia/Bangkok')::date + 1
     order by day limit 1 for update skip locked;
    if found then
      select least(v_booking.fee_thb, wallet_thb) into v_charge from public.shops where id = v_booking.shop_id for update;
      update public.shops set wallet_thb = wallet_thb - coalesce(v_charge, 0) where id = v_booking.shop_id;
      update public.bookings set status = 'completed', completed_at = now(), charged_thb = coalesce(v_charge, 0) where id = v_booking.id;
    end if;
  end if;
  if public.level_for(v_after) > public.level_for(v_before) then
    insert into public.activity (user_id, kind, data) values (p_user, 'level', jsonb_build_object('level', public.level_for(v_after)));
  end if;
  select coalesce(jsonb_agg(n), '[]') into v_badges_new
    from jsonb_array_elements(public.achievements(p_user)) n
    join jsonb_array_elements(v_badges_before) o on o->>'slug' = n->>'slug'
   where (n->>'tier')::int > (o->>'tier')::int;
  for ch in select * from jsonb_array_elements(v_badges_new) loop
    insert into public.activity (user_id, kind, data) values (p_user, 'badge', ch);
  end loop;

  return v_result || jsonb_build_object(
    'stamp', case when (v_result->>'rewarded')::boolean then jsonb_build_object(
               'tier', v_place.tier, 'new_province', v_new_province, 'event', v_event,
               'province', (select name_en from public.provinces where id = v_place.province_id)) end,
    'group_bonus', v_group,
    'badges', v_badges_new,
    'challenges', v_challenges,
    'xp_gained', v_after - v_before, 'xp', v_after, 'member', v_member,
    'coins', public.coins_of(p_user),
    'level', public.level_for(v_after),
    'level_up', public.level_for(v_after) > public.level_for(v_before),
    -- a first visit earns a Siam Si shake for this check-in (shake_fortune)
    'shake', coalesce((v_result->>'rewarded')::boolean, false),
    'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = p_user), 0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shake_fortune(p_checkin uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_landmark boolean := false;
  v_source text;
  v_since_rare int; v_since_legendary int;
  v_rarity text; v_stick int; v_r float8;
  v_kind text; v_coins int := 0; v_xp int := 0; v_hours int := 0;
  v_item public.shop_items;
begin
  if v_user is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_user for update;   -- one shake at a time per traveller
  -- backstop against forged check-ins: no honest day of travel needs more than 30 shakes
  if (select count(*) from public.fortune_pulls where user_id = v_user and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'shake_limit' using errcode = 'P0001';
  end if;
  if p_checkin is not null then
    -- your own first-visit check-in from the last day, not shaken yet
    select p.tier >= 3 into v_landmark from public.checkins c join public.places p on p.id = c.place_id
     where c.id = p_checkin and c.user_id = v_user and c.rewarded and c.status = 'approved'
       and c.created_at > now() - interval '24 hours'
       and not exists (select 1 from public.fortune_pulls f where f.checkin_id = c.id);
    if not found then raise exception 'nothing_to_shake' using errcode = 'P0001'; end if;
    v_source := 'checkin';
  else
    update public.fortune_tickets set balance = balance - 1 where user_id = v_user and balance > 0;
    if not found then raise exception 'nothing_to_shake' using errcode = 'P0001'; end if;
    v_source := 'bonus';
  end if;

  select count(*) into v_since_rare from public.fortune_pulls
   where user_id = v_user and id > coalesce((select max(id) from public.fortune_pulls where user_id = v_user and rarity <> 'common'), 0);
  select count(*) into v_since_legendary from public.fortune_pulls
   where user_id = v_user and id > coalesce((select max(id) from public.fortune_pulls where user_id = v_user and rarity = 'legendary'), 0);
  -- luck perks (level rewards): +10% each makes every rarity above Common that much likelier
  v_rarity := public.fortune_rarity(random() / public.perk_boost(v_user, 'luck'), v_landmark, v_since_rare, v_since_legendary);
  v_stick := 1 + floor(random() * 28)::int;
  v_r := random();

  -- a cosmetic you don't own yet, from this rarity's shelf; none left = coins instead
  if (v_rarity = 'rare' and v_r >= 0.7) or (v_rarity = 'epic' and v_r >= 0.6) or v_rarity = 'legendary' then
    select * into v_item from public.shop_items i
     where case v_rarity when 'legendary' then i.gacha_only
                         when 'epic' then not i.gacha_only and not i.plus and i.price between 200 and 500
                         else not i.gacha_only and not i.plus and i.price between 1 and 150 end
       and not exists (select 1 from public.coin_spends s where s.user_id = v_user and s.kind = i.kind and s.item_id = i.id)
     order by random() limit 1;
  end if;
  if v_item.id is not null then
    v_kind := 'item';
    insert into public.coin_spends (user_id, kind, item_id, coins) values (v_user, v_item.kind, v_item.id, 0) on conflict do nothing;
  elsif v_rarity = 'common' then
    if v_r < 0.5 then v_kind := 'coins'; v_coins := 10 + floor(random() * 11)::int; else v_kind := 'xp'; v_xp := 30; end if;
  elsif v_rarity = 'rare' then
    if v_r < 0.4 or v_r >= 0.7 then v_kind := 'coins'; v_coins := 40 + floor(random() * 21)::int;   -- no item left: published coins
    else v_kind := 'boost'; v_hours := 24; end if;
  elsif v_rarity = 'epic' then
    if v_r < 0.35 or v_r >= 0.6 then v_kind := 'coins'; v_coins := 120;
    else v_kind := 'boost'; v_hours := 72; end if;
  else
    v_kind := 'coins'; v_coins := 500;
  end if;
  -- a demo check-in's shake never wins an XP boost (it would multiply later real stamps on the leaderboard): the coins instead
  if v_kind = 'boost' and public.is_demo_checkin(p_checkin) then
    v_kind := 'coins'; v_hours := 0;
    v_coins := case v_rarity when 'epic' then 120 else 40 + floor(random() * 21)::int end;
  end if;
  if v_coins > 0 then v_coins := round(v_coins * public.perk_boost(v_user, 'coins')); end if;   -- coin perks
  if v_xp > 0 then update public.profiles set xp = xp + v_xp where id = v_user; end if;
  if v_hours > 0 then
    update public.profiles set xp_boost_until = greatest(coalesce(xp_boost_until, now()), now()) + make_interval(hours => v_hours)
     where id = v_user;
  end if;

  insert into public.fortune_pulls (user_id, checkin_id, source, stick, rarity, prize_kind, coins, xp, boost_hours, item_kind, item_id)
  values (v_user, p_checkin, v_source, v_stick, v_rarity, v_kind, v_coins, v_xp, v_hours, v_item.kind, v_item.id);
  if v_rarity in ('epic', 'legendary') then
    insert into public.activity (user_id, kind, data) values (v_user, 'fortune',
      jsonb_build_object('rarity', v_rarity, 'stick', v_stick, 'prize', v_kind, 'item', v_item.name_en, 'coins', v_coins));
  end if;

  return jsonb_build_object('stick', v_stick, 'rarity', v_rarity, 'prize', v_kind, 'coins', v_coins, 'xp', v_xp,
    'boost_hours', v_hours, 'item_kind', v_item.kind, 'item_id', v_item.id, 'item_en', v_item.name_en, 'item_th', v_item.name_th,
    'xp_boost_until', (select xp_boost_until from public.profiles where id = v_user),
    'member', (select member_since is not null from public.profiles where id = v_user),
    'tickets', coalesce((select balance from public.fortune_tickets where user_id = v_user), 0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.selfie_orphans(p_limit integer DEFAULT 1000)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select o.name from storage.objects o
   where o.bucket_id = 'selfies' and o.created_at < now() - interval '30 days'
     and not exists (select 1 from public.checkins c where c.selfie_path = o.name)
     -- a nomination's photo is kept until 30 days after it closes: gone live (its place's creation), or expired / rejected
     -- (at most 30 days after it was made)
     and not exists (select 1 from public.nominations n left join public.places p on p.id = n.place_id
                      where n.photo_path = o.name
                        and coalesce(case when n.status = 'live' then p.created_at end, n.created_at + interval '30 days')
                            > now() - interval '30 days')
   order by o.created_at
   limit least(greatest(p_limit, 0), 1000)
$function$
;
