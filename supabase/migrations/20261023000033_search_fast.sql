-- Type-ahead speed: rank only a shortlist, the 300 nearest matches (walked from the location index) plus the 30 best
-- name matches anywhere, instead of measuring the distance to every match ("wat" matches ~9,000 places: 420 ms).
create or replace function public.search_places(p_query text, p_lat float8 default null, p_lng float8 default null,
                                                p_kind text default null, p_limit int default 20)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               rating numeric, price_level smallint, distance_m float8, kind text, tier smallint)
language sql stable security definer set search_path = '' as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) t,
           '%' || replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' pat,
           case when p_lat is null or p_lng is null then null
                else extensions.st_setsrid(extensions.st_point(p_lng, p_lat), 4326) end here
  ), kinded as (
    select p.* from public.places p
     where p.min_level = 0
       and (p_kind is null or case p_kind
              when 'food' then p.category in ('food', 'market')
              when 'cafes' then p.category = 'cafe'
              when 'culture' then p.category in ('temple', 'museum', 'art')
              when 'nature' then p.category in ('park', 'viewpoint')
              when 'shopping' then p.category in ('craft', 'market')
              else false end)
  ), near as (
    select k.* from kinded k, q
     where q.here is not null and length(q.t) <= 100
       and (length(q.t) < 2 or lower(k.name || ' ' || coalesce(k.name_th, '')) like q.pat)
       and (length(q.t) >= 2 or p_kind is not null)
     order by (k.location::extensions.geometry) operator(extensions.<->) q.here
     limit 300
  ), named as (
    select k.* from kinded k, q
     where length(q.t) between 2 and 100 and lower(k.name || ' ' || coalesce(k.name_th, '')) like q.pat
     order by (lower(k.name) = q.t) desc, (lower(k.name) like q.t || '%') desc, k.tier desc, k.id
     limit 30
  ), pool as (select * from near union select * from named)
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.price_level,
         case when q.here is null then null else extensions.st_distance(p.location, q.here::extensions.geography) end, p.kind, p.tier
  from pool p cross join q
  -- "near me" lists stay local: within 30 km when there's no name to match
  where length(q.t) >= 2 or extensions.st_dwithin(p.location, q.here::extensions.geography, 30000)
  order by (q.here is not null and not extensions.st_dwithin(p.location, q.here::extensions.geography, 50000)),
           (lower(p.name) = q.t) desc, (lower(p.name) like q.t || '%') desc,
           case when q.here is null then 0 else extensions.st_distance(p.location, q.here::extensions.geography) end, p.id
  limit least(greatest(p_limit, 1), 30);
$$;
