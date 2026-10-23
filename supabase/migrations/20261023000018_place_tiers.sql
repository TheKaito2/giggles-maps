-- Landmark-first detours. Every place gets a tier: 3 = landmark (must-go: Wikipedia/Wikidata link, national park,
-- heritage, waterfall, named peak), 2 = worth a visit (attractions, temples, museums, parks, markets, art),
-- 1 = everyday (cafes, food, crafts). Tiers come from the OpenStreetMap import (supabase/tools/import_thailand_places.py).
-- Candidates rank tier first and always include up to 6 of the nearest landmarks, so the planner can choose to
-- detour to them instead of only ever seeing the nearest cafe.

alter table public.places add column tier smallint not null default 1 check (tier between 1 and 3),
                          add column wikidata text;
update public.places set tier = 2 where category in ('temple', 'museum', 'viewpoint', 'park', 'art', 'market');
grant select (tier, wikidata) on public.places to anon, authenticated;

drop function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int, numeric, boolean, smallint);
create or replace function public.detour_candidates(
  o_lat float8, o_lng float8, d_lat float8, d_lng float8, extra_m float8, max_n int default 16, p_level int default 0,
  p_per_group int default 5, p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null)
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
           row_number() over (partition by i.tier = 3 order by i.via_m, i.id) lm from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text, r.price_level, r.tier
  from ranked r
  where r.rn <= p_per_group or (r.tier = 3 and r.lm <= 6)
  order by r.tier desc, r.rating desc nulls last, r.via_m, r.id
  limit max_n + 6;
$$;
grant execute on function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int, numeric, boolean, smallint)
  to anon, authenticated;

drop function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint);
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null)
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
           row_number() over (partition by tier = 3 order by distance_m, id) lm from nearby n
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier
  from ranked p where p.rn <= least(greatest(p_per_group, 1), 5) or (p.tier = 3 and p.lm <= 6)
  order by p.tier desc, p.rating desc nulls last, p.distance_m, p.id limit least(greatest(p_max_n, 1), 22) + 6;
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint)
  from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint)
  to service_role;

drop function public.search_places(text, float8, float8, text, int);
create or replace function public.search_places(p_query text, p_lat float8 default null, p_lng float8 default null,
                                                p_kind text default null, p_limit int default 20)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               rating numeric, price_level smallint, distance_m float8, tier smallint)
language sql stable security definer set search_path = '' as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) t,
           case when p_lat is null or p_lng is null then null
                else extensions.st_point(p_lng, p_lat)::extensions.geography end here
  )
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.price_level,
         case when q.here is null then null else extensions.st_distance(p.location, q.here) end, p.tier
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
           (lower(p.name) = q.t) desc, (lower(p.name) like q.t || '%') desc, p.tier desc,
           case when q.here is null then 0 else extensions.st_distance(p.location, q.here) end, p.id
  limit least(greatest(p_limit, 1), 30);
$$;
revoke all on function public.search_places(text, float8, float8, text, int) from public;
grant execute on function public.search_places(text, float8, float8, text, int) to anon, authenticated;
