-- search_places took 360 ms whatever the query: the search text and location sat in a CTE joined to places, so the
-- planner couldn't use the trigram, prefix or location index and scanned all 110k places twice. As plpgsql the text
-- and point are plain values when each statement is planned, so the indexes apply (force_custom_plan: a generic plan,
-- which plpgsql switches to after 5 calls, couldn't pick the index for the query's length).
create or replace function public.search_places(p_query text, p_lat float8 default null, p_lng float8 default null,
                                                p_kind text default null, p_limit int default 20)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               rating numeric, price_level smallint, distance_m float8, kind text, tier smallint)
language plpgsql stable security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
#variable_conflict use_column
declare
  t text := lower(trim(coalesce(p_query, '')));
  esc text := replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_');
  here extensions.geometry := case when p_lat is null or p_lng is null then null
                                   else extensions.st_setsrid(extensions.st_point(p_lng, p_lat), 4326) end;
  cats text[] := case p_kind when 'food' then array['food', 'market'] when 'cafes' then array['cafe']
                   when 'culture' then array['temple', 'museum', 'art'] when 'nature' then array['park', 'viewpoint']
                   when 'shopping' then array['craft', 'market'] else null end;
begin
  if length(t) > 100 or (p_kind is not null and cats is null) then return; end if;
  return query
  with near as (
    -- nearest matches (or, with no text, nearest places of the asked kind)
    select p.* from public.places p
     where here is not null and p.min_level = 0 and (cats is null or p.category = any (cats))
       and (case when length(t) >= 3 then lower(p.name || ' ' || coalesce(p.name_th, '')) like '%' || esc || '%'
                 when length(t) = 2 then lower(p.name) like esc || '%' or lower(coalesce(p.name_th, '')) like esc || '%'
                 else p_kind is not null end)
     order by (p.location::extensions.geometry) operator(extensions.<->) here
     limit 60
  ), named as (
    -- best name matches anywhere: 3+ letters anywhere in the name (trigram index), 2 letters at its start (prefix indexes)
    select p.* from public.places p
     where length(t) >= 2 and p.min_level = 0 and (cats is null or p.category = any (cats))
       and (case when length(t) >= 3 then lower(p.name || ' ' || coalesce(p.name_th, '')) like '%' || esc || '%'
                 else lower(p.name) like esc || '%' or lower(coalesce(p.name_th, '')) like esc || '%' end)
     order by (lower(p.name) = t) desc, (lower(p.name) like esc || '%') desc, p.tier desc, p.id
     limit 30
  ), pool as (select * from near union select * from named)
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.price_level,
         case when here is null then null else extensions.st_distance(p.location, here::extensions.geography) end, p.kind, p.tier
    from pool p
   -- "near me" lists stay local: within 30 km when there's no name to match
   where length(t) >= 2 or extensions.st_dwithin(p.location, here::extensions.geography, 30000)
   order by (here is not null and not extensions.st_dwithin(p.location, here::extensions.geography, 50000)),
            (lower(p.name) = t) desc, (lower(p.name) like esc || '%') desc,
            case when here is null then 0 else extensions.st_distance(p.location, here::extensions.geography) end, p.id
   limit least(greatest(p_limit, 1), 30);
end;
$$;
