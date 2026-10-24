-- Add-a-stop by the map's kinds (convenience stores, gas, ATMs, hotels...): places of those kinds nearest the route, with how far
-- off it they are, so the app can estimate the extra minutes. And places_by_ids takes all 6 picked stops (it stopped at 3).

create or replace function public.places_by_ids(p_ids bigint[], p_level integer)
 RETURNS TABLE(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer, close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text, perk_text text, price_level smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
         p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level
  from public.places p
  where p.id = any(p_ids[1:6]) and public.place_open_to(p, p_level);
$function$;

create or replace function public.route_places(p_geometry jsonb, p_kinds text[], p_max_n integer default 20)
returns table(id bigint, name text, name_th text, category text, kind text, lat double precision, lng double precision, tier smallint,
  rating numeric, distance_m double precision)
language sql stable security definer set search_path = '' as $$
  with route as materialized (
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line)
  select p.id, p.name, p.name_th, p.category, p.kind,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry), p.tier, p.rating,
    extensions.st_distance(p.location, r.line::extensions.geography)
  from public.places p cross join route r
  where p.kind = any(p_kinds[1:12]) and public.place_open_to(p, public.unlock_level(auth.uid()))
    and extensions.st_dwithin(p.location, r.line::extensions.geography, 1500)
  order by 10, p.id
  limit least(greatest(p_max_n, 1), 30);
$$;
revoke execute on function public.route_places(jsonb, text[], integer) from public, anon;
grant execute on function public.route_places(jsonb, text[], integer) to authenticated;
