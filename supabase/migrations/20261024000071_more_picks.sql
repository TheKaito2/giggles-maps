-- A plan holds 10 stops (members 15), but places_by_ids read only the first 6 picked ids: picks past those were
-- dropped unless they happened to be on the shortlist, so adding stopped working at about 8 stops.
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
  where p.id = any(p_ids[1:15]) and public.place_open_to(p, p_level);   -- = STOP_CAP.member in plan-route
$function$;
