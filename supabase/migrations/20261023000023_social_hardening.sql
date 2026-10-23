-- Security review fixes for migration 022.

-- codes from a secure random source, length capped; trip codes 10 characters (32^10) so they cannot be guessed
create or replace function public.new_code(p_len int) returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(extensions.gen_random_bytes(1), 0) % 32, 1), '')
    from generate_series(1, least(p_len, 32))
$$;
revoke execute on function public.new_code(int) from public, anon, authenticated;
alter table public.trips alter column code set default public.new_code(10);
update public.trips set code = public.new_code(10) where ended_at is null;

-- names shown to other people: no control, markup or bidi/zero-width characters
create or replace function public.clean_name(p text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(trim(p), '\s+', ' ', 'g');
begin
  if v is null or v = '' then return null; end if;
  if char_length(v) > p_max or v ~ '[[:cntrl:]<>​-‏‪-‮⁦-⁩]' then
    raise exception 'bad_name' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create or replace function public.set_me(p_nickname text default null, p_colour text default null, p_on_leaderboard boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nick text;
begin
  if p_nickname is not null then
    begin v_nick := public.clean_name(p_nickname, 20);
    exception when others then raise exception 'bad_nickname' using errcode = 'P0001'; end;
    if char_length(coalesce(v_nick, '')) < 2 then raise exception 'bad_nickname' using errcode = 'P0001'; end if;
  end if;
  if p_colour is not null and p_colour not in ('marigold', 'indigo', 'lotus', 'jade', 'sky', 'coral', 'plum', 'slate') then
    raise exception 'bad_colour' using errcode = 'P0001';
  end if;
  update public.profiles set nickname = coalesce(v_nick, nickname), colour = coalesce(p_colour, colour),
                             on_leaderboard = coalesce(p_on_leaderboard, on_leaderboard)
   where id = auth.uid();
end;
$$;

create or replace function public.start_trip(p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := public.clean_name(p_name, 40);
begin
  perform public.leave_trip();
  insert into public.trips (owner, name) values (auth.uid(), v_name) returning id into v_id;
  insert into public.trip_members (trip_id, user_id) values (v_id, auth.uid());
  return public.my_trip();
end;
$$;

-- expired requests can no longer be accepted
create or replace function public.answer_friend(p_from uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friend_requests where from_id = p_from and to_id = auth.uid() and created_at > now() - interval '7 days';
  if not found then raise exception 'no_request' using errcode = 'P0001'; end if;
  if p_accept then
    insert into public.friendships (a, b) values (least(p_from, auth.uid()), greatest(p_from, auth.uid())) on conflict do nothing;
  end if;
end;
$$;

-- the 20-member cap holds under concurrent joins (trip row locked)
create or replace function public.join_trip(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.trips where code = upper(trim(p_code)) and ended_at is null and ends_at > now() for update;
  if v_id is null then raise exception 'trip_not_found' using errcode = 'P0001'; end if;
  if v_id is distinct from public.active_trip(auth.uid()) then
    if (select count(*) from public.trip_members where trip_id = v_id and left_at is null) >= 20 then
      raise exception 'trip_full' using errcode = 'P0001';
    end if;
    perform public.leave_trip();
    insert into public.trip_members (trip_id, user_id) values (v_id, auth.uid())
      on conflict (trip_id, user_id) do update set left_at = null, joined_at = now();
  end if;
  return public.my_trip();
end;
$$;

-- trip photos: only current members of a running trip, only photos taken while their owner was on it
create or replace function public.can_see_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.checkins c
     where c.selfie_path = p_path and not c.photo_hidden and c.status <> 'rejected'
       and (public.is_friend(auth.uid(), c.user_id)
            or exists (select 1 from public.trips t
                         join public.trip_members a on a.trip_id = t.id and a.user_id = auth.uid() and a.left_at is null
                         join public.trip_members b on b.trip_id = t.id and b.user_id = c.user_id
                        where t.ended_at is null and t.ends_at > now()
                          and c.created_at >= b.joined_at and (b.left_at is null or c.created_at <= b.left_at))))
$$;
revoke execute on function public.can_see_photo(text) from public, anon;
grant execute on function public.can_see_photo(text) to authenticated;

create or replace function public.my_trip() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips;
begin
  perform public.wipe_trip_positions();
  select * into v_trip from public.trips where id = public.active_trip(auth.uid());
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_trip.id, 'code', v_trip.code, 'name', v_trip.name, 'owner', v_trip.owner = auth.uid(),
    'started_at', v_trip.started_at, 'ends_at', v_trip.ends_at,
    'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'me', m.user_id = auth.uid(), 'owner', m.user_id = v_trip.owner,
                   'nickname', coalesce(pr.nickname, 'Explorer'), 'colour', pr.colour,
                   'lat', case when m.seen_at > now() - interval '10 minutes' then m.lat end,
                   'lng', case when m.seen_at > now() - interval '10 minutes' then m.lng end, 'seen_at', m.seen_at) order by m.joined_at)
                from public.trip_members m join public.profiles pr on pr.id = m.user_id
               where m.trip_id = v_trip.id and m.left_at is null),
    'album', coalesce((select jsonb_agg(jsonb_build_object('checkin_id', ch.id, 'path', ch.selfie_path, 'caption', ch.caption,
                   'place', pl.name, 'at', ch.created_at, 'nickname', coalesce(pr.nickname, 'Explorer'), 'colour', pr.colour)
                   order by ch.created_at desc)
                from public.trip_members m
                join public.checkins ch on ch.user_id = m.user_id and ch.created_at >= m.joined_at
                                       and (m.left_at is null or ch.created_at <= m.left_at)
                join public.places pl on pl.id = ch.place_id
                join public.profiles pr on pr.id = m.user_id
               where m.trip_id = v_trip.id and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden), '[]'));
