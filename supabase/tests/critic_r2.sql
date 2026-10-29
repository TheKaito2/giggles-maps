-- Migration 091: a demo check-in doesn't use up the real stamp or the pace limits; a shared trip ending at "Your location"
-- keeps no end point; a shop's place names no Regular. Checked on the linked database inside a transaction that is rolled
-- back, so nothing is kept:
--   supabase db query --linked -f supabase/tests/critic_r2.sql
-- Every row of the result should read ok = true.
begin;
create temp table t_out (k text, ok boolean, v text);
insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000de711', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000de712', 'authenticated', 'authenticated', false);
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000de711'), ('00000000-0000-4000-8000-0000000de712') on conflict do nothing;
update public.profiles set nickname = 'critic r2 ' || right(id::text, 3), on_leaderboard = true
 where id in ('00000000-0000-4000-8000-0000000de711', '00000000-0000-4000-8000-0000000de712');
create temp table t_place as
  select id, location, extensions.st_y(location::extensions.geometry) as lat, extensions.st_x(location::extensions.geometry) as lng
    from public.places where tier = 2 and not is_partner and coalesce(min_level, 0) = 0 and shop_id is null order by id limit 1;
-- 13 more plain places nearby for the pace test (12 demo stamps elsewhere, then one real one)
create temp table t_more as
  select p.id, extensions.st_y(p.location::extensions.geometry) as lat, extensions.st_x(p.location::extensions.geometry) as lng,
         row_number() over (order by p.id) as n
    from public.places p, t_place t
   where p.id <> t.id and not p.is_partner and coalesce(p.min_level, 0) = 0 and p.shop_id is null
     and extensions.st_dwithin(p.location, t.location, 20000)
   order by p.id limit 13;
create temp table t_shop as with s as (insert into public.shops (name, wallet_thb) values ('critic r2 shop', 1000) returning id) select id from s;
update public.places set is_partner = true, shop_id = (select id from t_shop), bid_thb = 20, qr_code = 'CRTEST2' where id = (select id from t_place);
with r as (insert into public.routes (user_id, origin, dest, start_min, budget_min, extra_min)
           select '00000000-0000-4000-8000-0000000de711', location, location, 0, 30, 0 from t_place returning id, user_id)
insert into public.route_stops (route_id, place_id, user_id) select r.id, (select id from t_place), r.user_id from r;

do $$
declare p record; r jsonb; w numeric; v_demo uuid; v_real uuid; s record;
begin
  select * into p from t_place;
  -- a demo check-in at the funded partner: stamped, not billed (unchanged)
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de711', p.id, p.lat, p.lng, 5,
         '00000000-0000-4000-8000-0000000de711/a.jpg', 0, 'CRTEST2', '{"demo": true}');
  v_demo := (r->>'checkin_id')::uuid;
  insert into t_out values ('demo: stamped, billing demo', (r->>'rewarded')::boolean and r->>'billing' = 'demo', r->>'billing');
  -- the same person really visits right after: the real visit is rewarded and billed, and takes over the stamp row
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de711', p.id, p.lat, p.lng, 5,
         '00000000-0000-4000-8000-0000000de711/b.jpg', 0, 'CRTEST2', '{}');
  v_real := (r->>'checkin_id')::uuid;
  select wallet_thb into w from public.shops where id = (select id from t_shop);
  insert into t_out values ('real after demo: rewarded', r->>'status' = 'approved' and (r->>'rewarded')::boolean, r->>'reasons');
  insert into t_out values ('real after demo: charged 20', r->>'billing' = 'charged' and w = 980, r->>'billing' || ' wallet ' || w);
  select * into s from public.stamps where user_id = '00000000-0000-4000-8000-0000000de711' and place_id = p.id;
  insert into t_out values ('real after demo: stamp row is the real check-in', s.checkin_id = v_real and s.xp > 0, s.checkin_id::text);
  -- and a demo check-in after the real stamp is still already_stamped (demo behaviour unchanged)
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de711', p.id, p.lat, p.lng, 5,
         '00000000-0000-4000-8000-0000000de711/c.jpg', 0, null, '{"demo": true}');
  insert into t_out values ('demo after real: already_stamped', not (r->>'rewarded')::boolean and (r->'reasons') ? 'already_stamped', r->>'reasons');
  select * into s from public.stamps where user_id = '00000000-0000-4000-8000-0000000de711' and place_id = p.id;
  insert into t_out values ('demo after real: stamp row kept', s.checkin_id = v_real, s.checkin_id::text);
