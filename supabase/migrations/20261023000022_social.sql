-- Passport phase 2: nicknames, friends (code + QR), all-time leaderboard, ride along (shared trip, live
-- positions, shared album, +50% group bonus) and the coin shop. Tables are only reached through the RPCs below.

-- ---------- nickname, colour, friend code ----------
create or replace function public.new_code(p_len int) returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, p_len)
$$;

alter table public.profiles
  add column nickname text check (char_length(nickname) between 2 and 20),
  add column colour text not null default 'marigold'
    check (colour in ('marigold', 'indigo', 'lotus', 'jade', 'sky', 'coral', 'plum', 'slate')),
  add column friend_code text unique default public.new_code(8),
  add column on_leaderboard boolean not null default true;

create or replace function public.set_me(p_nickname text default null, p_colour text default null, p_on_leaderboard boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nick text := regexp_replace(trim(p_nickname), '\s+', ' ', 'g');
begin
  if p_nickname is not null and (char_length(v_nick) not between 2 and 20 or v_nick ~ '[[:cntrl:]<>]') then
    raise exception 'bad_nickname' using errcode = 'P0001';
  end if;
  if p_colour is not null and p_colour not in ('marigold', 'indigo', 'lotus', 'jade', 'sky', 'coral', 'plum', 'slate') then
    raise exception 'bad_colour' using errcode = 'P0001';
  end if;
  update public.profiles set nickname = coalesce(v_nick, nickname), colour = coalesce(p_colour, colour),
                             on_leaderboard = coalesce(p_on_leaderboard, on_leaderboard)
   where id = auth.uid();
end;
$$;

-- ---------- coin shop ----------
-- kind = the key in profiles.cosmetics (theme is the passport cover). plus = included with Plus, buyable by members.
create table public.shop_items (
  kind text not null check (kind in ('theme', 'flair', 'map', 'frame', 'title')),
  id text not null,
  name_en text not null,
  name_th text not null,
  price int not null check (price >= 0),
  plus boolean not null default false,
  sort int not null default 0,
  primary key (kind, id)
);
alter table public.shop_items enable row level security;
create policy "shop is public" on public.shop_items for select using (true);

insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort) values
  ('theme', 'classic', 'Classic', 'คลาสสิก', 0, false, 0),
  ('theme', 'indigo', 'Indigo cloth', 'ผ้าคราม', 150, true, 1),
  ('theme', 'lotus', 'Lotus', 'ดอกบัว', 150, true, 2),
  ('theme', 'rain', 'Rainy season', 'หน้าฝน', 150, true, 3),
  ('theme', 'night-market', 'Night market', 'ตลาดกลางคืน', 200, true, 4),
  ('theme', 'temple-gold', 'Temple gold', 'ทองวัด', 300, true, 5),
  ('flair', 'none', 'Plain', 'ธรรมดา', 0, false, 0),
  ('flair', 'marigold', 'Marigold', 'ดาวเรือง', 100, true, 1),
  ('flair', 'indigo', 'Indigo', 'คราม', 100, true, 2),
  ('flair', 'lotus', 'Lotus', 'บัว', 100, true, 3),
  ('flair', 'sparkle', 'Sparkle', 'ประกาย', 250, true, 4),
  ('map', 'liberty', 'Standard', 'มาตรฐาน', 0, false, 0),
  ('map', 'bright', 'Bright', 'สดใส', 150, false, 1),
  ('map', 'positron', 'Paper', 'กระดาษ', 150, false, 2),
  ('frame', 'none', 'No frame', 'ไม่มีกรอบ', 0, false, 0),
  ('frame', 'polaroid', 'Polaroid', 'โพลารอยด์', 100, false, 1),
  ('frame', 'film', 'Film strip', 'ฟิล์ม', 150, false, 2),
  ('frame', 'stamp', 'Postage stamp', 'แสตมป์', 200, false, 3),
  ('frame', 'gold', 'Gold leaf', 'ทองคำเปลว', 250, false, 4),
  ('title', 'none', 'No title', 'ไม่มีฉายา', 0, false, 0),
  ('title', 'wanderer', 'Wanderer', 'นักเดินทาง', 50, false, 1),
  ('title', 'foodie', 'Foodie', 'นักชิม', 150, false, 2),
  ('title', 'temple-hopper', 'Temple hopper', 'สายบุญ', 150, false, 3),
  ('title', 'road-tripper', 'Road tripper', 'สายโรดทริป', 200, false, 4),
  ('title', 'trailblazer', 'Trailblazer', 'ผู้บุกเบิก', 400, false, 5),
  ('title', 'legend', 'Legend of the road', 'ตำนานแห่งถนน', 1000, false, 6);

