-- Search an indexed corridor around the actual A -> B road route, not an ellipse.
-- Only a bounded, category-diverse shortlist is sent to the routing provider/client.
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_allow_paid boolean default true)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric, paid boolean,
  bid_thb numeric, is_demo boolean, progress float8)
language sql stable security definer set search_path = '' as $$
  with route as (
    select extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326) line
  ), nearby as (
    select p.*, coalesce(public.partner_live(p) and public.shop_funded(s, p.bid_thb), false) is_paid,
      extensions.st_distance(p.location, r.line::extensions.geography) distance_m,
      extensions.st_linelocatepoint(r.line, p.location::extensions.geometry) route_progress
    from public.places p cross join route r
    left join public.shops s on s.id = p.shop_id
    where extensions.st_dwithin(p.location, r.line::extensions.geography, least(greatest(p_radius_m, 0), 20000))
      and p.rating >= 4 and p.dwell_min <= p_budget_min
  ), ranked as (
    select n.*, row_number() over (partition by is_paid, category order by distance_m, rating desc, id) category_rank
    from nearby n
  ), picked as (
    (select * from ranked where not is_paid
      order by category_rank, distance_m, rating desc, id limit 6)
    union all
    (select * from ranked where is_paid and p_allow_paid
      order by bid_thb / (1 + distance_m / 1000) desc, id limit 2)
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_paid,
    case when p.is_paid then p.bid_thb else 0 end, p.is_demo, p.route_progress
  from picked p order by p.is_paid, p.category_rank, p.distance_m, p.id;
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, boolean) from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, boolean) to service_role;

create extension if not exists pg_trgm with schema extensions;
create index if not exists places_name_search_idx on public.places using gin
  ((lower(name || ' ' || coalesce(name_th, ''))) extensions.gin_trgm_ops);

-- Named POI search, not a full address geocoder. Always bounded and literal (no wildcards).
create or replace function public.search_route_places(p_query text)
returns table (id bigint, name text, name_th text, lat float8, lng float8)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.name_th,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry)
  from public.places p
  where length(trim(p_query)) between 2 and 100
    and lower(p.name || ' ' || coalesce(p.name_th, '')) like '%' ||
      replace(replace(replace(lower(trim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by (lower(p.name) = lower(trim(p_query))) desc, p.id limit 10;
$$;
revoke all on function public.search_route_places(text) from public;
grant execute on function public.search_route_places(text) to anon, authenticated;
