-- Duolingo-grade shell: avatar builder, activity feed with reactions, achievement badges, friends quest, profiles.

-- ---------- avatar ----------
alter table public.profiles add column avatar jsonb not null default '{}';

-- every part id the web avatar builder can draw (web/src/app/avatar/parts.tsx); premium ones are also shop items
create table public.avatar_parts (slot text not null, id text not null, primary key (slot, id));
alter table public.avatar_parts enable row level security;
create policy "avatar parts are public" on public.avatar_parts for select using (true);
insert into public.avatar_parts (slot, id) values
  ('bg', 'sky'),
  ('bg', 'mint'),
  ('bg', 'peach'),
  ('bg', 'lilac'),
  ('bg', 'butter'),
  ('bg', 'rose'),
  ('bg', 'sand'),
  ('bg', 'teal'),
  ('bg', 'navy'),
  ('bg', 'grey'),
  ('bg', 'sunset'),
  ('bg', 'temple'),
  ('skin', 's1'),
  ('skin', 's2'),
  ('skin', 's3'),
  ('skin', 's4'),
  ('skin', 's5'),
  ('skin', 's6'),
  ('skin', 's7'),
  ('skin', 's8'),
  ('face', 'round'),
  ('face', 'oval'),
  ('face', 'square'),
  ('eyes', 'dots'),
  ('eyes', 'happy'),
  ('eyes', 'wide'),
  ('eyes', 'sleepy'),
  ('eyes', 'wink'),
  ('brows', 'soft'),
  ('brows', 'bold'),
  ('brows', 'none'),
  ('mouth', 'smile'),
  ('mouth', 'grin'),
  ('mouth', 'small'),
  ('mouth', 'laugh'),
  ('mouth', 'neutral'),
  ('hair', 'short'),
  ('hair', 'side-part'),
  ('hair', 'buzz'),
  ('hair', 'curly'),
  ('hair', 'bun'),
  ('hair', 'long'),
  ('hair', 'bob'),
  ('hair', 'ponytail'),
  ('hair', 'afro'),
  ('hair', 'none'),
  ('hair', 'mohawk'),
  ('hair_colour', 'black'),
  ('hair_colour', 'dark-brown'),
  ('hair_colour', 'brown'),
  ('hair_colour', 'auburn'),
  ('hair_colour', 'blonde'),
  ('hair_colour', 'platinum'),
  ('hair_colour', 'grey'),
  ('hair_colour', 'pink'),
  ('hair_colour', 'blue'),
  ('hair_colour', 'green'),
  ('facial_hair', 'none'),
  ('facial_hair', 'stubble'),
  ('facial_hair', 'moustache'),
  ('facial_hair', 'beard'),
  ('glasses', 'none'),
  ('glasses', 'round'),
  ('glasses', 'square'),
  ('glasses', 'sunglasses'),
  ('glasses', 'aviator'),
  ('glasses', 'heart'),
  ('glasses', 'star'),
  ('headwear', 'none'),
  ('headwear', 'cap'),
  ('headwear', 'beanie'),
  ('headwear', 'bucket'),
  ('headwear', 'headband'),
  ('headwear', 'flower'),
  ('headwear', 'ngob'),
  ('headwear', 'helmet'),
  ('headwear', 'crown'),
  ('headwear', 'mongkol'),
  ('headwear', 'flower-crown'),
  ('outfit', 'tshirt'),
  ('outfit', 'hoodie'),
  ('outfit', 'collared'),
  ('outfit', 'tank'),
  ('outfit', 'jacket'),
  ('outfit', 'scarf'),
  ('outfit', 'striped'),
  ('outfit', 'overalls'),
  ('outfit', 'pha-khao-ma'),
  ('outfit', 'muay-thai'),
  ('outfit', 'hawaiian'),
  ('outfit', 'raincoat'),
  ('outfit_colour', 'indigo'),
  ('outfit_colour', 'marigold'),
  ('outfit_colour', 'red'),
  ('outfit_colour', 'green'),
  ('outfit_colour', 'sky'),
  ('outfit_colour', 'pink'),
  ('outfit_colour', 'purple'),
  ('outfit_colour', 'black'),
  ('outfit_colour', 'white'),
  ('outfit_colour', 'khaki');