create table public.coin_spends (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  item_id text not null,
  coins int not null check (coins >= 0),
  spent_at timestamptz not null default now(),
  primary key (user_id, kind, item_id),
  foreign key (kind, item_id) references public.shop_items
);
alter table public.coin_spends enable row level security;

-- coins = earned (stamps, challenges, 50 per level; members only) minus spent
create or replace function public.coins_of(p_user uuid) returns int
language sql stable set search_path = '' as $$
  select case when pr.member_since is null then 0 else
    coalesce((select sum(coins) from public.stamps where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.challenge_claims where user_id = p_user), 0)
    + 50 * (public.level_for(pr.xp) - 1)
    - coalesce((select sum(coins) from public.coin_spends where user_id = p_user), 0) end
  from public.profiles pr where pr.id = p_user
$$;

-- can this user wear this item: free, bought, included with active Plus, or (titles) a completed province set
create or replace function public.can_wear(p_user uuid, p_kind text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shop_items i where i.kind = p_kind and i.id = p_id and (
           i.price = 0
           or exists (select 1 from public.coin_spends s where s.user_id = p_user and s.kind = p_kind and s.item_id = p_id)
           or (i.plus and exists (select 1 from public.profiles pr where pr.id = p_user and pr.plus_until > now()))))
      or (p_kind = 'title' and exists (select 1 from public.challenge_claims cc where cc.user_id = p_user and cc.slug = p_id
                                        and p_id like 'province-%'))
$$;

-- what the user is wearing right now (items no longer allowed, e.g. after Plus ends, drop out)
create or replace function public.look_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}')
    from public.profiles pr, jsonb_each_text(pr.cosmetics) e
   where pr.id = p_user and public.can_wear(p_user, e.key, e.value)
$$;

create or replace function public.title_of(p_look jsonb) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select name_en from public.shop_items where kind = 'title' and id = p_look->>'title' and price > 0),
    (select pv.name_en || ' Explorer' from public.provinces pv where 'province-' || pv.iso = p_look->>'title'))
$$;

create or replace function public.buy_item(p_kind text, p_id text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_item public.shop_items; v_member boolean;
begin
  select member_since is not null into v_member from public.profiles where id = auth.uid() for update;
  if not coalesce(v_member, false) then raise exception 'members_only' using errcode = 'P0001'; end if;
  select * into v_item from public.shop_items where kind = p_kind and id = p_id;
  if not found then raise exception 'bad_item' using errcode = 'P0001'; end if;
  if v_item.price = 0 or exists (select 1 from public.coin_spends where user_id = auth.uid() and kind = p_kind and item_id = p_id) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if public.coins_of(auth.uid()) < v_item.price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  insert into public.coin_spends (user_id, kind, item_id, coins) values (auth.uid(), p_kind, p_id, v_item.price);
  return public.coins_of(auth.uid());
end;
$$;

create or replace function public.equip(p_kind text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_wear(auth.uid(), p_kind, p_id) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  update public.profiles set cosmetics = cosmetics || jsonb_build_object(p_kind, p_id) where id = auth.uid();
  return public.look_of(auth.uid());
end;
$$;

-- the signed-in user, for the app header and passport
create or replace function public.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('member', pr.member_since is not null, 'xp', pr.xp, 'plus_until', pr.plus_until,
           'nickname', pr.nickname, 'colour', pr.colour, 'friend_code', pr.friend_code, 'on_leaderboard', pr.on_leaderboard,
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)),
           'owned', coalesce((select jsonb_agg(s.kind || ':' || s.item_id) from public.coin_spends s where s.user_id = pr.id), '[]'))
    from public.profiles pr where pr.id = auth.uid()
$$;

