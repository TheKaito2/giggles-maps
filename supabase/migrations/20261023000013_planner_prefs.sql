-- Planner preferences: minimum rating (+ unrated places), spending per stop.
-- rating null = unrated (no verified reviews); the national OSM seed loads as unrated instead of a 4.2 placeholder.
-- price_level: 0 free, 1-3 = ฿ to ฿฿฿, null = not listed. Nothing is invented: only places that are free to enter
-- (temples, public parks, viewpoints in the current Sakon Nakhon set) get a price now.

alter table public.places alter column rating drop not null, alter column rating drop default;
alter table public.places add column price_level smallint check (price_level between 0 and 3);
update public.places set price_level = 0 where category in ('temple', 'park', 'viewpoint');
grant select (price_level) on public.places to anon, authenticated;

-- Short trips / estimate fallback: same ellipse, level gate and per-group quota as 011, plus the new filters.
drop function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int);
create or replace function public.detour_candidates(
  o_lat float8, o_lng float8, d_lat float8, d_lng float8, extra_m float8, max_n int default 16, p_level int default 0,
  p_per_group int default 5, p_min_rating numeric default 4, p_unrated boolean default false, p_max_price smallint default null)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               open_min int, close_min int, dwell_min int, rating numeric, is_partner boolean, is_demo boolean,
               min_level int, exclusive_kind text, perk_text text, price_level smallint)
language sql stable security definer set search_path = ''
as $$
  with b as (
    select extensions.st_point(o_lng, o_lat)::extensions.geography o,
           extensions.st_point(d_lng, d_lat)::extensions.geography d
  ), inside as (
    select p.*,
           extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d) via_m,
           case when p.category in ('park', 'viewpoint') then 'nature'
                when p.category in ('cafe', 'food', 'market') then 'food'
                when p.category in ('temple', 'museum', 'art') then 'culture'
                when p.category = 'craft' then 'shopping'
                else 'other' end grp
    from public.places p cross join b
    where public.place_open_to(p, p_level)
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
      and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
          <= extensions.st_distance(b.o, b.d) + extra_m
  ), ranked as (
    select i.*, row_number() over (partition by i.grp order by i.rating desc nulls last, i.via_m, i.id) rn from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text, r.price_level
  from ranked r
  where r.rn <= p_per_group
  order by r.rating desc nulls last, r.via_m, r.id
  limit max_n;
$$;
grant execute on function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int, numeric, boolean, smallint)
  to anon, authenticated;

-- Road corridor (012) with the same filters. Still service-role only.
drop function public.route_detour_candidates(jsonb, float8, float8, int, int, int);
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default false, p_max_price smallint default null)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text, price_level smallint)
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
