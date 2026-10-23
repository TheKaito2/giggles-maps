-- Membership-safe indexed corridor; quality/theme-group diversity, never paid placement.
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text)
language sql stable security definer set search_path = '' as $$
  with route as (
    select extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326) line
  ), nearby as (
    select p.*, extensions.st_distance(p.location, r.line::extensions.geography) distance_m,
      case when p.category in ('park', 'viewpoint') then 'nature'
           when p.category in ('cafe', 'food', 'market') then 'food'
           when p.category in ('temple', 'museum', 'art') then 'culture'
           when p.category = 'craft' then 'shopping' else 'other' end grp
    from public.places p cross join route r
    where public.place_open_to(p, p_level)
      and extensions.st_dwithin(p.location, r.line::extensions.geography, least(greatest(p_radius_m, 0), 20000))
      and p.rating >= 4 and p.dwell_min <= p_budget_min
  ), ranked as (
    select n.*, row_number() over (partition by grp order by rating desc, distance_m, id) rn from nearby n
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text
  from ranked p where p.rn <= least(greatest(p_per_group, 1), 5)
  order by p.rating desc, p.distance_m, p.id limit least(greatest(p_max_n, 1), 22);
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int) from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int) to service_role;

create extension if not exists pg_trgm with schema extensions;
create index if not exists places_name_search_idx on public.places using gin
  ((lower(name || ' ' || coalesce(name_th, ''))) extensions.gin_trgm_ops);

-- Public search never exposes members-only names or coordinates.
create or replace function public.search_route_places(p_query text)
returns table (id bigint, name text, name_th text, lat float8, lng float8)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.name_th,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry)
  from public.places p
  where p.min_level = 0 and length(trim(p_query)) between 2 and 100
    and lower(p.name || ' ' || coalesce(p.name_th, '')) like '%' ||
      replace(replace(replace(lower(trim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by (lower(p.name) = lower(trim(p_query))) desc, p.id limit 10;
$$;
revoke all on function public.search_route_places(text) from public;
grant execute on function public.search_route_places(text) to anon, authenticated;
