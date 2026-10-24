-- Gamify polish: a profile showcase, themed shop sets with a set discount, a daily shop shelf, and comments on feed posts.
-- Re-runnable: everything is "if not exists", "on conflict" or "create or replace".

-- 1. Showcase: up to 3 badges or stamps pinned under the profile hero.
alter table public.profiles add column if not exists showcase jsonb not null default '[]';

create or replace function public.set_showcase(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e jsonb;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 3 then raise exception 'bad_showcase' using errcode = 'P0001'; end if;
  for e in select * from jsonb_array_elements(p) loop
    if e->>'type' = 'badge' then
      if not exists (select 1 from jsonb_array_elements(public.achievements(auth.uid())) b
                      where b->>'slug' = e->>'id' and (b->>'tier')::int > 0) then
        raise exception 'not_earned' using errcode = 'P0001';
      end if;
    elsif e->>'type' = 'stamp' then
      if (e->>'id') !~ '^\d{1,12}$' or not exists (select 1 from public.stamps where user_id = auth.uid() and place_id = (e->>'id')::bigint) then
        raise exception 'not_earned' using errcode = 'P0001';
      end if;
    else
      raise exception 'bad_showcase' using errcode = 'P0001';
    end if;
  end loop;
  update public.profiles set showcase = (select coalesce(jsonb_agg(jsonb_build_object('type', x->>'type', 'id', x->>'id')), '[]')
                                           from jsonb_array_elements(p) x)
   where id = auth.uid();
  return p;
end;
$$;

-- the pinned items, ready to draw (badges with their tier, stamps with the place)
create or replace function public.showcase_of(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(v order by n) filter (where v is not null), '[]') from (
    select n, case e->>'type'
             when 'badge' then (select b || jsonb_build_object('type', 'badge') from jsonb_array_elements(public.achievements(p_user)) b
                                 where b->>'slug' = e->>'id' and (b->>'tier')::int > 0)
             else (select jsonb_build_object('type', 'stamp', 'id', st.place_id, 'name', pl.name, 'name_th', pl.name_th, 'tier', st.tier,
                            'earned_at', st.earned_at, 'province', pv.name_en)
                     from public.stamps st join public.places pl on pl.id = st.place_id left join public.provinces pv on pv.id = st.province_id
                    where st.user_id = p_user and st.place_id = (e->>'id')::bigint) end as v
      from public.profiles pr, jsonb_array_elements(pr.showcase) with ordinality as x(e, n)
     where pr.id = p_user) s
$$;

create or replace function public.profile_of(p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_pr public.profiles; v_bxp int;
begin
  if p_id <> auth.uid() and not public.is_friend(auth.uid(), p_id) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  select * into v_pr from public.profiles where id = p_id;
  v_bxp := public.board_xp(p_id);
  return public.card_of(p_id) || jsonb_build_object(
    'friend_code', case when p_id = auth.uid() then v_pr.friend_code end,
    'photos', (select count(*) from public.checkins where user_id = p_id and status <> 'rejected' and selfie_path is not null and not photo_hidden),
    'friends', (select count(*) from public.friendships where p_id in (a, b)),
    'rank', case when v_pr.on_leaderboard and v_pr.nickname is not null and v_bxp > 0 then
              (select count(*) + 1 from public.profiles o where o.on_leaderboard and o.nickname is not null and o.xp > 0
                 and public.board_xp(o.id) > v_bxp) end,
    'badges', public.achievements(p_id),
    'showcase', public.showcase_of(p_id));
end;
$function$;

-- 2. Themed sets: cosmetics that go together. Buying the set costs 25% less than its missing items one by one.
insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort, gacha_only) values
  ('theme', 'songkran', 'Songkran splash', 'สาดน้ำสงกรานต์', 300, false, 10, false),
  ('frame', 'splash', 'Water splash', 'ละอองน้ำ', 200, false, 10, false),
  ('flair', 'splash', 'Splash', 'สาดน้ำ', 150, false, 10, false),
  ('title', 'water-warrior', 'Water warrior', 'นักรบสายน้ำ', 200, false, 10, false),
  ('avatar', 'glasses:goggles', 'Swim goggles', 'แว่นว่ายน้ำ', 150, false, 20, false),
  ('theme', 'krathong', 'Loy Krathong night', 'คืนลอยกระทง', 350, false, 11, false),
  ('frame', 'lantern', 'Lantern glow', 'แสงโคม', 250, false, 11, false),
  ('flair', 'lantern', 'Lantern', 'โคมลอย', 200, false, 11, false),
  ('title', 'moon-wanderer', 'Full-moon wanderer', 'นักเดินทางคืนเพ็ญ', 250, false, 11, false),
  ('avatar', 'bg:lanterns', 'Sky lanterns', 'โคมลอยฟ้า', 300, false, 21, false),
  ('theme', 'mudmee', 'Mudmee silk', 'ผ้าไหมมัดหมี่', 350, false, 12, false),
  ('frame', 'mudmee', 'Silk border', 'ขอบผ้าไหม', 250, false, 12, false),
  ('flair', 'silk', 'Silk', 'ไหมอีสาน', 200, false, 12, false),
  ('title', 'isan-soul', 'Isan soul', 'จิตวิญญาณอีสาน', 250, false, 12, false),
  ('avatar', 'outfit:mudmee', 'Mudmee shirt', 'เสื้อมัดหมี่', 300, false, 22, false)
on conflict (kind, id) do nothing;
insert into public.avatar_parts (slot, id) values ('glasses', 'goggles'), ('bg', 'lanterns'), ('outfit', 'mudmee') on conflict do nothing;

create table if not exists public.shop_sets (
  id text primary key, name_en text not null, name_th text not null, blurb_en text not null,
  items text[] not null,   -- "kind:id", e.g. "theme:songkran", "avatar:glasses:goggles"
  sort int not null default 0);
alter table public.shop_sets enable row level security;
drop policy if exists "shop sets are public" on public.shop_sets;
create policy "shop sets are public" on public.shop_sets for select using (true);
insert into public.shop_sets (id, name_en, name_th, blurb_en, items, sort) values
  ('songkran', 'Songkran', 'สงกรานต์', 'Thai New Year water fight, head to toe.',
   array['theme:songkran', 'frame:splash', 'flair:splash', 'title:water-warrior', 'avatar:glasses:goggles'], 1),
  ('loy-krathong', 'Loy Krathong', 'ลอยกระทง', 'Candles on the river and lanterns in the sky.',
   array['theme:krathong', 'frame:lantern', 'flair:lantern', 'title:moon-wanderer', 'avatar:bg:lanterns'], 2),
  ('isan-silk', 'Isan Silk', 'ผ้าไหมอีสาน', 'Hand-tied mudmee patterns from the northeast.',
   array['theme:mudmee', 'frame:mudmee', 'flair:silk', 'title:isan-soul', 'avatar:outfit:mudmee'], 3)
on conflict (id) do update set items = excluded.items, blurb_en = excluded.blurb_en;

-- a set's items you don't own yet, each at its set price (75%, rounded down)
create or replace function public.set_missing(p_user uuid, p_set text)
returns table (kind text, item_id text, coins int) language sql stable security definer set search_path = '' as $$
  select i.kind, i.id, (i.price * 3 / 4)::int
    from public.shop_sets s, unnest(s.items) x, public.shop_items i
   where s.id = p_set and i.kind = split_part(x, ':', 1) and i.id = substr(x, length(split_part(x, ':', 1)) + 2)
     and not public.can_wear(p_user, i.kind, i.id)
$$;

create or replace function public.buy_set(p_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_member boolean; v_price int;
begin
  select member_since is not null into v_member from public.profiles where id = auth.uid() for update;
  if not coalesce(v_member, false) then raise exception 'members_only' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.shop_sets where id = p_id) then raise exception 'bad_item' using errcode = 'P0001'; end if;
  select coalesce(sum(coins), 0) into v_price from public.set_missing(auth.uid(), p_id);
  if v_price = 0 then raise exception 'already_owned' using errcode = 'P0001'; end if;
  if public.coins_of(auth.uid()) < v_price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  insert into public.coin_spends (user_id, kind, item_id, coins) select auth.uid(), kind, item_id, coins from public.set_missing(auth.uid(), p_id);
  return public.coins_of(auth.uid());
end;
$$;

-- 3. The shop's front: this week's featured set (with your price) and 6 daily picks, the same for everyone, new at midnight in Bangkok.
create or replace function public.shop_today()
returns jsonb language sql stable security definer set search_path = '' as $$
  with d as (select (now() at time zone 'Asia/Bangkok')::date as day)
  select jsonb_build_object(
    'ends', ((select day from d) + 1)::timestamp at time zone 'Asia/Bangkok',
    'picks', (select jsonb_agg(jsonb_build_object('kind', kind, 'id', id)) from (
                select i.kind, i.id from public.shop_items i, d
                 where i.price > 0 and not i.plus and not i.gacha_only
                 order by md5(i.kind || i.id || d.day::text) limit 6) p),
    'sets', (select jsonb_agg(jsonb_build_object('id', s.id, 'name_en', s.name_en, 'name_th', s.name_th, 'blurb_en', s.blurb_en,
                     'items', to_jsonb(s.items),
                     'full', (select coalesce(sum(i.price), 0) from unnest(s.items) x join public.shop_items i
                               on i.kind = split_part(x, ':', 1) and i.id = substr(x, length(split_part(x, ':', 1)) + 2)),
                     'price', (select coalesce(sum(coins), 0) from public.set_missing(auth.uid(), s.id)))
                   order by md5(s.id || extract(week from d.day)::text)) from public.shop_sets s, d))
$$;

-- 4. Comments on feed posts: friends only (same as seeing the post), 280 characters, 30 a day.
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  activity_id bigint not null references public.activity(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now());
create index if not exists comments_activity on public.comments (activity_id, created_at);
create index if not exists comments_user on public.comments (user_id, created_at);
alter table public.comments enable row level security;   -- no policies: only through the functions below

alter table public.activity drop constraint if exists activity_kind_check;
alter table public.activity add constraint activity_kind_check
  check (kind in ('stamp', 'province', 'level', 'challenge', 'badge', 'nudge', 'fortune', 'comment'));

-- nudges and comment notices are seen only by the two people involved
create or replace function public.can_see_activity(p_row public.activity)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case when p_row.kind in ('nudge', 'comment') then auth.uid() in (p_row.user_id, (p_row.data->>'to')::uuid)
              else p_row.user_id = auth.uid() or public.is_friend(auth.uid(), p_row.user_id) end
$function$;

create or replace function public.comment(p_activity bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.activity; v_body text := btrim(coalesce(p_body, '')); v_id bigint;
begin
  select * into v_row from public.activity where id = p_activity;
  if not found or v_row.kind in ('nudge', 'comment') or not public.can_see_activity(v_row) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if char_length(v_body) not between 1 and 280 then raise exception 'bad_comment' using errcode = 'P0001'; end if;
  if (select count(*) from public.comments where user_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'comment_limit' using errcode = 'P0001';
  end if;
  insert into public.comments (activity_id, user_id, body) values (p_activity, auth.uid(), v_body) returning id into v_id;
  if v_row.user_id <> auth.uid() then   -- tell the poster
    insert into public.activity (user_id, kind, data)
    values (auth.uid(), 'comment', jsonb_build_object('to', v_row.user_id, 'on', p_activity, 'what', v_row.kind, 'body', left(v_body, 80)));
  end if;
  return jsonb_build_object('id', v_id, 'body', v_body, 'at', now(), 'mine', true, 'who', public.who_of(auth.uid()));
end;
$$;

create or replace function public.comments_of(p_activity bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.activity;
begin
  select * into v_row from public.activity where id = p_activity;
  if not found or not public.can_see_activity(v_row) then raise exception 'not_found' using errcode = 'P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at,
            'mine', c.user_id = auth.uid(), 'who', public.who_of(c.user_id)) order by c.created_at), '[]')
            from public.comments c where c.activity_id = p_activity);
