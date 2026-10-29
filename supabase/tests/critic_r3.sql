-- Migration 092: record_checkin locks the traveller first (parallel check-ins run one at a time) and never spins an example
-- shop's coupon; a demo check-in earns no new-province bonus shake and its shake never wins an XP boost; nomination
-- photos are purged 30 days after the nomination closes. Checked on the linked database inside a transaction that is
-- rolled back, so nothing is kept:
--   supabase db query --linked -f supabase/tests/critic_r3.sql
-- Every row of the result should read ok = true.
begin;
create temp table t_out (k text, ok boolean, v text);
insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000de721', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000de722', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000de723', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000de724', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000de725', 'authenticated', 'authenticated', false);
insert into public.profiles (id) select ('00000000-0000-4000-8000-0000000de72' || n)::uuid from generate_series(1, 5) n on conflict do nothing;
-- an example shop's coupon place, and a plain place in a province within 3 km of it
create temp table t_demo as
  select cp.shop_id, pl.location from public.coupons cp join public.shops s on s.id = cp.shop_id join public.places pl on pl.id = cp.place_id
   where s.is_demo and cp.active and public.shop_funded(s, pl.bid_thb) order by cp.id limit 1;
create temp table t_place as
  select p.id, extensions.st_y(p.location::extensions.geometry) as lat, extensions.st_x(p.location::extensions.geometry) as lng
    from public.places p, t_demo d
   where not p.is_partner and coalesce(p.min_level, 0) = 0 and p.shop_id is null and p.province_id is not null
     and extensions.st_dwithin(p.location, d.location, 2500)
   order by p.id limit 1;
insert into t_out select 'setup: example coupon and a plain place near it', count(*) = 1, null from t_place;

-- 1. the per-traveller lock is in the live body, and two check-ins in a row still behave: one stamp, XP once
insert into t_out values ('lock: record_checkin locks the profile row first',
  pg_get_functiondef('public.record_checkin'::regproc) like '%begin
  perform 1 from public.profiles where id = p_user for update;%', null);
do $$
declare p record; r1 jsonb; r2 jsonb; x1 int; x2 int;
begin
  select * into p from t_place;
  r1 := public.record_checkin_v5('00000000-0000-4000-8000-0000000de721', p.id, p.lat, p.lng, 5, '00000000-0000-4000-8000-0000000de721/a.jpg', 0, null, '{}');
  select xp into x1 from public.profiles where id = '00000000-0000-4000-8000-0000000de721';
  r2 := public.record_checkin_v5('00000000-0000-4000-8000-0000000de721', p.id, p.lat, p.lng, 5, '00000000-0000-4000-8000-0000000de721/b.jpg', 0, null, '{}');
  select xp into x2 from public.profiles where id = '00000000-0000-4000-8000-0000000de721';
  insert into t_out values ('sequence: first rewarded', (r1->>'rewarded')::boolean and x1 > 0, r1->>'reasons' || ' xp ' || x1);
  insert into t_out values ('sequence: second already_stamped, XP once', not (r2->>'rewarded')::boolean and (r2->'reasons') ? 'already_stamped' and x2 = x1,
    r2->>'reasons' || ' xp ' || x2);
  insert into t_out values ('sequence: one stamp', (select count(*) from public.stamps where user_id = '00000000-0000-4000-8000-0000000de721') = 1, null);
end $$;

-- 2. example shops' coupons: with only example coupons active, a real check-in near one gets no spin
update public.coupons set active = false where shop_id not in (select id from public.shops where is_demo);
do $$
declare p record; r jsonb;
begin
  select * into p from t_place;
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de722', p.id, p.lat, p.lng, 5, '00000000-0000-4000-8000-0000000de722/a.jpg', 0, null, '{}');
  insert into t_out values ('coupon: no example shop spin', (r->>'rewarded')::boolean and r->'spin' = 'null'::jsonb, r->>'spin');
  -- control: the same shop as a real one is spun for the next traveller
  update public.shops set is_demo = false where id = (select shop_id from t_demo);
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de724', p.id, p.lat, p.lng, 5, '00000000-0000-4000-8000-0000000de724/a.jpg', 0, null, '{}');
  insert into t_out values ('coupon: a real shop is spun (control)', (r->>'rewarded')::boolean and r->'spin' <> 'null'::jsonb, r->>'spin');
end $$;

-- 3. a new province in demo mode gives no bonus shake; a real one does (de724 above, control)
do $$
declare p record; r jsonb;
begin
  select * into p from t_place;
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de723', p.id, p.lat, p.lng, 5, '00000000-0000-4000-8000-0000000de723/a.jpg', 0, null, '{"demo": true}');
  insert into t_out values ('demo province: stamped, new province, no ticket',
    (r->>'rewarded')::boolean and (r->'stamp'->>'new_province')::boolean and (r->>'fortune_tickets')::int = 0, r->>'fortune_tickets');
end $$;
insert into t_out select 'real province: one ticket (control)', balance = 1, balance::text
  from public.fortune_tickets where user_id = '00000000-0000-4000-8000-0000000de724';

-- 4. 25 shakes of demo check-ins: never an XP boost (the boost guard is in the body too)
insert into t_out values ('demo shake: boost guard in body',
  pg_get_functiondef('public.shake_fortune'::regproc) like '%if v_kind = ''boost'' and public.is_demo_checkin(p_checkin) then%', null);
insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, client, status, rewarded)
  select '00000000-0000-4000-8000-0000000de725', p.id, extensions.st_point(p.lng, p.lat)::extensions.geography, 5, 0, '{"demo": true}', 'approved', true
    from t_place p, generate_series(1, 25);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000de725", "role": "authenticated"}', true);