end;
$$;

-- group bonus: only check-ins made after that member joined the trip
create or replace function public.group_partner_here(p_trip uuid, p_user uuid, p_place bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m join public.checkins c on c.user_id = m.user_id
                  where m.trip_id = p_trip and m.left_at is null and m.user_id <> p_user
                    and c.place_id = p_place and c.status = 'approved'
                    and c.created_at > now() - interval '60 minutes' and c.created_at >= m.joined_at)
$$;
revoke execute on function public.group_partner_here(uuid, uuid, bigint) from public, anon, authenticated;

create or replace function public.record_checkin_v5(
  p_user uuid, p_place bigint, p_lat float8, p_lng float8, p_accuracy float8,
  p_selfie_path text, p_face_count int, p_qr text default null, p_client jsonb default '{}')
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_place public.places;
  v_level int := public.unlock_level(p_user);
  v_result jsonb;
  v_before int;
  v_after int;
  v_member boolean;
  v_plus boolean;
  v_new_province boolean := false;
  v_xp int := 0;
  v_coins int := 0;
  v_event text;
  v_challenges jsonb := '[]';
  v_trip uuid;
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
    -- first visit: a stamp. XP is banked for everyone (free users unlock it by joining); coins count for members.
    v_new_province := v_place.province_id is not null
      and not exists (select 1 from public.stamps where user_id = p_user and province_id = v_place.province_id);
    v_xp := case v_place.tier when 3 then 150 when 2 then 75 else 30 end + case when v_new_province then 100 else 0 end;
    v_coins := case v_place.tier when 3 then 30 when 2 then 10 else 3 end;
    if v_plus then v_coins := round(v_coins * 1.25); end if;

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
      end loop;
    end if;

    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug, group_bonus)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event, v_group)
    on conflict do nothing;
    update public.profiles set xp = xp + v_xp where id = p_user;
  end if;
  if v_result->>'status' = 'approved' then v_challenges := public.claim_challenges(p_user); end if;
  select xp into v_after from public.profiles where id = p_user;

  return v_result || jsonb_build_object(
    'stamp', case when (v_result->>'rewarded')::boolean then jsonb_build_object(
               'tier', v_place.tier, 'new_province', v_new_province, 'event', v_event,
               'province', (select name_en from public.provinces where id = v_place.province_id)) end,
    'group_bonus', v_group,
    'challenges', v_challenges,
    'xp_gained', v_after - v_before, 'xp', v_after, 'member', v_member,
    'coins', public.coins_of(p_user),
    'level', public.level_for(v_after),
    'level_up', public.level_for(v_after) > public.level_for(v_before));
end;
$$;
revoke execute on function public.record_checkin_v5(uuid, bigint, float8, float8, float8, text, int, text, jsonb) from public, anon, authenticated;
