-- Popularity from real trips: how many different people checked in at a place (approved, last 180 days), leaving out
-- demo mode (client.demo, anyone can teleport there). Guests count: most real travellers never sign in. The
-- candidate RPCs return it as `visitors`; the planner gives it a small, capped boost (planner.ts popularity).
-- Plan edits aren't logged per place (plan_usage keeps a hash key for 3 days), so kept picks aren't counted.
-- ponytail: counted live per returned candidate (≤ ~34 rows) off the (place_id, created_at) index; a materialized
-- view refreshed by cron if check-ins per place ever get large.

create index if not exists checkins_place_time_idx on public.checkins (place_id, created_at desc);

create or replace function public.place_visitors(p_place bigint) returns int
language sql stable set search_path = '' as $$
  select count(distinct c.user_id)::int
    from public.checkins c
   where c.place_id = p_place and c.status = 'approved' and c.created_at > now() - interval '180 days'
     and not coalesce((c.client->>'demo')::boolean, false)
$$;
revoke all on function public.place_visitors(bigint) from public, anon, authenticated;

-- the return type changes, so drop and recreate; bodies as in 20261027000084_icon_tier.sql plus visitors
drop function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int, numeric, boolean, smallint, int);
CREATE OR REPLACE FUNCTION public.detour_candidates(o_lat double precision, o_lng double precision, d_lat double precision, d_lng double precision, extra_m double precision, max_n integer DEFAULT 16, p_level integer DEFAULT 0, p_per_group integer DEFAULT 5, p_min_rating numeric DEFAULT 4, p_unrated boolean DEFAULT true, p_max_price smallint DEFAULT NULL::smallint, p_meal_slots integer DEFAULT 0)
 RETURNS TABLE(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer, close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text, perk_text text, price_level smallint, tier smallint, visitors integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b as (
    select extensions.st_point(o_lng, o_lat)::extensions.geography o,
           extensions.st_point(d_lng, d_lat)::extensions.geography d
  ), inside as (
    select p.*,
           extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d) via_m,
           case when p.category in ('park', 'viewpoint') then 'nature'
                when p.category in ('cafe', 'food', 'market') then 'food'
                when p.category in ('temple', 'museum', 'art') then 'culture'
                when p.category = 'craft' then 'shopping'
                else 'other' end grp
    from public.places p cross join b
    where public.place_open_to(p, p_level)
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
      and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
          <= extensions.st_distance(b.o, b.d) + extra_m
  ), ranked as (
    select i.*, row_number() over (partition by i.grp order by i.tier desc, i.rating desc nulls last, i.via_m, i.id) rn,
           row_number() over (partition by i.tier >= 3 order by i.via_m, i.id) lm,
           row_number() over (partition by i.category = 'food' order by i.via_m, i.id) ml from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text, r.price_level, r.tier, public.place_visitors(r.id)
  from ranked r
  where r.rn <= p_per_group or (r.tier >= 3 and r.lm <= 6) or (r.category = 'food' and r.ml <= p_meal_slots)
  order by (r.category = 'food' and r.ml <= p_meal_slots) desc, r.tier desc, r.rating desc nulls last, r.via_m, r.id
  limit max_n + 6 + p_meal_slots;
$function$;

drop function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int, text[], boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.route_detour_candidates(p_geometry jsonb, p_radius_m double precision, p_budget_min double precision, p_level integer, p_max_n integer DEFAULT 22, p_per_group integer DEFAULT 5, p_min_rating numeric DEFAULT 4, p_unrated boolean DEFAULT true, p_max_price smallint DEFAULT NULL::smallint, p_meal_slots integer DEFAULT 0, p_segments integer DEFAULT 1, p_kinds text[] DEFAULT NULL::text[], p_landmarks boolean DEFAULT false, p_open_only boolean DEFAULT false, p_no_chains boolean DEFAULT false)
 RETURNS TABLE(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer, close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text, perk_text text, price_level smallint, tier smallint, frac double precision, local boolean, otop boolean, community boolean, visitors integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- MATERIALIZED: build the line once (inlined, Postgres re-parsed the JSON line for every candidate row)
  with route as materialized (
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line
  ), cells as materialized (
    select extensions.st_subdivide(extensions.st_buffer(r.line::extensions.geography,
      least(greatest(p_radius_m, 1), 20000))::extensions.geometry, 32) cell
    from route r
  ), hits as (
    -- a place on a cell border matches two cells: keep it once. Only the columns used below: the whole places row
    -- is wide, and five window sorts carrying it took over a second on a 1,500 km trip
    select distinct on (p.id) p.id, p.name, p.name_th, p.category, p.location, p.open_min, p.close_min, p.dwell_min,
      p.rating, p.is_partner, p.shop_id, p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier,
      p.local, p.otop, p.community
    from cells c
      join public.places p on extensions.st_intersects(p.location::extensions.geometry, c.cell)
    where public.place_open_to(p, p_level)
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and p.dwell_min <= p_budget_min
      and p.detour
      -- = fitsInterests / independent in themes.ts
      and (p_kinds is null or p.category = any(p_kinds) or (p_landmarks and p.tier >= 3) or (p_meal_slots > 0 and p.category = 'food'))
      and (not p_open_only or (p.open_min is not null and p.close_min is not null))
      and (not p_no_chains or p.category not in ('food', 'cafe', 'market', 'craft') or p.local or p.otop or p.community)
  ), segs as (select greatest(1, least(p_segments, 8)) n), nearby as materialized (
    -- MATERIALIZED with plain columns: otherwise the route line (~8 kB) rode along in every row through the sorts below
    select p.id, p.name, p.name_th, p.category, p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner, p.shop_id,
      p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.local, p.otop, p.community,
      extensions.st_y(p.location::extensions.geometry) lat, extensions.st_x(p.location::extensions.geometry) lng,
      extensions.st_distance(p.location::extensions.geometry, r.line) * 111320 distance_m,
      extensions.st_linelocatepoint(r.line, p.location::extensions.geometry) fr,
      case when p.category in ('park', 'viewpoint') then 'nature'
           when p.category in ('cafe', 'food', 'market') then 'food'
           when p.category in ('temple', 'museum', 'art') then 'culture'
           when p.category = 'craft' then 'shopping' else 'other' end grp
    from hits p cross join route r
  ), staged as (
    -- on long trips the first and last 3% are the cities you leave from and arrive in, not detours
    select n.*, least(s.n - 1, floor(n.fr * s.n))::int seg from nearby n, segs s
     where s.n = 1 or n.fr between 0.03 and 0.97
  ), ranked as (
    select n.*,
      row_number() over (partition by seg, grp order by tier desc, rating desc nulls last, distance_m, id) rn,
      row_number() over (partition by seg, tier >= 3 order by distance_m, id) lm,
      row_number() over (partition by seg, category = 'food' order by distance_m, id) ml,
      row_number() over (partition by seg order by tier desc, rating desc nulls last, distance_m, id) turn,
      row_number() over (partition by seg, (otop or community) order by distance_m, id) lo
    from staged n
  ), kept as (
    select r.* from ranked r, segs s
     where r.rn <= greatest(1, ceil(least(greatest(p_per_group, 1), 5)::numeric / s.n))
        or (r.tier >= 3 and r.lm <= greatest(1, ceil(6.0 / s.n)))
        or ((r.otop or r.community) and r.lo <= 2)
        or (r.category = 'food' and r.ml <= ceil(least(p_meal_slots, 4)::numeric / s.n))
  )
  select p.id, p.name, p.name_th, p.category, p.lat, p.lng,
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.fr, p.local, p.otop, p.community, public.place_visitors(p.id)
  from kept p
  -- round-robin over the stretches, so the limit cuts evenly instead of keeping one end
  order by (p.category = 'food' and p.ml <= 1 and p_meal_slots > 0) desc, p.turn, p.tier desc, p.rating desc nulls last, p.id
  limit least(greatest(p_max_n, 1), 22) + 6 + least(p_meal_slots, 4);
$function$;

revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int, text[], boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int, text[], boolean, boolean, boolean) to service_role;
