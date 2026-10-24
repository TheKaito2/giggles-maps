-- Filters inside the shortlist: "only these kinds" (interests), "opening hours known" and "no chains" were applied after
-- the shortlist was cut (~28 places of every kind), so a narrow filter often kept nothing: Chiang Rai -> Doi Suthep with
-- Culture had 482 temples/museums in the corridor but 7 in the shortlist, and the plan came back empty.
-- Now they filter the corridor first. Places for a requested meal (food) still pass the kinds filter.
drop function if exists public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int);
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null,
  p_meal_slots int default 0, p_segments int default 1,
  p_kinds text[] default null, p_landmarks boolean default false, p_open_only boolean default false, p_no_chains boolean default false)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text, price_level smallint, tier smallint,
  frac float8, local boolean, otop boolean, community boolean)
language sql stable security definer set search_path = '' as $$
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
      and (p_kinds is null or p.category = any(p_kinds) or (p_landmarks and p.tier = 3) or (p_meal_slots > 0 and p.category = 'food'))
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
      row_number() over (partition by seg, tier = 3 order by distance_m, id) lm,
      row_number() over (partition by seg, category = 'food' order by distance_m, id) ml,
      row_number() over (partition by seg order by tier desc, rating desc nulls last, distance_m, id) turn,
      row_number() over (partition by seg, (otop or community) order by distance_m, id) lo
    from staged n
  ), kept as (
    select r.* from ranked r, segs s
     where r.rn <= greatest(1, ceil(least(greatest(p_per_group, 1), 5)::numeric / s.n))
        or (r.tier = 3 and r.lm <= greatest(1, ceil(6.0 / s.n)))
        or ((r.otop or r.community) and r.lo <= 2)
        or (r.category = 'food' and r.ml <= ceil(least(p_meal_slots, 4)::numeric / s.n))
  )
  select p.id, p.name, p.name_th, p.category, p.lat, p.lng,
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.fr, p.local, p.otop, p.community
  from kept p
  -- round-robin over the stretches, so the limit cuts evenly instead of keeping one end
  order by (p.category = 'food' and p.ml <= 1 and p_meal_slots > 0) desc, p.turn, p.tier desc, p.rating desc nulls last, p.id
  limit least(greatest(p_max_n, 1), 22) + 6 + least(p_meal_slots, 4);
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int, text[], boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int, text[], boolean, boolean, boolean) to service_role;