alter table public.shop_items drop constraint shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check check (kind in ('theme', 'flair', 'map', 'frame', 'title', 'avatar'));
insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort) values
  ('avatar', 'bg:sunset', 'Sunset sky', 'ฟ้ายามเย็น', 150, false, 0),
  ('avatar', 'bg:temple', 'Temple gold', 'ทองวัด', 300, false, 1),
  ('avatar', 'hair:mohawk', 'Mohawk', 'ทรงโมฮอว์ก', 150, false, 2),
  ('avatar', 'glasses:aviator', 'Aviators', 'แว่นนักบิน', 200, false, 3),
  ('avatar', 'glasses:heart', 'Heart glasses', 'แว่นหัวใจ', 150, false, 4),
  ('avatar', 'glasses:star', 'Star glasses', 'แว่นดาว', 150, false, 5),
  ('avatar', 'headwear:ngob', 'Straw ngob hat', 'งอบ', 200, false, 6),
  ('avatar', 'headwear:helmet', 'Moto helmet', 'หมวกกันน็อก', 150, false, 7),
  ('avatar', 'headwear:crown', 'Crown', 'มงกุฎ', 500, false, 8),
  ('avatar', 'headwear:mongkol', 'Mongkol', 'มงคล', 250, false, 9),
  ('avatar', 'headwear:flower-crown', 'Flower crown', 'มงกุฎดอกไม้', 250, false, 10),
  ('avatar', 'outfit:pha-khao-ma', 'Pha khao ma', 'ผ้าขาวม้า', 200, false, 11),
  ('avatar', 'outfit:muay-thai', 'Muay Thai', 'มวยไทย', 300, false, 12),
  ('avatar', 'outfit:hawaiian', 'Flower shirt', 'เสื้อลายดอก', 150, false, 13),
  ('avatar', 'outfit:raincoat', 'Raincoat', 'เสื้อกันฝน', 100, false, 14);

create or replace function public.set_avatar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'bad_avatar' using errcode = 'P0001'; end if;
  for e in select * from jsonb_each_text(p) loop
    if not exists (select 1 from public.avatar_parts where slot = e.key and id = e.value) then
      raise exception 'bad_avatar' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.shop_items where kind = 'avatar' and id = e.key || ':' || e.value)
       and not public.can_wear(auth.uid(), 'avatar', e.key || ':' || e.value) then
      raise exception 'not_owned' using errcode = 'P0001';
    end if;
  end loop;
  update public.profiles set avatar = p where id = auth.uid();
  return p;
end;
$$;

-- avatar parts are worn through the builder, not equip
create or replace function public.equip(p_kind text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'avatar' then raise exception 'use_builder' using errcode = 'P0001'; end if;
  if not public.can_wear(auth.uid(), p_kind, p_id) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  update public.profiles set cosmetics = cosmetics || jsonb_build_object(p_kind, p_id) where id = auth.uid();
  return public.look_of(auth.uid());
end;
$$;

-- small person card for lists (feed, trip): no counts
create or replace function public.who_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'nickname', coalesce(pr.nickname, 'Explorer'), 'colour', pr.colour, 'avatar', pr.avatar,
           'level', public.level_for(pr.xp))
    from public.profiles pr where pr.id = p_user
$$;
revoke execute on function public.who_of(uuid) from public, anon, authenticated;

create or replace function public.card_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'nickname', coalesce(pr.nickname, 'Explorer'), 'colour', pr.colour, 'avatar', pr.avatar,
           'xp', pr.xp, 'level', public.level_for(pr.xp), 'joined', pr.created_at,
           'stamps', (select count(*) from public.stamps where user_id = pr.id),
           'provinces', (select count(distinct province_id) from public.stamps where user_id = pr.id and province_id is not null),
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)))
    from public.profiles pr where pr.id = p_user
$$;
revoke execute on function public.card_of(uuid) from public, anon, authenticated;

