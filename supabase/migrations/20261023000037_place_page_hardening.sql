-- Security review fixes for migration 035.

-- reviews: +20 XP once per place for good (deleting and re-posting no longer pays again), approved check-ins only,
-- and a rating that goes back to unrated if reviews fall below 3
create table public.review_xp (user_id uuid not null references auth.users on delete cascade, place_id bigint not null,
  primary key (user_id, place_id));
alter table public.review_xp enable row level security;
insert into public.review_xp select user_id, place_id from public.reviews on conflict do nothing;

create or replace function public.write_review(p_place bigint, p_rating int, p_body text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.checkins where user_id = auth.uid() and place_id = p_place and status = 'approved') then
    raise exception 'check_in_first' using errcode = 'P0001';
  end if;
  if p_rating not between 1 and 5 then raise exception 'bad_rating' using errcode = 'P0001'; end if;
  insert into public.reviews (user_id, place_id, rating, body)
  values (auth.uid(), p_place, p_rating, left(nullif(trim(p_body), ''), 1000))
  on conflict (user_id, place_id) do update set rating = excluded.rating, body = excluded.body, updated_at = now();
  insert into public.review_xp values (auth.uid(), p_place) on conflict do nothing;
  if found then update public.profiles set xp = xp + 20 where id = auth.uid(); end if;
end;
$$;

create or replace function public.reviews_to_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_place bigint := coalesce(new.place_id, old.place_id); v_n int; v_avg numeric;
begin
  select count(*), avg(rating) into v_n, v_avg from public.reviews where place_id = v_place;
  if v_n >= 3 then
    update public.places set rating = round(v_avg, 1) where id = v_place;
  elsif tg_op = 'DELETE' and v_n = 2 then
    update public.places set rating = null where id = v_place;   -- it was review-made: back to unrated
  end if;
  return null;
end;
$$;

-- lists: never save or show a place above your level; at most 200 places a list
create or replace function public.save_place(p_list uuid, p_place bigint, p_saved boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lists where id = p_list and user_id = auth.uid()) then
    raise exception 'not_your_list' using errcode = 'P0001';
  end if;
  if p_saved then
    if not exists (select 1 from public.places where id = p_place and min_level <= public.unlock_level(auth.uid())) then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if (select count(*) from public.list_places where list_id = p_list) >= 200 then raise exception 'list_full' using errcode = 'P0001'; end if;
    insert into public.list_places (list_id, place_id) values (p_list, p_place) on conflict do nothing;
  else
    delete from public.list_places where list_id = p_list and place_id = p_place;
  end if;
end;
$$;

create or replace function public.my_lists() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lists where user_id = auth.uid()) then
    insert into public.lists (user_id, name) values (auth.uid(), 'Want to go'), (auth.uid(), 'Favourites');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'shared', l.shared,
           'places', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category,
                       'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry))
                       order by lp.added_at desc)
                     from public.list_places lp join public.places p on p.id = lp.place_id where lp.list_id = l.id and p.min_level <= public.unlock_level(auth.uid())), '[]'))
           order by l.created_at)
         from public.lists l where l.user_id = auth.uid()), '[]');
end;
$$;

create or replace function public.friend_lists(p_friend uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
           'places', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category,
                       'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry)))
                     from public.list_places lp join public.places p on p.id = lp.place_id where lp.list_id = l.id and p.min_level <= public.unlock_level(auth.uid())), '[]'))), '[]')
    from public.lists l where l.user_id = p_friend and l.shared and public.is_friend(auth.uid(), p_friend)
$$;

