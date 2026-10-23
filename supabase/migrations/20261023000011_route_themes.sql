-- Route engine v2: plan-route builds one plan per theme (Top picks, Nature, Food, Culture, Shopping)
-- from one shortlist, so the shortlist needs some of every kind of stop, not just the top 16 by rating.
-- detour_candidates keeps the ellipse + level gate and takes the best p_per_group of each group
-- (groups match _shared/themes.ts; market counts as food), then the best max_n overall.

drop function public.detour_candidates(float8, float8, float8, float8, float8, int, int);
create or replace function public.detour_candidates(
  o_lat float8, o_lng float8, d_lat float8, d_lng float8, extra_m float8, max_n int default 16, p_level int default 0,
  p_per_group int default 5)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               open_min int, close_min int, dwell_min int, rating numeric, is_partner boolean, is_demo boolean,
               min_level int, exclusive_kind text, perk_text text)
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
      and extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
      and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
          <= extensions.st_distance(b.o, b.d) + extra_m
  ), ranked as (
    select i.*, row_number() over (partition by i.grp order by i.rating desc, i.via_m, i.id) rn from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text
  from ranked r
  where r.rn <= p_per_group
  order by r.rating desc, r.via_m, r.id
  limit max_n;
$$;
grant execute on function public.detour_candidates(float8, float8, float8, float8, float8, int, int, int) to anon, authenticated;