-- ---------- friends ----------
create table public.friend_requests (
  from_id uuid not null references auth.users on delete cascade,
  to_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id)
);
create table public.friendships (
  a uuid not null references auth.users on delete cascade,
  b uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index friendships_b_idx on public.friendships (b);
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

create or replace function public.is_friend(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships where a = least(x, y) and b = greatest(x, y))
$$;

create or replace function public.add_friend(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_them uuid;
begin
  if (select nickname from public.profiles where id = v_me) is null then
    raise exception 'nickname_required' using errcode = 'P0001';
  end if;
  select id into v_them from public.profiles where friend_code = upper(trim(p_code));
  if v_them is null then raise exception 'code_not_found' using errcode = 'P0001'; end if;
  if v_them = v_me then raise exception 'own_code' using errcode = 'P0001'; end if;
  if public.is_friend(v_me, v_them) then return 'friends'; end if;
  -- they already asked: adding their code accepts it
  delete from public.friend_requests where from_id = v_them and to_id = v_me and created_at > now() - interval '7 days';
  if found then
    insert into public.friendships (a, b) values (least(v_me, v_them), greatest(v_me, v_them)) on conflict do nothing;
    return 'friends';
  end if;
  insert into public.friend_requests (from_id, to_id) values (v_me, v_them)
    on conflict (from_id, to_id) do update set created_at = now();
  return 'requested';
end;
$$;

create or replace function public.answer_friend(p_from uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friend_requests where from_id = p_from and to_id = auth.uid();
  if not found then raise exception 'no_request' using errcode = 'P0001'; end if;
  if p_accept then
    insert into public.friendships (a, b) values (least(p_from, auth.uid()), greatest(p_from, auth.uid())) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.remove_friend(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friendships where a = least(p_id, auth.uid()) and b = greatest(p_id, auth.uid());
  delete from public.friend_requests where (from_id = auth.uid() and to_id = p_id) or (from_id = p_id and to_id = auth.uid());
$$;

-- a public card for one user (nickname, colour, level, counts, look); never email, never photos
create or replace function public.card_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'nickname', coalesce(pr.nickname, 'Explorer'), 'colour', pr.colour,
           'xp', pr.xp, 'level', public.level_for(pr.xp),
           'stamps', (select count(*) from public.stamps where user_id = pr.id),
           'provinces', (select count(distinct province_id) from public.stamps where user_id = pr.id and province_id is not null),
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)))
    from public.profiles pr where pr.id = p_user
$$;
revoke execute on function public.card_of(uuid) from public, anon, authenticated;

create or replace function public.social() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(public.card_of(case when f.a = auth.uid() then f.b else f.a end) order by f.created_at desc)
                 from public.friendships f where auth.uid() in (f.a, f.b)), '[]'),
    'incoming', coalesce((select jsonb_agg(public.card_of(r.from_id) order by r.created_at desc)
                 from public.friend_requests r where r.to_id = auth.uid() and r.created_at > now() - interval '7 days'), '[]'),
    'outgoing', coalesce((select jsonb_agg(public.card_of(r.to_id) order by r.created_at desc)
                 from public.friend_requests r where r.from_id = auth.uid() and r.created_at > now() - interval '7 days'), '[]'))
$$;

-- a friend passport: stamps, photos (not hidden), provinces. Friends only.
create or replace function public.friend_passport(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_friend(auth.uid(), p_id) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'card', public.card_of(p_id),
    'stamps', coalesce((select jsonb_agg(jsonb_build_object(
                  'place_id', st.place_id, 'name', pl.name, 'name_th', pl.name_th, 'category', pl.category, 'tier', st.tier,
                  'province_id', st.province_id, 'event', st.event_slug, 'earned_at', st.earned_at) order by st.earned_at desc)
                from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_id), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
                  'checkin_id', ch.id, 'path', ch.selfie_path, 'caption', ch.caption, 'place', pl.name,
                  'province_id', pl.province_id, 'at', ch.created_at) order by ch.created_at desc)
                from public.checkins ch join public.places pl on pl.id = ch.place_id
               where ch.user_id = p_id and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden), '[]'),
    'provinces', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th,
                  'stamps', (select count(*) from public.stamps st where st.user_id = p_id and st.province_id = pv.id)))
                from public.provinces pv), '[]'));
end;
$$;

-- ---------- leaderboard (all time, by XP) ----------
create or replace function public.leaderboard() returns jsonb
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select pr.id, rank() over (order by pr.xp desc) as rnk
      from public.profiles pr where pr.on_leaderboard and pr.nickname is not null and pr.xp > 0
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(public.card_of(t.id) || jsonb_build_object('rank', t.rnk) order by t.rnk, t.id)
             from (select * from ranked order by rnk, id limit 50) t), '[]'),
    'me', (select public.card_of(r.id) || jsonb_build_object('rank', r.rnk) from ranked r where r.id = auth.uid()),
    'total', (select count(*) from ranked))
$$;