-- edits: typed and size-checked values, valid coordinates, and a cap on the whole queue (fresh guests cannot flood it)
create or replace function public.suggest_edit(p_place bigint, p_payload jsonb, p_here_lat float8 default null, p_here_lng float8 default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clean jsonb; e record;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 2000 then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  select coalesce(jsonb_object_agg(key, value), '{}') into v_clean from jsonb_each(p_payload)
   where key in ('name', 'name_th', 'kind', 'opening_hours', 'phone', 'website', 'closed', 'lat', 'lng');
  if v_clean = '{}'::jsonb then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  for e in select * from jsonb_each(v_clean) loop
    if e.key in ('lat', 'lng') then
      if jsonb_typeof(e.value) <> 'number' then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif e.key = 'closed' then
      if e.value <> 'true'::jsonb then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') not between 1 and 200
          or (e.value #>> '{}') ~ '[<>[:cntrl:]]' then
      raise exception 'bad_edit' using errcode = 'P0001';
    end if;
  end loop;
  if v_clean ? 'kind' and not exists (select 1 from public.places where kind = v_clean->>'kind' limit 1) then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_place is null then
    -- a missing place: you must be standing within 100 m of where you pin it
    if not (v_clean ? 'name' and v_clean ? 'kind' and v_clean ? 'lat' and v_clean ? 'lng') or p_here_lat is null
       or (v_clean->>'lat')::float8 not between 5 and 21 or (v_clean->>'lng')::float8 not between 97 and 106
       or extensions.st_distance(extensions.st_point((v_clean->>'lng')::float8, (v_clean->>'lat')::float8)::extensions.geography,
                                 extensions.st_point(p_here_lng, p_here_lat)::extensions.geography) > 100 then
      raise exception 'be_there' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.places where id = p_place and min_level <= public.unlock_level(auth.uid())) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if (select count(*) from public.place_edits where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20
     or (select count(*) from public.place_edits where status = 'pending') >= 2000 then
    raise exception 'too_many_edits' using errcode = 'P0001';
  end if;
  insert into public.place_edits (user_id, place_id, payload) values (auth.uid(), p_place, v_clean);
end;
$$;

create or replace function public.review_edit(p_edit bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.place_edits; v_kind text; v_cat text; v_detour boolean;
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  select * into e from public.place_edits where id = p_edit and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.place_edits set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now() where id = p_edit;
  if not p_approve then return; end if;
  v_kind := e.payload->>'kind';
  if v_kind is not null then
    select category, detour into v_cat, v_detour from public.places where kind = v_kind group by category, detour order by count(*) desc limit 1;
  end if;
  if e.place_id is null then
    insert into public.places (name, name_th, category, kind, detour, location, source, opening_hours, phone, website, tier)
    values (e.payload->>'name', e.payload->>'name_th', v_cat, v_kind, v_detour,
            extensions.st_point((e.payload->>'lng')::float8, (e.payload->>'lat')::float8)::extensions.geography, 'team',
            e.payload->>'opening_hours', e.payload->>'phone', e.payload->>'website', 1);
  elsif e.payload->'closed' = 'true'::jsonb then
    -- never delete: check-ins, reviews and stamps keep pointing at it; it just leaves the map and plans
    update public.places set min_level = 10, detour = false where id = e.place_id;
  else
    update public.places set name = coalesce(e.payload->>'name', name), name_th = coalesce(e.payload->>'name_th', name_th),
           kind = coalesce(v_kind, kind), category = coalesce(v_cat, category), detour = coalesce(v_detour, detour),
           opening_hours = coalesce(e.payload->>'opening_hours', opening_hours), phone = coalesce(e.payload->>'phone', phone),
           website = coalesce(e.payload->>'website', website)
     where id = e.place_id;
  end if;
  update public.profiles set xp = xp + 50 where id = e.user_id;
end;
$$;

-- busy times: from the total, and hours with under 3 check-ins show as 0 (no single visit can be read off the chart)
create or replace function public.place_page(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'name_th', p.name_th, 'kind', p.kind, 'category', p.category, 'tier', p.tier,
    'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry),
    'opening_hours', p.opening_hours, 'phone', p.phone, 'website', p.website, 'address', p.address,
    'local', p.local, 'otop', p.otop, 'community', p.community, 'detour', p.detour,
    'rating', (select round(avg(rating), 1) from public.reviews r where r.place_id = p.id having count(*) >= 3),
    'review_count', (select count(*) from public.reviews r where r.place_id = p.id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('who', public.who_of(r.user_id), 'rating', r.rating, 'body', r.body,
                 'at', r.updated_at, 'mine', r.user_id = auth.uid()) order by r.updated_at desc)
               from (select * from public.reviews r where r.place_id = p.id order by r.updated_at desc limit 20) r), '[]'),
    'checked_in', exists (select 1 from public.checkins c where c.user_id = auth.uid() and c.place_id = p.id and c.status <> 'rejected'),
    'stamped', exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = p.id),
    'photos', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('url', ph.url, 'credit', ph.credit, 'licence', ph.licence, 'source', ph.source) x
                   from public.place_photos ph where ph.place_id = p.id
                 union all
                 select jsonb_build_object('path', c.selfie_path, 'credit', coalesce(pr.nickname, 'Explorer'), 'source', 'checkin')
                   from public.checkins c join public.profiles pr on pr.id = c.user_id
                  where c.place_id = p.id and c.public_photo and not c.photo_hidden and c.status <> 'rejected' and c.selfie_path is not null
                  limit 30) y), '[]'),
    'busy', (select case when sum(n) >= 20 then jsonb_agg(case when n < 3 then 0 else n end order by h) end from (
               select h, (select count(*) from public.checkins c where c.place_id = p.id and c.status <> 'rejected'
                           and extract(isodow from c.created_at at time zone 'Asia/Bangkok') = extract(isodow from now() at time zone 'Asia/Bangkok')
                           and extract(hour from c.created_at at time zone 'Asia/Bangkok') = h) n
                 from generate_series(6, 23) h) hist),
    'saved_in', coalesce((select jsonb_agg(lp.list_id) from public.list_places lp join public.lists l on l.id = lp.list_id
                          where lp.place_id = p.id and l.user_id = auth.uid()), '[]'))
  from public.places p where p.id = p_id and p.min_level <= public.unlock_level(auth.uid())
$$;

-- map pins: bounded filter list, and no nationwide full sort when a chip is on
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
     and coalesce(cardinality(p_kinds), 0) <= 40
     -- a chip filter on a very wide box shows the zoomed-out mix (landmarks, OTOP), not every match nationwide
     and (p_kinds is null or (p_max_lng - p_min_lng <= 3 and p_max_lat - p_min_lat <= 3) or p.tier = 3 or p.otop or p.community)
     and (p_kinds is not null or p_zoom >= 14
          or p.tier = 3 or p.otop or p.community
          or (p_zoom >= 11 and (p.detour or p.kind = 'hospital')))
   order by p.tier desc, (p.otop or p.community) desc, p.local desc,
            (p.location::extensions.geometry) operator(extensions.<->)
              extensions.st_setsrid(extensions.st_point((p_min_lng + p_max_lng) / 2, (p_min_lat + p_max_lat) / 2), 4326)
   limit 400
$$;

