-- Round 4 fixes.
-- 1) A guest's day of plans used up said "Lots of plans at once. Wait a moment" (slow_down, as for 20 a minute): the
--    day's cap now has its own code, day_cap. Otherwise plan_allowed is as in 080.
-- 2) Search: the loose key also folds ch/j (Chatuchak, Jatujak) and matches word by word, so extra words ("... temple",
--    "... Sakon Nakhon") or a different word order still find the place; a query that is only punctuation or emoji
--    (its loose key is empty) no longer matches every name. The stored key is rebuilt for the new folding.
create or replace function public.plan_allowed(p_user uuid, p_edit boolean, p_key text, p_dest text, p_member boolean, p_guest boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_edit boolean;
  v_key text;
  v_kind text;
  v_allow record;
begin
  perform pg_advisory_xact_lock(hashtext('plan_usage:' || p_user::text));
  delete from public.plan_usage where user_id = p_user and at < now() - interval '3 days';
  -- everyone: at most 20 plans a minute; a day: 300 for members, 100 for free accounts
  if (select count(*) from public.plan_usage where user_id = p_user and at > now() - interval '1 minute') >= 20 then return 'slow_down'; end if;
  -- a day: 300 for members, 100 for free accounts, 20 for a guest (its one destination's time options and a few changes)
  if (select count(*) from public.plan_usage where user_id = p_user and day = v_day) >= (case when p_member then 300 when p_guest then 20 else 100 end) then return 'day_cap'; end if;
  -- an edit of a destination not planned today is a new detour
  v_edit := p_edit and exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = 'detour' and key = p_dest);
  v_key := case when v_edit then p_key else p_dest end;
  v_kind := case when v_edit then 'edit' else 'detour' end;
  if not p_member and not exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind and key = v_key) then
    if p_guest then
      -- a guest's taste of it: 1 destination and 3 changes a day
      if (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind) >= (case when v_edit then 3 else 1 end) then
        return case when v_edit then 'sign_in_edits' else 'sign_in_required' end;
      end if;
    else
      select * into v_allow from public.plan_allowance(p_user);
      if (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind)
          >= (case when v_edit then v_allow.edits else v_allow.detours end) then
        return case when v_edit then 'edit_limit' else 'detour_limit' end;
      end if;
    end if;
  end if;
  insert into public.plan_usage (user_id, day, kind, key) values (p_user, v_day, v_kind, v_key);
  return 'ok';
end $$;

create or replace function public.loose(t text) returns text language sql immutable parallel safe set search_path = '' as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(t, '')),
             'th', 't'), 'ph', 'p'), 'kh', 'k'), 'ch', 'c'), 'j', 'c'), 'ae', 'e'), 'oe', 'e'), 'ue', 'u'),
           'd\M', 't', 'g'), 'h\M', '', 'g'), '[^a-z0-9\u0E00-\u0E7F]+', ' ', 'g'), '(.)\1+', '\1', 'g'))
$$;
-- the stored key follows the new folding and drops the spaces, so words match whether or not they're run together
-- ("phrathat", "pra tat"); rebuilt, since a generated column isn't recomputed when its function changes
alter table public.places drop column if exists name_loose;
alter table public.places add column name_key text generated always as (replace(public.loose(name), ' ', '')) stored;
create index if not exists places_name_key on public.places using gin (name_key extensions.gin_trgm_ops);

create or replace function public.search_places(p_query text, p_lat float8 default null, p_lng float8 default null,
                                                p_kind text default null, p_limit int default 20)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               rating numeric, price_level smallint, distance_m float8, kind text, tier smallint)
language sql stable security definer set search_path = '' as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) t,
           '%' || replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' pat,
           replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' pre,
           -- the query's loose words (2+ letters; punctuation and emoji drop out), longest first for the indexed match
           array(select w from unnest(string_to_array(public.loose(p_query), ' ')) w where length(w) >= 2
                 order by length(w) desc) lw,
           case when p_lat is null or p_lng is null then null
                else extensions.st_setsrid(extensions.st_point(p_lng, p_lat), 4326) end here
  ), kinded as not materialized (
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
     limit 60
  ), named as (
    -- 3+ letters: anywhere in the name (trigram index); 2 letters: names starting with them (prefix indexes),
    -- since a trigram index can't help with two letters and the whole table would be scanned
    select k.* from kinded k, q
     where length(q.t) between 2 and 100
       and case when length(q.t) >= 3 then lower(k.name || ' ' || coalesce(k.name_th, '')) like q.pat
                                           -- every word somewhere in the name (the longest through the index)
                                           or (cardinality(q.lw) > 0 and k.name_key like '%' || q.lw[1] || '%'
                                               and not exists (select 1 from unnest(q.lw) w where k.name_key not like '%' || w || '%'))
                else lower(k.name) like q.pre or lower(coalesce(k.name_th, '')) like q.pre end
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
           (lower(p.name) like q.t || '%') desc, p.tier desc, (lower(p.name) = q.t) desc,
           case when q.here is null then 0 else extensions.st_distance(p.location, q.here::extensions.geography) end, p.id
  limit least(greatest(p_limit, 1), 30);
$$;