create or replace function public.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('member', pr.member_since is not null, 'xp', pr.xp, 'plus_until', pr.plus_until,
           'nickname', pr.nickname, 'colour', pr.colour, 'friend_code', pr.friend_code, 'on_leaderboard', pr.on_leaderboard,
           'avatar', pr.avatar, 'joined', pr.created_at, 'coins', public.coins_of(pr.id),
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)),
           'owned', coalesce((select jsonb_agg(s.kind || ':' || s.item_id) from public.coin_spends s where s.user_id = pr.id), '[]'))
    from public.profiles pr where pr.id = auth.uid()
$$;

-- ---------- achievements (computed; tiers I to V) ----------
create or replace function public.achievements(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select
      (select count(distinct province_id) from public.stamps where user_id = p_user and province_id is not null)::int as provinces,
      (select count(*) from public.stamps where user_id = p_user and tier = 3)::int as landmarks,
      (select count(*) from public.stamps where user_id = p_user)::int as stamps,
      (select count(*) from public.checkins where user_id = p_user and status <> 'rejected' and selfie_path is not null)::int as photos,
      (select count(*) from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user and pl.category = 'food')::int as food,
      (select count(*) from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user and pl.category = 'temple')::int as temples,
      (select count(*) from public.friendships where p_user in (a, b))::int as friends,
      (select count(distinct m.trip_id) from public.trip_members m
        where m.user_id = p_user and exists (select 1 from public.trip_members o where o.trip_id = m.trip_id and o.user_id <> p_user))::int as crew,
      (select count(*) from public.challenge_claims where user_id = p_user)::int as quests,
      (select public.level_for(xp) from public.profiles where id = p_user) as lvl
  ),
  b (slug, name_en, name_th, icon, val, goals, ord) as (
    select 'province-hopper', 'Province Hopper', 'นักเก็บจังหวัด', 'map', provinces, array[1, 5, 15, 40, 77], 1 from v union all
    select 'landmark-hunter', 'Landmark Hunter', 'นักล่าแลนด์มาร์ก', 'landmark', landmarks, array[1, 5, 15, 40, 100], 2 from v union all
    select 'collector', 'Collector', 'นักสะสม', 'stamp', stamps, array[5, 25, 75, 200, 500], 3 from v union all
    select 'shutterbug', 'Shutterbug', 'ตากล้อง', 'camera', photos, array[1, 10, 50, 150, 400], 4 from v union all
    select 'foodie', 'Foodie', 'นักชิม', 'utensils', food, array[1, 10, 30, 75, 150], 5 from v union all
    select 'temple-runner', 'Temple Runner', 'สายบุญ', 'temple', temples, array[1, 10, 30, 75, 150], 6 from v union all
    select 'social-butterfly', 'Social Butterfly', 'ผีเสื้อสังคม', 'users', friends, array[1, 3, 10, 25, 50], 7 from v union all
    select 'road-crew', 'Road Crew', 'แก๊งโรดทริป', 'car', crew, array[1, 3, 10, 25, 50], 8 from v union all
    select 'quest-master', 'Quest Master', 'เจ้าแห่งเควสต์', 'trophy', quests, array[5, 25, 100, 250, 500], 9 from v union all
    select 'high-flyer', 'High Flyer', 'เลเวลสูง', 'star', lvl, array[2, 4, 6, 8, 10], 10 from v
  )
  select jsonb_agg(jsonb_build_object('slug', slug, 'name_en', name_en, 'name_th', name_th, 'icon', icon, 'value', val,
           'tier', (select count(*) from unnest(goals) g where val >= g), 'goals', to_jsonb(goals),
           'next', goals[least(5, 1 + (select count(*) from unnest(goals) g where val >= g))::int]) order by ord)
    from b
$$;
revoke execute on function public.achievements(uuid) from public, anon, authenticated;

-- ---------- activity feed + reactions ----------
create table public.activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('stamp', 'province', 'level', 'challenge', 'badge', 'nudge')),
  place_id bigint references public.places on delete set null,
  province_id smallint references public.provinces,
  checkin_id uuid references public.checkins on delete set null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_user_time_idx on public.activity (user_id, created_at desc);
alter table public.activity enable row level security;

create table public.reactions (
  activity_id bigint not null references public.activity on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  emoji text not null check (emoji in ('heart', 'fire', 'clap', 'wow')),
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);
alter table public.reactions enable row level security;