do $$
declare c record;
begin
  for c in select id from public.checkins where user_id = '00000000-0000-4000-8000-0000000de725' loop
    perform public.shake_fortune(c.id);
  end loop;
end $$;
insert into t_out select 'demo shake: 25 shakes, no boost',
  count(*) = 25 and count(*) filter (where prize_kind = 'boost' or boost_hours > 0) = 0
  and (select xp_boost_until from public.profiles where id = '00000000-0000-4000-8000-0000000de725') is null,
  count(*) filter (where rarity in ('rare', 'epic')) || ' rare/epic, prizes ' || string_agg(distinct prize_kind, ',')
  from public.fortune_pulls where user_id = '00000000-0000-4000-8000-0000000de725';

-- 5. nomination photos: kept until 30 days after the nomination closes, then listed for the purge
create temp table t_two as select id from public.places where shop_id is null order by id limit 2;
update public.places set created_at = now() - interval '10 days' where id = (select min(id) from t_two);
update public.places set created_at = now() - interval '40 days' where id = (select max(id) from t_two);
insert into storage.objects (bucket_id, name, owner, created_at)
  select 'selfies', '00000000-0000-4000-8000-0000000de721/n' || n || '.jpg', '00000000-0000-4000-8000-0000000de721', now() - interval '80 days'
    from generate_series(1, 6) n;
insert into public.nominations (user_id, name, kind, location, photo_path, status, place_id, created_at)
  select '00000000-0000-4000-8000-0000000de721', 'critic r3 ' || v.n, 'otop', t.location, '00000000-0000-4000-8000-0000000de721/n' || v.n || '.jpg',
         v.status, v.place_id, now() - v.age
    from (select location from public.places limit 1) t,
         (values (1, 'pending', null::bigint, interval '5 days'),                      -- still open: kept
                 (2, 'pending', null, interval '40 days'),                             -- expired 10 days ago: kept
                 (3, 'pending', null, interval '70 days'),                             -- expired 40 days ago: purged
                 (4, 'live', (select min(id) from t_two), interval '50 days'),         -- went live 10 days ago: kept
                 (5, 'live', (select max(id) from t_two), interval '50 days'),         -- went live 40 days ago: purged
                 (6, 'rejected', null, interval '70 days')) v(n, status, place_id, age);  -- closed by day 30: purged
insert into t_out select 'nomination photos: only the closed 30+ days ago ones',
  coalesce(array_agg(o order by o) filter (where o like '00000000-0000-4000-8000-0000000de721/n%'), '{}') = array[
    '00000000-0000-4000-8000-0000000de721/n3.jpg', '00000000-0000-4000-8000-0000000de721/n5.jpg', '00000000-0000-4000-8000-0000000de721/n6.jpg'],
  (array_agg(o order by o) filter (where o like '00000000-0000-4000-8000-0000000de721/n%'))::text from public.selfie_orphans(1000) o;
insert into t_out values ('orphans: still not callable by clients',
  not has_function_privilege('authenticated', 'public.selfie_orphans(int)', 'execute') and not has_function_privilege('anon', 'public.selfie_orphans(int)', 'execute'), null);
select * from t_out;
rollback;
