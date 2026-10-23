-- "Stop for a meal?" must put a restaurant on the route. The food group ranks markets and landmark restaurants
-- first, so plain restaurants often missed the shortlist. p_meal_slots (set when a meal is asked for) always adds
-- that many of the nearest restaurants (category food).

drop function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int, numeric, boolean, smallint);
create or replace function public.detour_candidates(
  o_lat float8, o_lng float8, d_lat float8, d_lng float8, extra_m float8, max_n int default 16, p_level int default 0,
  p_per_group int default 5, p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null,
  p_meal_slots int default 0)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               open_min int, close_min int, dwell_min int, rating numeric, is_partner boolean, is_demo boolean,
               min_level int, exclusive_kind text, perk_text text, price_level smallint, tier smallint)
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
    select i.*, row_number() over (partition by i.grp order by i.tier desc, i.rating desc nulls last, i.via_m, i.id) rn,
           row_number() over (partition by i.tier = 3 order by i.via_m, i.id) lm,
           row_number() over (partition by i.category = 'food' order by i.via_m, i.id) ml from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text, r.price_level, r.tier
  from ranked r
  where r.rn <= p_per_group or (r.tier = 3 and r.lm <= 6) or (r.category = 'food' and r.ml <= p_meal_slots)
  order by (r.category = 'food' and r.ml <= p_meal_slots) desc, r.tier desc, r.rating desc nulls last, r.via_m, r.id
  limit max_n + 6 + p_meal_slots;
$$;
grant execute on function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int, numeric, boolean, smallint, int)
  to anon, authenticated;

drop function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint);
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null,
  p_meal_slots int default 0)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text, price_level smallint, tier smallint)
language sql stable security definer set search_path = '' as $$
  -- MATERIALIZED: build the line once. Inlined, Postgres re-parsed the whole JSON line for every candidate row
  -- (~10k rows x thousands of points on a long drive = ~100 s, so the lookup timed out and no stops came back).
  with route as materialized (
    -- simplified to ~200 m: a long drive has thousands of points, and measuring every place in a 20 km corridor
    -- against all of them took ~106 s (timed out, no stops). Precision to a few hundred metres is plenty here.
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line
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
    select n.*, row_number() over (partition by grp order by tier desc, rating desc nulls last, distance_m, id) rn,
           row_number() over (partition by tier = 3 order by distance_m, id) lm,
           row_number() over (partition by category = 'food' order by distance_m, id) ml from nearby n
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier
  from ranked p where p.rn <= least(greatest(p_per_group, 1), 5) or (p.tier = 3 and p.lm <= 6) or (p.category = 'food' and p.ml <= least(p_meal_slots, 4))
  order by (p.category = 'food' and p.ml <= least(p_meal_slots, 4)) desc, p.tier desc, p.rating desc nulls last, p.distance_m, p.id
  limit least(greatest(p_max_n, 1), 22) + 6 + least(p_meal_slots, 4);
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int)
  from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int)
  to service_role;
