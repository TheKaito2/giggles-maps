-- Quick detours: convenience stores (7-Eleven, FamilyMart, Lotus's go...) closest to the route, for a pit stop after the
-- sight. Same row shape as route_detour_candidates, so the planner treats them like any other place.
create or replace function public.route_pit_stops(p_geometry jsonb, p_radius_m double precision, p_max_n integer default 6)
returns table(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer,
  close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text,
  perk_text text, price_level smallint, tier smallint, frac double precision, local boolean, otop boolean, community boolean)
language sql stable security definer set search_path = '' as $$
  with route as materialized (
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line)
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, false, p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier,
    extensions.st_linelocatepoint(r.line, p.location::extensions.geometry), p.local, p.otop, p.community
  from public.places p cross join route r
  where p.kind = 'convenience'
    and extensions.st_dwithin(p.location, r.line::extensions.geography, least(greatest(p_radius_m, 0), 1500))
  order by extensions.st_distance(p.location, r.line::extensions.geography), p.id
  limit least(greatest(p_max_n, 1), 10);
$$;
revoke execute on function public.route_pit_stops(jsonb, double precision, integer) from public, anon;
grant execute on function public.route_pit_stops(jsonb, double precision, integer) to authenticated, service_role;
