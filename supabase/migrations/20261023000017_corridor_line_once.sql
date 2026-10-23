-- Long trips and long extra times returned no stops: the corridor lookup timed out. Build the route line once.

-- Road corridor: same as 014, line built once and simplified. Still service-role only.
drop function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint);
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text, price_level smallint)
language sql stable security definer set search_path = '' as $$
  -- MATERIALIZED: build the line once. Inlined, Postgres re-parsed the whole JSON line for every candidate row
  -- (~10k rows x thousands of points on a long drive = ~100 s, so the lookup timed out and no stops came back).
  with route as materialized (
    -- simplified to ~200 m: a long drive has thousands of points, and measuring every place in a 20 km corridor
    -- against all of them took ~106 s (timed out, no stops). Precision to a few hundred metres is plenty here.
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line
  ), nearby as (
    select p.*, extensions.st_distance(p.location, r.line::extensions.geography) distance_m,
      case when p.category in ('park', 'viewpoint') then 'nature'
           when p.category in ('cafe', 'food', 'market') then 'food'
           when p.category in ('temple', 'museum', 'art') then 'culture'
           when p.category = 'craft' then 'shopping' else 'other' end grp
    from public.places p cross join route r
    where public.place_open_to(p, p_level)
      and extensions.st_dwithin(p.location, r.line::extensions.geography, least(greatest(p_radius_m, 0), 20000))
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and p.dwell_min <= p_budget_min
  ), ranked as (
    select n.*, row_number() over (partition by grp order by rating desc nulls last, distance_m, id) rn from nearby n
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level
  from ranked p where p.rn <= least(greatest(p_per_group, 1), 5)
  order by p.rating desc nulls last, p.distance_m, p.id limit least(greatest(p_max_n, 1), 22);
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint)
  from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint)
  to service_role;