end;
$$;

-- the comment's author or the post's owner can delete it
create or replace function public.delete_comment(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments c using public.activity a
   where c.id = p_id and a.id = c.activity_id and auth.uid() in (c.user_id, a.user_id);
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.feed(p_scope text default 'all'::text)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with mine as (
    select auth.uid() as id
    union select case when f.a = auth.uid() then f.b else f.a end from public.friendships f where auth.uid() in (f.a, f.b)
  )
  select coalesce(jsonb_agg(item order by at desc), '[]') from (
    select a.created_at as at, jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'at', a.created_at, 'data', a.data, 'mine', a.user_id = auth.uid(),
      'who', public.who_of(a.user_id),
      'to', case when a.kind in ('nudge', 'comment') then public.who_of((a.data->>'to')::uuid) end,
      'place', (select jsonb_build_object('id', pl.id, 'name', pl.name, 'name_th', pl.name_th, 'category', pl.category, 'tier', pl.tier)
                  from public.places pl where pl.id = a.place_id),
      'province', (select jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th)
                     from public.provinces pv where pv.id = a.province_id),
      'photo', (select ch.selfie_path from public.checkins ch where ch.id = a.checkin_id and not ch.photo_hidden and ch.status <> 'rejected'),
      'caption', (select ch.caption from public.checkins ch where ch.id = a.checkin_id and not ch.photo_hidden),
      'reactions', coalesce((select jsonb_object_agg(emoji, n) from (select emoji, count(*) n from public.reactions r where r.activity_id = a.id group by emoji) x), '{}'),
      'my_reaction', (select emoji from public.reactions r where r.activity_id = a.id and r.user_id = auth.uid()),
      'comments', (select count(*) from public.comments c where c.activity_id = a.id)) as item
      from public.activity a
     where a.created_at > now() - interval '30 days'
       and a.user_id in (select id from mine)
       and public.can_see_activity(a)
       and (p_scope = 'all' or (p_scope = 'me' and a.user_id = auth.uid()) or (p_scope = 'friends' and a.user_id <> auth.uid()))
     order by a.created_at desc limit 60) f
$function$;

revoke all on function public.set_missing(uuid, text) from public, anon, authenticated;
revoke all on function public.showcase_of(uuid) from public, anon, authenticated;
grant execute on function public.set_showcase(jsonb), public.buy_set(text), public.shop_today(), public.comment(bigint, text),
  public.comments_of(bigint), public.delete_comment(bigint) to authenticated;
revoke execute on function public.set_showcase(jsonb), public.buy_set(text), public.shop_today(), public.comment(bigint, text),
  public.comments_of(bigint), public.delete_comment(bigint) from anon, public;
