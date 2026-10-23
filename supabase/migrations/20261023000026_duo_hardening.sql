-- Security review fixes for migration 024.

-- feed: only scan rows of me and my friends (index on time for the 30-day window)
create index activity_time_idx on public.activity (created_at desc);
create or replace function public.feed(p_scope text default 'all') returns jsonb
language sql stable security definer set search_path = '' as $$
  with mine as (
    select auth.uid() as id
    union select case when f.a = auth.uid() then f.b else f.a end from public.friendships f where auth.uid() in (f.a, f.b)
  )
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
       and a.user_id in (select id from mine)
       and public.can_see_activity(a)
       and (p_scope = 'all' or (p_scope = 'me' and a.user_id = auth.uid()) or (p_scope = 'friends' and a.user_id <> auth.uid()))
     order by a.created_at desc limit 60) f
$$;

-- friends quest: only stamps collected after pairing count, and only while still friends
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
           (select count(*) from public.stamps st where st.user_id in (p_user, fq.b) and st.earned_at >= fq.created_at)::int,
           10, 150, 40, (select week_key from wk)
      from public.friend_quests fq where fq.a = p_user and fq.week_key = (select week_key from wk) and public.is_friend(fq.a, fq.b)
  )
  select d.slug, d.kind, d.title_en, d.title_th, least(d.have, d.need), d.need, d.xp, d.coins, d.period,
         exists (select 1 from public.challenge_claims cc where cc.user_id = p_user and cc.slug = d.slug and cc.period = d.period)
    from defs d
$$;



create or replace function public.friend_quest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('partner', public.who_of(fq.b), 'week', fq.week_key,
           'me', (select count(*) from public.stamps st where st.user_id = auth.uid() and st.earned_at >= fq.created_at),
           'them', (select count(*) from public.stamps st where st.user_id = fq.b and st.earned_at >= fq.created_at))
    from public.friend_quests fq
   where fq.a = auth.uid() and fq.week_key = to_char(now() at time zone 'Asia/Bangkok', 'IYYY-IW') and public.is_friend(fq.a, fq.b)
$$;

-- nudge: serialise per pair so parallel calls cannot slip past the 20 h limit
create or replace function public.nudge(p_friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_friend(auth.uid(), p_friend) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_friend::text, 0));
  if exists (select 1 from public.activity where user_id = auth.uid() and kind = 'nudge' and data->>'to' = p_friend::text
               and created_at > now() - interval '20 hours') then
    raise exception 'already_nudged' using errcode = 'P0001';
  end if;
  insert into public.activity (user_id, kind, data) values (auth.uid(), 'nudge', jsonb_build_object('to', p_friend));
end;
$$;

-- set_avatar: refuse oversized payloads before expanding them
create or replace function public.set_avatar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if pg_column_size(p) > 1024 or jsonb_typeof(p) is distinct from 'object' then raise exception 'bad_avatar' using errcode = 'P0001'; end if;
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
