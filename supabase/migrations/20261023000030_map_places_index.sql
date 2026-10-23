-- map_places scans a bounding box: a planar index on the point makes that an index lookup (it was a full scan, 2 s)
create index places_geom_idx on public.places using gist ((location::extensions.geometry));

create or replace function public.map_places(
  p_min_lng float8, p_min_lat float8, p_max_lng float8, p_max_lat float8, p_zoom float8, p_kinds text[] default null)
returns table (id bigint, name text, name_th text, kind text, category text, tier smallint, lat float8, lng float8,
  local boolean, otop boolean, community boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.name_th, p.kind, p.category, p.tier,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.local, p.otop, p.community
    from public.places p
   where (p.location::extensions.geometry) operator(extensions.&&)
           extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
     and p.min_level = 0
     and (p_kinds is null or p.kind = any (p_kinds))
     and (p_kinds is not null or p_zoom >= 14
          or p.tier = 3 or p.otop or p.community
          or (p_zoom >= 11 and (p.detour or p.kind = 'hospital')))
   order by p.tier desc, (p.otop or p.community) desc, p.local desc,
            (p.location::extensions.geometry) operator(extensions.<->)
              extensions.st_setsrid(extensions.st_point((p_min_lng + p_max_lng) / 2, (p_min_lat + p_max_lat) / 2), 4326)
   limit 400
$$;
