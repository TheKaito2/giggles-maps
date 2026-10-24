-- Monetization v5 hardening (review of 063)
--   free accounts: 100 plans a day in all (the per-destination count alone let one destination be re-planned without end);
--   an "edit" counts as an edit only after that destination was planned today (exclude: [1] can't plan new places for free);
--   bookings: one open booking per place and day; completed only on an approved check-in, charged once, under row locks;
--   accepting a booking needs credit for its fee; the membership's 3 Plus months are given once per account;
--   a Partner payment never downgrades a live Giggles Choice; approving an unknown shop is an error.

drop function public.plan_allowed(uuid, boolean, text, boolean);
create function public.plan_allowed(p_user uuid, p_edit boolean, p_key text, p_dest text, p_member boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_edit boolean;
  v_key text;
begin
  perform pg_advisory_xact_lock(hashtext('plan_usage:' || p_user::text));
  delete from public.plan_usage where user_id = p_user and at < now() - interval '3 days';
  -- everyone: at most 20 plans a minute; a day: 300 for members, 100 for free accounts
  if (select count(*) from public.plan_usage where user_id = p_user and at > now() - interval '1 minute') >= 20 then return 'slow_down'; end if;
  if (select count(*) from public.plan_usage where user_id = p_user and day = v_day) >= (case when p_member then 300 else 100 end) then return 'slow_down'; end if;
  -- an edit of a destination not planned today is a new detour
  v_edit := p_edit and exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = 'detour' and key = p_dest);
  v_key := case when v_edit then p_key else p_dest end;
  if not p_member
    and not exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = (case when v_edit then 'edit' else 'detour' end) and key = v_key)
    and (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = (case when v_edit then 'edit' else 'detour' end))
        >= (case when v_edit then 10 else 3 end) then
    return case when v_edit then 'edit_limit' else 'detour_limit' end;
  end if;
  insert into public.plan_usage (user_id, day, kind, key) values (p_user, v_day, case when v_edit then 'edit' else 'detour' end, v_key);
  return 'ok';
end $$;
revoke execute on function public.plan_allowed(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.plan_allowed(uuid, boolean, text, text, boolean) to service_role;

create unique index bookings_one_open on public.bookings (user_id, place_id, day) where status in ('requested', 'accepted');

create or replace function public.request_booking(p_place bigint, p_day date, p_party int, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_today date := (now() at time zone 'Asia/Bangkok')::date; v_id bigint;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.places_tiers(array[p_place])) then raise exception 'not_bookable' using errcode = 'P0001'; end if;
  if p_day is null or p_day < v_today or p_day > v_today + 180 then raise exception 'bad_day' using errcode = 'P0001'; end if;
  if p_party is null or p_party not between 1 and 20 then raise exception 'bad_party' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('bookings:' || auth.uid()::text));
  if (select count(*) from public.bookings where user_id = auth.uid() and status in ('requested', 'accepted') and day >= v_today) >= 5 then
    raise exception 'too_many_bookings' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bookings where user_id = auth.uid() and place_id = p_place and day = p_day and status in ('requested', 'accepted')) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;
  select shop_id into v_shop from public.places where id = p_place;
  insert into public.bookings (place_id, user_id, shop_id, day, party, note)
  values (p_place, auth.uid(), v_shop, p_day, p_party, nullif(btrim(left(p_note, 300)), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.answer_booking(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select bk.* into b from public.bookings bk join public.shops s on s.id = bk.shop_id
   where bk.id = p_id and s.owner_id = auth.uid() and bk.status = 'requested' for update of bk;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_accept and (select wallet_thb from public.shops where id = b.shop_id) < b.fee_thb then
    raise exception 'top_up_first' using errcode = 'P0001';
  end if;
  update public.bookings set status = case when p_accept then 'accepted' else 'declined' end, answered_at = now() where id = p_id;
end $$;

alter table public.profiles add column membership_plus_given boolean not null default false;

create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric, p_shop uuid default null, p_user uuid default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind = 'plus' then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now()) + interval '30 days' where id = p_user;
  elsif p_kind = 'membership' then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = case when not membership_plus_given then greatest(coalesce(plus_until, now()), now()) + interval '90 days' else plus_until end
     where id = p_user;
  elsif p_kind in ('partner', 'choice') then
    -- a Partner payment keeps a live Giggles Choice (the days add on); Choice upgrades a Partner
    update public.shops set tier = case when tier = 'choice' and tier_until > now() then 'choice' else p_kind end,
      tier_until = greatest(coalesce(tier_until, now()), now()) + interval '30 days' where id = p_shop;
  else
    raise exception 'unknown payment kind %', p_kind;
  end if;
  return true;
exception when unique_violation then
  return false;  -- Stripe retried an event we already applied
end $$;

create or replace function public.apply_apple_membership(p_otid text, p_user uuid, p_env text, p_revoked timestamptz)
returns timestamptz language plpgsql set search_path = '' as $$
declare v_since timestamptz;
begin
  if exists (select 1 from public.apple_memberships where original_transaction_id = p_otid and user_id <> p_user) then
    raise exception 'membership belongs to another account' using errcode = 'P0001';
  end if;
  insert into public.apple_memberships (original_transaction_id, user_id, environment, revoked_at)
  values (p_otid, p_user, p_env, p_revoked)
  on conflict (original_transaction_id) do update set revoked_at = excluded.revoked_at, environment = excluded.environment, updated_at = now();
  if p_revoked is null then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = case when not membership_plus_given then greatest(coalesce(plus_until, now()), now()) + interval '90 days' else plus_until end
     where id = p_user returning member_since into v_since;
  else
    -- keep a web (Stripe) membership if there is one
    update public.profiles set member_since = null where id = p_user
      and not exists (select 1 from public.payments where user_id = p_user and kind = 'membership')
    returning member_since into v_since;
  end if;
  return v_since;
end $$;

create or replace function public.approve_choice(p_shop uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  update public.shops set choice_approved = p_ok, choice_requested_at = null where id = p_shop;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

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
    v_xp := case v_place.tier when 3 then 150 when 2 then 75 else 30 end + case when v_new_province then 100 else 0 end;
    v_coins := case v_place.tier when 3 then 30 when 2 then 10 else 3 end;
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
    on conflict do nothing;
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
  if v_result->>'status' = 'approved' then
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
