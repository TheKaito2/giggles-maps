-- Migration 094: critic round 5. The ride-along bonus ignored demo mode (a demo check-in could earn real bonus shakes and
-- +50% on a partner's stamp), and a real visit over a demo stamp added its XP on top of the demo XP, which the leaderboard
-- could then no longer subtract. A demo stamp also used up the real "new province" bonus. Shared trip pages now label paid stops. Checked by supabase/tests/critic_r5.sql.

create or replace function public.group_partner_here(p_trip uuid, p_user uuid, p_place bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m join public.checkins c on c.user_id = m.user_id
                  where m.trip_id = p_trip and m.left_at is null and m.user_id <> p_user
                    and c.place_id = p_place and c.status = 'approved'
                    and not coalesce((c.client->>'demo')::boolean, false)
                    and c.created_at > now() - interval '60 minutes' and c.created_at >= m.joined_at)
$$;

-- anyone with the link: paid stops carry their label here too. Looked up on each view, so old shared trips get it and a
-- shop that stops paying loses it. Demo trips show demo mode's pretend tiers, marked as examples.
create or replace function public.view_shared_trip(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'created_at', t.created_at, 'title', t.title, 'mode', t.mode,
           'origin', jsonb_build_object('name', t.origin_name, 'lat', t.origin_lat, 'lng', t.origin_lng),
           'dest', jsonb_build_object('name', t.dest_name, 'lat', t.dest_lat, 'lng', t.dest_lng),
           'stops', (select coalesce(jsonb_agg(e.s || jsonb_build_object(
                       'partner_tier', coalesce(rt.tier, case when t.demo then dp.tier end),
                       'partner_demo', rt.tier is null and t.demo and dp.tier is not null,
                       'is_partner', coalesce(p.is_partner, false), 'is_demo', coalesce(p.is_demo, false)) order by e.o), '[]'::jsonb)
                       from jsonb_array_elements(t.stops) with ordinality e(s, o)
                       left join public.places p on p.id = (e.s->>'id')::bigint
                       left join lateral public.places_tiers(array[(e.s->>'id')::bigint]) rt on true
                       left join public.demo_partners dp on dp.place_id = p.id),
           'extra_min', t.extra_min, 'total_min', t.total_min, 'geometry', t.geometry, 'note', t.note,
           'demo', t.demo, 'who', public.who_of(t.owner) - 'id')
    from public.shared_trips t
   where t.id = p_id
$$;

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
  v_badges_before jsonb;
  v_badges_new jsonb := '[]';
  ch jsonb;
  v_group boolean := false;
  v_demo boolean := coalesce((p_client->>'demo')::boolean, false);
  v_replaced_xp int := 0;
  b record;
begin
  -- the traveller's lock first (record_checkin takes it too), so a parallel check-in's badges are already in the snapshot
  perform 1 from public.profiles where id = p_user for update;
  v_badges_before := public.achievements(p_user);
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
      and not exists (select 1 from public.stamps where user_id = p_user and province_id = v_place.province_id
                        and (v_demo or not public.is_demo_checkin(checkin_id)));   -- a demo stamp doesn't use up a real new province
    v_xp := case least(v_place.tier, 3) when 3 then 150 when 2 then 75 else 30 end + case when v_new_province then 100 else 0 end;
    v_coins := case least(v_place.tier, 3) when 3 then 30 when 2 then 10 else 3 end;
    if v_plus then v_coins := round(v_coins * 1.25); end if;
    -- supporting OTOP and community enterprises pays more
    if v_place.otop or v_place.community then v_xp := round(v_xp * 1.5); end if;
    -- a Siam Si XP boost (Rare/Epic prize) still running
    if exists (select 1 from public.profiles where id = p_user and xp_boost_until > now()) then v_xp := round(v_xp * 1.5); end if;

    -- ride along: another member of my running trip checked in here in the last hour, so both stamps get +50%
    v_trip := public.active_trip(p_user);
    if v_trip is not null and not v_demo then   -- never in demo mode: the bonus pays real shakes, which carry no check-in
      v_group := public.group_partner_here(v_trip, p_user, p_place);
    end if;
    if v_group then
      v_xp := round(v_xp * 1.5); v_coins := round(v_coins * 1.5);
      for b in
        select st.user_id, round(st.xp * 0.5)::int as add_xp, round(st.coins * 0.5)::int as add_coins
          from public.stamps st join public.trip_members m on m.user_id = st.user_id
         where m.trip_id = v_trip and m.left_at is null and st.user_id <> p_user
           and st.place_id = p_place and not st.group_bonus and st.earned_at > now() - interval '60 minutes'
           and st.earned_at >= m.joined_at and not public.is_demo_checkin(st.checkin_id)
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

    -- a real visit takes over a demo stamp below: that stamp's XP comes off, or the board would count it as real
    if not v_demo then
      v_replaced_xp := coalesce((select st.xp from public.stamps st where st.user_id = p_user and st.place_id = p_place
                                  and public.is_demo_checkin(st.checkin_id)), 0);
    end if;

    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug, group_bonus)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event, v_group)
    on conflict (user_id, place_id) do update   -- a real visit after a demo stamp here: the real one takes the stamp
      set checkin_id = excluded.checkin_id, tier = excluded.tier, province_id = excluded.province_id, xp = excluded.xp,
          coins = excluded.coins, event_slug = excluded.event_slug, group_bonus = excluded.group_bonus, earned_at = now()
      where not coalesce((p_client->>'demo')::boolean, false)
        and exists (select 1 from public.checkins c where c.id = stamps.checkin_id and coalesce((c.client->>'demo')::boolean, false));
    update public.profiles set xp = greatest(0, xp + v_xp - v_replaced_xp) where id = p_user;
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
    'xp_gained', v_after - v_before + v_replaced_xp, 'xp', v_after, 'member', v_member,
    'coins', public.coins_of(p_user),
    'level', public.level_for(v_after),
    'level_up', public.level_for(v_after) > public.level_for(v_before),
    -- a first visit earns a Siam Si shake for this check-in (shake_fortune)
    'shake', coalesce((v_result->>'rewarded')::boolean, false),
    'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = p_user), 0));
end;
$function$;
