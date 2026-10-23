-- search results carry the place kind (icon) and tier (landmark badge)
drop function if exists public.search_places(text, float8, float8, text, int);
create or replace function public.search_places(p_query text, p_lat float8 default null, p_lng float8 default null,
                                                p_kind text default null, p_limit int default 20)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               rating numeric, price_level smallint, distance_m float8, kind text, tier smallint)
language sql stable security definer set search_path = '' as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) t,
           case when p_lat is null or p_lng is null then null
                else extensions.st_point(p_lng, p_lat)::extensions.geography end here
  )
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.price_level,
         case when q.here is null then null else extensions.st_distance(p.location, q.here) end, p.kind, p.tier
  from public.places p cross join q
  where p.min_level = 0
    and length(q.t) <= 100
    and (length(q.t) >= 2 or (p_kind is not null and q.here is not null))
    and (length(q.t) < 2 or lower(p.name || ' ' || coalesce(p.name_th, '')) like
         '%' || replace(replace(replace(q.t, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and (p_kind is null or case p_kind
           when 'food' then p.category in ('food', 'market')
           when 'cafes' then p.category = 'cafe'
           when 'culture' then p.category in ('temple', 'museum', 'art')
           when 'nature' then p.category in ('park', 'viewpoint')
           when 'shopping' then p.category in ('craft', 'market')
           else false end)
    -- "near me" lists stay local: within 30 km when a point is given and there's no name to match
    and (length(q.t) >= 2 or extensions.st_dwithin(p.location, q.here, 30000))
  order by (q.here is not null and not extensions.st_dwithin(p.location, q.here, 50000)),
           (lower(p.name) = q.t) desc, (lower(p.name) like q.t || '%') desc,
           case when q.here is null then 0 else extensions.st_distance(p.location, q.here) end, p.id
  limit least(greatest(p_limit, 1), 30);
$$;
revoke all on function public.search_places(text, float8, float8, text, int) from public;
grant execute on function public.search_places(text, float8, float8, text, int) to anon, authenticated;
