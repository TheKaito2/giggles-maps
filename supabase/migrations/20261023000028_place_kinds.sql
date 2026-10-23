-- Place kinds (Google-Maps-style taxonomy) and details. category stays the coarse planner category;
-- kind is the fine type shown with an icon. detour = false keeps services, stays and health places out of
-- detour plans and map stops while they still appear on the map and in search.
alter table public.places
  add column kind text,
  add column detour boolean not null default true,
  add column opening_hours text,
  add column phone text,
  add column website text,
  add column address text,
  add column brand text,
  add column local boolean not null default false,
  add column otop boolean not null default false,
  add column community boolean not null default false;
create index places_kind_idx on public.places (kind);

-- the four place lookups that feed plans and stops skip non-detour places
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null,
  p_meal_slots int default 0, p_segments int default 1)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text, price_level smallint, tier smallint,
  frac float8)
language sql stable security definer set search_path = '' as $$
  -- MATERIALIZED: build the line once (inlined, Postgres re-parsed the JSON line for every candidate row)
  with route as materialized (
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line
  ), segs as (select greatest(1, least(p_segments, 8)) n), nearby as (
    select p.*, extensions.st_distance(p.location, r.line::extensions.geography) distance_m,
      extensions.st_linelocatepoint(r.line, p.location::extensions.geometry) fr,
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
      and p.detour
  ), staged as (
    -- on long trips the first and last 3% are the cities you leave from and arrive in, not detours
    select n.*, least(s.n - 1, floor(n.fr * s.n))::int seg from nearby n, segs s
     where s.n = 1 or n.fr between 0.03 and 0.97
  ), ranked as (
    select n.*,
      row_number() over (partition by seg, grp order by tier desc, rating desc nulls last, distance_m, id) rn,
      row_number() over (partition by seg, tier = 3 order by distance_m, id) lm,
      row_number() over (partition by seg, category = 'food' order by distance_m, id) ml,
      row_number() over (partition by seg order by tier desc, rating desc nulls last, distance_m, id) turn
    from staged n
  ), kept as (
    select r.* from ranked r, segs s
     where r.rn <= greatest(1, ceil(least(greatest(p_per_group, 1), 5)::numeric / s.n))
        or (r.tier = 3 and r.lm <= greatest(1, ceil(6.0 / s.n)))
        or (r.category = 'food' and r.ml <= ceil(least(p_meal_slots, 4)::numeric / s.n))
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.fr
  from kept p
  -- round-robin over the stretches, so the limit cuts evenly instead of keeping one end
  order by (p.category = 'food' and p.ml <= 1 and p_meal_slots > 0) desc, p.turn, p.tier desc, p.rating desc nulls last, p.id
  limit least(greatest(p_max_n, 1), 22) + 6 + least(p_meal_slots, 4);
$$;

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
    where public.place_open_to(p, p_level) and p.detour
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
   where p.min_level = 0 and p.detour and extensions.st_dwithin(p.location, h.g, least(greatest(p_radius_m, 100), 5000))
   order by p.tier desc, extensions.st_distance(p.location, h.g)
   limit 80
$$;

create or replace function public.places_near(p_lat float8, p_lng float8, p_radius_m float8,
                                              p_min_rating numeric default 4.0, p_level int default 0)
returns table (id bigint, name text, category text, lat float8, lng float8, rating numeric,
               is_partner boolean, dist_m float8, is_demo boolean, min_level int, exclusive_kind text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.is_partner and p.shop_id is not null,
         extensions.st_distance(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography), p.is_demo,
         p.min_level, p.exclusive_kind
  from public.places p
  where p.rating >= p_min_rating and public.place_open_to(p, p_level) and p.detour
    and extensions.st_dwithin(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography, p_radius_m)
  order by p.rating desc, 8;
$$;