-- ---------- ride along ----------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default public.new_code(6),
  owner uuid not null references auth.users on delete cascade,
  name text check (char_length(name) <= 40),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '12 hours',
  ended_at timestamptz
);
create table public.trip_members (
  trip_id uuid not null references public.trips on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  lat float8,
  lng float8,
  seen_at timestamptz,
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;

create or replace function public.active_trip(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.trips t join public.trip_members m on m.trip_id = t.id
   where m.user_id = p_user and m.left_at is null and t.ended_at is null and t.ends_at > now()
   order by t.started_at desc limit 1
$$;
revoke execute on function public.active_trip(uuid) from public, anon, authenticated;

-- live positions exist only while a trip runs
create or replace function public.wipe_trip_positions() returns void
language sql security definer set search_path = '' as $$
  update public.trip_members m set lat = null, lng = null
   where m.lat is not null
     and (m.left_at is not null or exists (select 1 from public.trips t where t.id = m.trip_id and (t.ended_at is not null or t.ends_at <= now())))
$$;
revoke execute on function public.wipe_trip_positions() from public, anon, authenticated;

create or replace function public.leave_trip() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.trip_members set left_at = now() where user_id = auth.uid() and left_at is null;
  -- the owner leaving ends the trip for everyone
  update public.trips set ended_at = now() where owner = auth.uid() and ended_at is null;
  perform public.wipe_trip_positions();
end;
$$;

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
                join public.checkins ch on ch.user_id = m.user_id and ch.created_at between v_trip.started_at and v_trip.ends_at
                join public.places pl on pl.id = ch.place_id
                join public.profiles pr on pr.id = m.user_id
               where m.trip_id = v_trip.id and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden), '[]'));
end;
$$;

create or replace function public.start_trip(p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.leave_trip();
  insert into public.trips (owner, name) values (auth.uid(), left(nullif(trim(p_name), ''), 40)) returning id into v_id;
  insert into public.trip_members (trip_id, user_id) values (v_id, auth.uid());
  return public.my_trip();
end;
$$;

create or replace function public.join_trip(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.trips where code = upper(trim(p_code)) and ended_at is null and ends_at > now();
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

create or replace function public.trip_ping(p_lat float8, p_lng float8) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'bad_position' using errcode = 'P0001'; end if;
  update public.trip_members set lat = p_lat, lng = p_lng, seen_at = now()
   where trip_id = public.active_trip(auth.uid()) and user_id = auth.uid();
end;
$$;

-- ---------- photos: friends and trip-mates can open them (not hidden, not rejected) ----------
create or replace function public.can_see_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.checkins c
     where c.selfie_path = p_path and not c.photo_hidden and c.status <> 'rejected'
       and (public.is_friend(auth.uid(), c.user_id)
            or exists (select 1 from public.trips t
                         join public.trip_members a on a.trip_id = t.id and a.user_id = auth.uid()
                         join public.trip_members b on b.trip_id = t.id and b.user_id = c.user_id
                        where c.created_at between t.started_at and t.ends_at)))
$$;
create policy "friends and trip-mates read photos" on storage.objects for select to authenticated
  using (bucket_id = 'selfies' and public.can_see_photo(name));

-- ---------- check-in v5 with the ride-along group bonus ----------
alter table public.stamps add column group_bonus boolean not null default false;

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
      v_group := exists (select 1 from public.trip_members m join public.checkins c on c.user_id = m.user_id
                          where m.trip_id = v_trip and m.left_at is null and m.user_id <> p_user
                            and c.place_id = p_place and c.status = 'approved' and c.created_at > now() - interval '60 minutes');
    end if;
    if v_group then
      v_xp := round(v_xp * 1.5); v_coins := round(v_coins * 1.5);
      for b in
        select st.user_id, round(st.xp * 0.5)::int as add_xp, round(st.coins * 0.5)::int as add_coins
          from public.stamps st join public.trip_members m on m.user_id = st.user_id
         where m.trip_id = v_trip and m.left_at is null and st.user_id <> p_user
           and st.place_id = p_place and not st.group_bonus and st.earned_at > now() - interval '60 minutes'
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

-- ---------- grants: signed-in users (guests included) only ----------
revoke execute on function public.set_me(text, text, boolean), public.buy_item(text, text), public.equip(text, text), public.me(),
  public.add_friend(text), public.answer_friend(uuid, boolean), public.remove_friend(uuid), public.social(),
  public.friend_passport(uuid), public.leaderboard(), public.leave_trip(), public.my_trip(), public.start_trip(text),
  public.join_trip(text), public.trip_ping(float8, float8) from public, anon;
grant execute on function public.set_me(text, text, boolean), public.buy_item(text, text), public.equip(text, text), public.me(),
  public.add_friend(text), public.answer_friend(uuid, boolean), public.remove_friend(uuid), public.social(),
  public.friend_passport(uuid), public.leaderboard(), public.leave_trip(), public.my_trip(), public.start_trip(text),
  public.join_trip(text), public.trip_ping(float8, float8) to authenticated;
revoke execute on function public.can_wear(uuid, text, text), public.look_of(uuid), public.is_friend(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_see_photo(text) to authenticated;