-- the feed starts with the stamps already collected
insert into public.activity (user_id, kind, place_id, province_id, checkin_id, data, created_at)
select st.user_id, 'stamp', st.place_id, st.province_id, st.checkin_id, jsonb_build_object('tier', st.tier), st.earned_at from public.stamps st;
insert into public.activity (user_id, kind, place_id, province_id, checkin_id, created_at)
select distinct on (st.user_id, st.province_id) st.user_id, 'province', st.place_id, st.province_id, st.checkin_id, st.earned_at
  from public.stamps st where st.province_id is not null order by st.user_id, st.province_id, st.earned_at;

-- can the signed-in user see this activity row: their own, or a friend (nudges: only sender and receiver)
create or replace function public.can_see_activity(p_row public.activity) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_row.kind = 'nudge' then auth.uid() in (p_row.user_id, (p_row.data->>'to')::uuid)
              else p_row.user_id = auth.uid() or public.is_friend(auth.uid(), p_row.user_id) end
$$;
revoke execute on function public.can_see_activity(public.activity) from public, anon, authenticated;

create or replace function public.feed(p_scope text default 'all') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(item order by at desc), '[]') from (
    select a.created_at as at, jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'at', a.created_at, 'data', a.data, 'mine', a.user_id = auth.uid(),
      'who', public.who_of(a.user_id),
      'to', case when a.kind = 'nudge' then public.who_of((a.data->>'to')::uuid) end,
      'place', (select jsonb_build_object('id', pl.id, 'name', pl.name, 'name_th', pl.name_th, 'category', pl.category, 'tier', pl.tier)
                  from public.places pl where pl.id = a.place_id),
      'province', (select jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th)
                     from public.provinces pv where pv.id = a.province_id),
      'photo', (select ch.selfie_path from public.checkins ch where ch.id = a.checkin_id and not ch.photo_hidden and ch.status <> 'rejected'),
      'caption', (select ch.caption from public.checkins ch where ch.id = a.checkin_id and not ch.photo_hidden),
      'reactions', coalesce((select jsonb_object_agg(emoji, n) from (select emoji, count(*) n from public.reactions r where r.activity_id = a.id group by emoji) x), '{}'),
      'my_reaction', (select emoji from public.reactions r where r.activity_id = a.id and r.user_id = auth.uid())) as item
      from public.activity a
     where a.created_at > now() - interval '30 days'
       and public.can_see_activity(a)
       and (p_scope = 'all' or (p_scope = 'me' and a.user_id = auth.uid()) or (p_scope = 'friends' and a.user_id <> auth.uid()))
     order by a.created_at desc limit 60) f
$$;

