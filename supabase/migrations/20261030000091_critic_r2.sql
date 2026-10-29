-- Critic round 2.
-- record_checkin: a real check-in's first-visit check and pace limits (30 s, 12 an hour, 60 a day) ignore demo
--   check-ins, so a demo visit can't use up the real stamp (and the shop's billed visit) or block real stamps as
--   slow_down. Demo check-ins keep counting everything, as before.
-- record_checkin_v5: when that real check-in follows a demo stamp at the same place, the stamp row is taken over by the
--   real one (checkin, xp, coins), so the leaderboard counts it. Profile XP from the demo stamp stays (demo rewards).
-- share_trip: an end named "Your location" (after Swap) is hidden like the start: named "End", placed on the last stop,
--   and the line cut there.
-- place_regular: no Regular at places that belong to a shop ("partner shops never see who visited").
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
     where cp.active and public.shop_funded(s, pl.bid_thb)
       and extensions.st_dwithin(pl.location, v_here, 3000)
       and not exists (select 1 from public.coupon_wins w where w.coupon_id = cp.id and w.user_id = p_user
                         and w.created_at > now() - interval '30 days');
    if v_total > 0 and not v_demo then   -- coupons are paid for by real shops: no spin in demo mode
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
$function$;

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
    if v_new_province then perform public.grant_fortune_ticket(p_user); end if;   -- a new province: a bonus shake
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
$function$;

CREATE OR REPLACE FUNCTION public.share_trip(p_trip jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id text;
  v_origin text; v_title text; v_dest text; v_note text;
  v_olat float8; v_olng float8; v_dlat float8; v_dlng float8;
  v_stops jsonb; v_geom jsonb := p_trip->'geometry'; v_n int; v_dest_here boolean;
begin
  if v_uid is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('share_trip:' || v_uid::text));
  if (select count(*) from public.shared_trips where owner = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'share_limit' using errcode = 'P0001';
  end if;

  begin
    v_origin := public.clean_name(p_trip->>'origin_name', 80);
    v_dest := public.clean_name(p_trip->>'dest_name', 80);
    v_note := public.clean_name(p_trip->>'note', 280);
    v_dlat := (p_trip->>'dest_lat')::float8; v_dlng := (p_trip->>'dest_lng')::float8;
    v_olat := (p_trip->>'origin_lat')::float8; v_olng := (p_trip->>'origin_lng')::float8;
  exception when others then raise exception 'bad_trip' using errcode = 'P0001';
  end;
  if v_origin is null or v_origin = 'Your location' then v_origin := 'Start'; v_olat := null; v_olng := null; end if;
  v_dest_here := coalesce(v_dest = 'Your location', false);   -- after Swap the sharer's position is the end: hidden like the start
  if v_dest_here then v_dest := 'End'; end if;
  v_title := left(split_part(v_origin, ', ', 1) || ' → ' || split_part(v_dest, ', ', 1), 120);   -- built here: a client title could name the start
  if v_dest is null or v_dlat is null or v_dlng is null
     or v_dlat not between 5 and 21 or v_dlng not between 97 and 106
     or (v_olat is null) <> (v_olng is null) or (v_olat is not null and (v_olat not between 5 and 21 or v_olng not between 97 and 106))
     or coalesce(p_trip->>'mode', '') not in ('auto', 'pedestrian', 'bicycle')
     or jsonb_typeof(p_trip->'stops') is distinct from 'array' or jsonb_array_length(p_trip->'stops') not between 1 and 15
     or jsonb_typeof(v_geom) is distinct from 'array' or jsonb_array_length(v_geom) not between 2 and 600
     or exists (select 1 from jsonb_array_elements(v_geom) e
                 where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 2
                    or jsonb_typeof(e->0) <> 'number' or jsonb_typeof(e->1) <> 'number') then
    raise exception 'bad_trip' using errcode = 'P0001';
  end if;

  -- each stop: the place's own name, kind and position; the client gives only id, arrival and time there
  begin
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_th', p.name_th, 'category', p.category,
             'lat', round(extensions.st_y(p.location::extensions.geometry)::numeric, 6),
             'lng', round(extensions.st_x(p.location::extensions.geometry)::numeric, 6),
             'arrive_min', s.arrive_min, 'leave_min', s.arrive_min + s.dwell_min, 'dwell_min', s.dwell_min) order by s.ord),
           count(*)
      into v_stops, v_n
      from rows from (jsonb_to_recordset(p_trip->'stops') as (id bigint, arrive_min int, dwell_min int)) with ordinality
             as s(id, arrive_min, dwell_min, ord)
      join public.places p on p.id = s.id
     where s.arrive_min between 0 and 2880 and s.dwell_min between 0 and 600;
  exception when others then raise exception 'bad_trip' using errcode = 'P0001';
  end;
  if v_n is distinct from jsonb_array_length(p_trip->'stops') then raise exception 'bad_trip' using errcode = 'P0001'; end if;
  -- an end at "Your location": the page ends at the last stop, and the line is cut at the point nearest it
  -- ponytail: nearest by squared degrees, fine at Thai latitudes for picking one of <= 600 points
  if v_dest_here then
    v_dlat := ((v_stops -> -1)->>'lat')::float8; v_dlng := ((v_stops -> -1)->>'lng')::float8;
    select coalesce(jsonb_agg(g.e order by g.i), '[]') || jsonb_build_array(jsonb_build_array(v_dlng, v_dlat)) into v_geom
      from jsonb_array_elements(v_geom) with ordinality g(e, i)
     where g.i <= (select n.i from jsonb_array_elements(v_geom) with ordinality n(e, i)
                    order by power((n.e->>0)::float8 - v_dlng, 2) + power((n.e->>1)::float8 - v_dlat, 2), n.i limit 1);
  end if;

  -- ponytail: 8 chars from 62 by byte % 62 (a slight bias toward the first 8 letters); retried on the rare clash
  loop
    v_id := (select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
                                      1 + get_byte(b, i) % 62, 1), '')
               from (select extensions.gen_random_bytes(8) b) r, generate_series(0, 7) i);
    begin
      insert into public.shared_trips (id, owner, title, mode, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng,
                                       stops, extra_min, total_min, geometry, note, demo)
      values (v_id, v_uid, v_title, p_trip->>'mode', v_origin, v_olat, v_olng, v_dest, v_dlat, v_dlng,
              v_stops, (p_trip->>'extra_min')::int, (p_trip->>'total_min')::int, v_geom, v_note,
              coalesce((p_trip->>'demo')::boolean, false));
      return v_id;
    exception
      when unique_violation then null;   -- id taken: draw another
      when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
        raise exception 'bad_trip' using errcode = 'P0001';
    end;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.place_regular(p_place bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('who', public.who_of(user_id), 'visits', n, 'friend', public.is_friend(auth.uid(), user_id), 'mine', user_id = auth.uid())
    from (select c.user_id, count(distinct (c.created_at at time zone 'Asia/Bangkok')::date)::int n, max(c.created_at) reached
            from public.checkins c join public.profiles pr on pr.id = c.user_id
           where c.place_id = p_place and c.status = 'approved' and c.created_at > now() - interval '60 days'
             and not coalesce((c.client->>'demo')::boolean, false) and pr.on_leaderboard and pr.nickname is not null
           group by 1) v
   where n >= 2 and exists (select 1 from public.places p where p.id = p_place and p.shop_id is null and p.min_level <= public.unlock_level(auth.uid()))
   order by n desc, reached, user_id limit 1
$function$;
