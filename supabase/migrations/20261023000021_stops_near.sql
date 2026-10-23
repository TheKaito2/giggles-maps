-- Map "stops" (PokéStop-style): places around the user with their tier, check-in zone and whether the user already
-- has the stamp. Landmarks first, then nearest. Members-only places stay hidden here (the route planner handles them).
create or replace function public.stops_near(p_lat float8, p_lng float8, p_radius_m float8 default 1500)
returns table (id bigint, name text, name_th text, category text, tier smallint, lat float8, lng float8,
               zone_m int, distance_m float8, stamped boolean)
language sql stable security definer set search_path = '' as $$
  with here as (select extensions.st_point(p_lng, p_lat)::extensions.geography g)
  select p.id, p.name, p.name_th, p.category, p.tier,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         case when p.tier = 3 or p.category = 'park' then 150 else 50 end,
         extensions.st_distance(p.location, h.g),
         exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = p.id)
    from public.places p cross join here h
   where p.min_level = 0 and extensions.st_dwithin(p.location, h.g, least(greatest(p_radius_m, 100), 5000))
   order by p.tier desc, extensions.st_distance(p.location, h.g)
   limit 80
$$;
revoke execute on function public.stops_near(float8, float8, float8) from public;
grant execute on function public.stops_near(float8, float8, float8) to anon, authenticated;