end $$;

-- pace: 12 rewarded demo check-ins in the last hour (the newest 10 s ago) don't hold back a real stamp
insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, client, status, rewarded, created_at)
  select '00000000-0000-4000-8000-0000000de712', m.id, extensions.st_point(m.lng, m.lat)::extensions.geography, 5, 0,
         '{"demo": true}', 'approved', true, now() - make_interval(secs => 10 + m.n * 60)
    from t_more m where m.n <= 12;
do $$
declare m record; r jsonb;
begin
  select * into m from t_more where n = 13;
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de712', m.id, m.lat, m.lng, 5,
         '00000000-0000-4000-8000-0000000de712/a.jpg', 0, null, '{}');
  insert into t_out values ('pace: real stamp not held back by demo rows', (r->>'rewarded')::boolean and not (r->'reasons') ? 'slow_down', r->>'reasons');
  -- control: a demo check-in still counts every stamp, so it waits (slow_down), as before
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de712', (select id from t_place), (select lat from t_place), (select lng from t_place), 5,
         '00000000-0000-4000-8000-0000000de712/b.jpg', 0, null, '{"demo": true}');
  insert into t_out values ('pace: demo still waits (control)', not (r->>'rewarded')::boolean and (r->'reasons') ? 'slow_down', r->>'reasons');
end $$;

-- shared trip ending at "Your location": named End, on the last stop, line cut there (the home point never stored)
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000de711", "role": "authenticated"}', true);
do $$
declare p record; v_id text; t public.shared_trips;
begin
  select * into p from t_place;
  v_id := public.share_trip(jsonb_build_object('mode', 'auto', 'origin_name', 'Hotel', 'origin_lat', p.lat - 0.01, 'origin_lng', p.lng,
            'dest_name', 'Your location', 'dest_lat', p.lat + 0.02, 'dest_lng', p.lng,
            'stops', jsonb_build_array(jsonb_build_object('id', p.id, 'arrive_min', 10, 'dwell_min', 20)),
            'extra_min', 5, 'total_min', 40,
            'geometry', jsonb_build_array(jsonb_build_array(p.lng, p.lat - 0.01), jsonb_build_array(p.lng, p.lat),
                                          jsonb_build_array(p.lng, p.lat + 0.01), jsonb_build_array(p.lng, p.lat + 0.02))));
  select * into t from public.shared_trips where id = v_id;
  insert into t_out values ('share: end renamed, on the last stop', t.dest_name = 'End' and t.title like '% → End'
    and abs(t.dest_lat - p.lat) < 1e-5 and abs(t.dest_lng - p.lng) < 1e-5, t.title || ' ' || t.dest_lat);
  insert into t_out values ('share: line cut at the last stop', jsonb_array_length(t.geometry) = 3
    and abs(((t.geometry -> -1)->>1)::float8 - p.lat) < 1e-5
    and not exists (select 1 from jsonb_array_elements(t.geometry) e where (e->>1)::float8 > p.lat + 0.001), t.geometry::text);
end $$;

-- Regular: someone with 2 visit-days at the shop's place and at a plain place; only the plain one names them
insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, status, rewarded, created_at)
  select '00000000-0000-4000-8000-0000000de712', pl.id, extensions.st_point(pl.lng, pl.lat)::extensions.geography, 5, 0, 'approved', false, now() - d
    from (select id, lat, lng from t_place union all select id, lat, lng from t_more where n = 13) pl,
         unnest(array[interval '2 days', interval '3 days']) d;
insert into t_out select 'regular: none at a shop place', public.place_regular(id) is null, public.place_regular(id)::text from t_place;
insert into t_out select 'regular: named at a plain place (control)', public.place_regular(id) is not null, public.place_regular(id)::text from t_more where n = 13;
select * from t_out;
rollback;
