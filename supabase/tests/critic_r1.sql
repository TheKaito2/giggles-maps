-- Migration 090: demo check-ins never bill a shop or spin its coupons, and never count as the speed check's last
-- location; selfie_orphans finds only old selfies nothing points at. Checked on the linked database inside a
-- transaction that is rolled back, so nothing is kept:
--   supabase db query --linked -f supabase/tests/critic_r1.sql
-- Every row of the result should read ok = true.
begin;
create temp table t_out (k text, ok boolean, v text);
-- two throwaway signed-in travellers (guests never bill a shop), a funded partner shop with a coupon, on both their routes
insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000de701', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000de702', 'authenticated', 'authenticated', false);
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000de701'), ('00000000-0000-4000-8000-0000000de702') on conflict do nothing;
create temp table t_place as
  select id, location, extensions.st_y(location::extensions.geometry) as lat, extensions.st_x(location::extensions.geometry) as lng
    from public.places where tier = 2 and not is_partner and coalesce(min_level, 0) = 0 and shop_id is null order by id limit 1;
-- a second place far away (> 400 km), for the speed check
create temp table t_far as
  select p.id, extensions.st_y(p.location::extensions.geometry) as lat, extensions.st_x(p.location::extensions.geometry) as lng
    from public.places p, t_place t
   where p.tier = 2 and not p.is_partner and coalesce(p.min_level, 0) = 0 and extensions.st_distance(p.location, t.location) > 400000
   order by p.id limit 1;
create temp table t_shop as with s as (insert into public.shops (name, wallet_thb) values ('critic test shop', 1000) returning id) select id from s;
update public.places set is_partner = true, shop_id = (select id from t_shop), bid_thb = 20, qr_code = 'CRTEST1' where id = (select id from t_place);
insert into public.coupons (shop_id, place_id, title, weight) select (select id from t_shop), id, 'test coupon', 10 from t_place;
with r as (insert into public.routes (user_id, origin, dest, start_min, budget_min, extra_min)
           select u, location, location, 0, 30, 0 from t_place, unnest(array['00000000-0000-4000-8000-0000000de701', '00000000-0000-4000-8000-0000000de702']::uuid[]) u
           returning id, user_id)
insert into public.route_stops (route_id, place_id, user_id) select r.id, (select id from t_place), r.user_id from r;

do $$
declare p record; f record; r jsonb; w numeric;
begin
  select * into p from t_place;
  select * into f from t_far;
  -- a demo check-in at the funded partner, with the right counter code: stamped, but no charge and no coupon spin
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de701', p.id, p.lat, p.lng, 5,
         '00000000-0000-4000-8000-0000000de701/a.jpg', 0, 'CRTEST1', '{"demo": true}');
  select wallet_thb into w from public.shops where id = (select id from t_shop);
  insert into t_out values ('demo: still stamped', r->>'status' = 'approved' and (r->>'rewarded')::boolean, r::text);
  insert into t_out values ('demo: billing = demo, nothing billed', r->>'billing' = 'demo' and (r->>'billed_thb')::numeric = 0, r->>'billing');
  insert into t_out values ('demo: wallet not debited', w = 1000, w::text);
  insert into t_out values ('demo: no billable visit', not exists (select 1 from public.billable_visits where shop_id = (select id from t_shop)), null);
  insert into t_out values ('demo: no coupon spin', r->'spin' = 'null'::jsonb or r->'spin' is null, coalesce(r->>'spin', 'null'));
  -- the same check-in for real (control): the shop is charged, so the test can see a charge happen
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de702', p.id, p.lat, p.lng, 5,
         '00000000-0000-4000-8000-0000000de702/a.jpg', 0, 'CRTEST1', '{}');
  select wallet_thb into w from public.shops where id = (select id from t_shop);
  insert into t_out values ('real: charged (control)', r->>'billing' = 'charged' and w = 980, r->>'billing' || ' wallet ' || w);
  insert into t_out values ('real: coupon spun (control)', r->'spin' is not null and r->'spin' <> 'null'::jsonb, coalesce(r->>'spin', 'null'));
  -- a real check-in > 400 km away seconds after the demo one: the demo teleport doesn't count, so no speed_jump
  r := public.record_checkin_v5('00000000-0000-4000-8000-0000000de701', f.id, f.lat, f.lng, 5,
         '00000000-0000-4000-8000-0000000de701/b.jpg', 0, null, '{}');
  insert into t_out values ('real after demo: no speed_jump', r->>'status' <> 'rejected' and not (r->'reasons') ? 'speed_jump', r->>'reasons');
end $$;
-- orphan selfies: an old file nothing points at goes; an old check-in photo, an old nomination photo and a new file stay
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('selfies', '00000000-0000-4000-8000-0000000de701/orphan.jpg', '00000000-0000-4000-8000-0000000de701', now() - interval '31 days'),
  ('selfies', '00000000-0000-4000-8000-0000000de701/a.jpg', '00000000-0000-4000-8000-0000000de701', now() - interval '31 days'),
  ('selfies', '00000000-0000-4000-8000-0000000de701/nominated.jpg', '00000000-0000-4000-8000-0000000de701', now() - interval '31 days'),
  ('selfies', '00000000-0000-4000-8000-0000000de701/new.jpg', '00000000-0000-4000-8000-0000000de701', now());
insert into public.nominations (user_id, name, kind, location, photo_path)
  select '00000000-0000-4000-8000-0000000de701', 'critic test nomination', 'otop', location, '00000000-0000-4000-8000-0000000de701/nominated.jpg' from t_place;
insert into t_out select 'orphans: only the unreferenced old file',
  array_agg(o) filter (where o like '00000000-0000-4000-8000-0000000de7%') = array['00000000-0000-4000-8000-0000000de701/orphan.jpg'],
  array_agg(o) filter (where o like '00000000-0000-4000-8000-0000000de7%')::text from public.selfie_orphans(1000) o;
insert into t_out values ('orphans: not callable by clients',
  not has_function_privilege('authenticated', 'public.selfie_orphans(int)', 'execute') and not has_function_privilege('anon', 'public.selfie_orphans(int)', 'execute'), null);
select * from t_out;
rollback;