create or replace function public.react(p_activity bigint, p_emoji text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.activity;
begin
  select * into v_row from public.activity where id = p_activity;
  if not found or not public.can_see_activity(v_row) then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_emoji is null then
    delete from public.reactions where activity_id = p_activity and user_id = auth.uid();
  elsif p_emoji not in ('heart', 'fire', 'clap', 'wow') then
    raise exception 'bad_emoji' using errcode = 'P0001';
  else
    insert into public.reactions (activity_id, user_id, emoji) values (p_activity, auth.uid(), p_emoji)
      on conflict (activity_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end;
$$;

create or replace function public.nudge(p_friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_friend(auth.uid(), p_friend) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  if exists (select 1 from public.activity where user_id = auth.uid() and kind = 'nudge' and data->>'to' = p_friend::text
               and created_at > now() - interval '20 hours') then
    raise exception 'already_nudged' using errcode = 'P0001';
  end if;
  insert into public.activity (user_id, kind, data) values (auth.uid(), 'nudge', jsonb_build_object('to', p_friend));
end;
$$;

-- ---------- friends quest (weekly pair) ----------
create table public.friend_quests (
  week_key text not null,
  a uuid not null references auth.users on delete cascade,
  b uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (week_key, a)
);
alter table public.friend_quests enable row level security;

create or replace function public.set_friend_quest(p_friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_week text := to_char(now() at time zone 'Asia/Bangkok', 'IYYY-IW');
begin
  if not public.is_friend(auth.uid(), p_friend) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  if exists (select 1 from public.friend_quests where week_key = v_week and a in (auth.uid(), p_friend)) then
    raise exception 'already_paired' using errcode = 'P0001';
  end if;
  insert into public.friend_quests (week_key, a, b) values (v_week, auth.uid(), p_friend), (v_week, p_friend, auth.uid());
end;
$$;

-- this week: partner and the shared progress (null when unpaired)
create or replace function public.friend_quest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('partner', public.who_of(fq.b), 'week', fq.week_key,
           'me', (select count(*) from public.stamps st where st.user_id = auth.uid()
                    and (st.earned_at at time zone 'Asia/Bangkok') >= date_trunc('week', now() at time zone 'Asia/Bangkok')),
           'them', (select count(*) from public.stamps st where st.user_id = fq.b
                    and (st.earned_at at time zone 'Asia/Bangkok') >= date_trunc('week', now() at time zone 'Asia/Bangkok')))
    from public.friend_quests fq
   where fq.a = auth.uid() and fq.week_key = to_char(now() at time zone 'Asia/Bangkok', 'IYYY-IW')
$$;

create or replace function public.challenge_progress(p_user uuid)
returns table (slug text, kind text, title_en text, title_th text, have int, need int, xp int, coins int, period text, claimed boolean)
language sql stable set search_path = '' as $$
  with now_bkk as (select (now() at time zone 'Asia/Bangkok') t),
  s as (
    select st.*, pl.category, lower(pl.name || ' ' || coalesce(pl.name_th, '')) nm, (st.earned_at at time zone 'Asia/Bangkok') bkk
      from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user
  ),
  wk as (select date_trunc('week', t) as week_start, to_char(t, 'IYYY-IW') as week_key, to_char(t, 'YYYY-MM-DD') as day_key from now_bkk),
  defs (slug, kind, title_en, title_th, have, need, xp, coins, period) as (
    select 'daily-checkin', 'daily', 'Check in somewhere today', 'เช็กอินสักที่วันนี้',
           (exists (select 1 from public.checkins c where c.user_id = p_user and c.status = 'approved'
                     and (c.created_at at time zone 'Asia/Bangkok')::date = (select t::date from now_bkk)))::int, 1, 30, 5, (select day_key from wk)
    union all
    select 'weekly-landmarks', 'weekly', 'Visit 3 landmarks this week', 'ไปแลนด์มาร์ก 3 แห่งในสัปดาห์นี้',
           (select count(*) from s where tier = 3 and bkk >= (select week_start from wk))::int, 3, 200, 40, (select week_key from wk)
    union all
    select 'weekly-new-kind', 'weekly', 'Try a kind of place new to you this week', 'ลองสถานที่ประเภทใหม่ในสัปดาห์นี้',
           (select count(*) from s where bkk >= (select week_start from wk)
              and not exists (select 1 from s s2 where s2.category = s.category and s2.bkk < (select week_start from wk)))::int,
           1, 100, 20, (select week_key from wk)
    union all
    select 'waterfalls-10', 'collection', '10 waterfalls', 'น้ำตก 10 แห่ง',
           (select count(*) from s where nm like '%waterfall%' or nm like '%น้ำตก%')::int, 10, 300, 60, 'all'
    union all
    select 'temples-20', 'collection', '20 temples', 'วัด 20 แห่ง', (select count(*) from s where category = 'temple')::int, 20, 300, 60, 'all'
    union all
    select 'national-parks-5', 'collection', '5 national parks', 'อุทยานแห่งชาติ 5 แห่ง',
           (select count(*) from s where category = 'park' and (nm like '%national park%' or nm like '%อุทยานแห่งชาติ%'))::int, 5, 300, 60, 'all'
    union all
    select 'museums-10', 'collection', '10 museums', 'พิพิธภัณฑ์ 10 แห่ง', (select count(*) from s where category = 'museum')::int, 10, 300, 60, 'all'
    union all
    select 'night-markets-5', 'collection', '5 night markets', 'ตลาดกลางคืน 5 แห่ง',
           (select count(*) from s where category = 'market'
              and (nm like '%night%' or nm like '%ตลาดนัด%' or nm like '%ตลาดโต้รุ่ง%' or nm like '%walking street%'))::int, 5, 300, 60, 'all'
    union all
    -- province sets: visit 5 of a provinces landmarks (all of them if it has fewer); shown once you have stamped there
    select 'province-' || pv.iso, 'province', pv.name_en || ' Explorer', 'นักสำรวจ' || pv.name_th,
           (select count(*) from s where s.province_id = pv.id and s.tier = 3)::int,
           least(5, (select count(*) from public.places pl where pl.province_id = pv.id and pl.tier = 3))::int, 500, 100, 'all'
      from public.provinces pv
     where exists (select 1 from s where s.province_id = pv.id)
       and exists (select 1 from public.places pl where pl.province_id = pv.id and pl.tier = 3)
    union all
    -- friends quest: you and your partner for the week, 10 new stamps between you
    select 'friend-quest', 'friend', 'Friends Quest: 10 stamps together', 'เควสต์เพื่อน: สะสม 10 แสตมป์ด้วยกัน',
           (select count(*) from public.stamps st where st.user_id in (p_user, fq.b)
              and (st.earned_at at time zone 'Asia/Bangkok') >= (select week_start from wk))::int, 10, 150, 40, (select week_key from wk)
      from public.friend_quests fq where fq.a = p_user and fq.week_key = (select week_key from wk)
  )
  select d.slug, d.kind, d.title_en, d.title_th, least(d.have, d.need), d.need, d.xp, d.coins, d.period,
         exists (select 1 from public.challenge_claims cc where cc.user_id = p_user and cc.slug = d.slug and cc.period = d.period)
    from defs d
$$;


-- claim finished quests now (the Quests tab opens the chests); rules stay in claim_challenges
create or replace function public.claim_quests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.claim_challenges(auth.uid()); ch jsonb;
begin
  for ch in select * from jsonb_array_elements(v) loop
    insert into public.activity (user_id, kind, data) values (auth.uid(), 'challenge', ch);
  end loop;
  return v;
end;
$$;

-- ---------- a profile page: me or a friend ----------
create or replace function public.profile_of(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_pr public.profiles;
begin
  if p_id <> auth.uid() and not public.is_friend(auth.uid(), p_id) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  select * into v_pr from public.profiles where id = p_id;
  return public.card_of(p_id) || jsonb_build_object(
    'friend_code', case when p_id = auth.uid() then v_pr.friend_code end,
    'photos', (select count(*) from public.checkins where user_id = p_id and status <> 'rejected' and selfie_path is not null and not photo_hidden),
    'friends', (select count(*) from public.friendships where p_id in (a, b)),
    'rank', case when v_pr.on_leaderboard and v_pr.nickname is not null and v_pr.xp > 0 then
              (select count(*) + 1 from public.profiles o where o.on_leaderboard and o.nickname is not null and o.xp > v_pr.xp) end,
    'badges', public.achievements(p_id));
end;
$$;

-- ---------- check-in v5: writes the feed and reports new badge tiers ----------
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
  if v_member and public.level_for(v_after) > public.level_for(v_before) then
    insert into public.activity (user_id, kind, data) values (p_user, 'level', jsonb_build_object('level', public.level_for(v_after)));
  end if;
  for ch in select * from jsonb_array_elements(v_challenges) loop
    insert into public.activity (user_id, kind, data) values (p_user, 'challenge', ch);
  end loop;
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
    'level_up', public.level_for(v_after) > public.level_for(v_before));
end;
$$;
revoke execute on function public.record_checkin_v5(uuid, bigint, float8, float8, float8, text, int, text, jsonb) from public, anon, authenticated;

-- ---------- grants ----------
revoke execute on function public.set_avatar(jsonb), public.feed(text), public.react(bigint, text), public.nudge(uuid),
  public.set_friend_quest(uuid), public.friend_quest(), public.claim_quests(), public.profile_of(uuid) from public, anon;
grant execute on function public.set_avatar(jsonb), public.feed(text), public.react(bigint, text), public.nudge(uuid),
  public.set_friend_quest(uuid), public.friend_quest(), public.claim_quests(), public.profile_of(uuid) to authenticated;
