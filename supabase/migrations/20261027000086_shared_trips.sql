-- Public trip pages: "Share trip" on a planned detour saves a snapshot anyone with the link can open
-- (/app/?trip=<8 base62 chars>). The snapshot holds no personal data beyond the owner's nickname and avatar: a trip that
-- starts at "Your location" is saved as "Start" with no start point (the app also cuts the line before the first stop).
-- Stop names, kinds and positions come from public.places, not from the client, so a shared page can't carry made-up text
-- under a real place.
create table public.shared_trips (
  id text primary key check (id ~ '^[A-Za-z0-9]{8}$'),
  owner uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  title text not null check (char_length(title) <= 120),
  mode text not null check (mode in ('auto', 'pedestrian', 'bicycle')),
  origin_name text not null check (char_length(origin_name) <= 80),
  origin_lat float8, origin_lng float8,
  dest_name text not null check (char_length(dest_name) <= 80),
  dest_lat float8 not null, dest_lng float8 not null,
  -- [{id, name, name_th, category, lat, lng, arrive_min, leave_min, dwell_min}], minutes after the trip leaves
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) between 1 and 15),
  extra_min int not null check (extra_min between 0 and 1440),
  total_min int not null check (total_min between 0 and 2880),
  geometry jsonb not null check (jsonb_typeof(geometry) = 'array' and jsonb_array_length(geometry) between 2 and 600),
  note text check (char_length(note) <= 280),
  demo boolean not null default false
);
create index shared_trips_owner_day on public.shared_trips (owner, created_at);

-- reads go through view_shared_trip(id) (by id only: the table can't be listed); inserts through share_trip() (rate limit)
alter table public.shared_trips enable row level security;
create policy "shared trips: owner reads" on public.shared_trips for select to authenticated using (owner = auth.uid());
create policy "shared trips: owner deletes" on public.shared_trips for delete to authenticated using (owner = auth.uid());
revoke all on public.shared_trips from public, anon, authenticated;
grant select, delete on public.shared_trips to authenticated;

create or replace function public.share_trip(p_trip jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id text;
  v_origin text; v_title text; v_dest text; v_note text;
  v_olat float8; v_olng float8; v_dlat float8; v_dlng float8;
  v_stops jsonb; v_geom jsonb := p_trip->'geometry'; v_n int;
begin
  if v_uid is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('share_trip:' || v_uid::text));
  if (select count(*) from public.shared_trips where owner = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'share_limit' using errcode = 'P0001';
  end if;

  begin
    v_origin := public.clean_name(p_trip->>'origin_name', 80);
    v_dest := public.clean_name(p_trip->>'dest_name', 80);
    v_note := public.clean_name(p_trip->>'note', 280);
    v_dlat := (p_trip->>'dest_lat')::float8; v_dlng := (p_trip->>'dest_lng')::float8;
    v_olat := (p_trip->>'origin_lat')::float8; v_olng := (p_trip->>'origin_lng')::float8;
  exception when others then raise exception 'bad_trip' using errcode = 'P0001';
  end;
  if v_origin is null or v_origin = 'Your location' then v_origin := 'Start'; v_olat := null; v_olng := null; end if;
  v_title := left(split_part(v_origin, ', ', 1) || ' → ' || split_part(v_dest, ', ', 1), 120);   -- built here: a client title could name the start
  if v_dest is null or v_dlat is null or v_dlng is null
     or v_dlat not between 5 and 21 or v_dlng not between 97 and 106
     or (v_olat is null) <> (v_olng is null) or (v_olat is not null and (v_olat not between 5 and 21 or v_olng not between 97 and 106))
     or coalesce(p_trip->>'mode', '') not in ('auto', 'pedestrian', 'bicycle')
     or jsonb_typeof(p_trip->'stops') is distinct from 'array' or jsonb_array_length(p_trip->'stops') not between 1 and 15
     or jsonb_typeof(v_geom) is distinct from 'array' or jsonb_array_length(v_geom) not between 2 and 600
     or exists (select 1 from jsonb_array_elements(v_geom) e
                 where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 2
                    or jsonb_typeof(e->0) <> 'number' or jsonb_typeof(e->1) <> 'number') then
    raise exception 'bad_trip' using errcode = 'P0001';
  end if;

  -- each stop: the place's own name, kind and position; the client gives only id, arrival and time there
  begin
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_th', p.name_th, 'category', p.category,
             'lat', round(extensions.st_y(p.location::extensions.geometry)::numeric, 6),
             'lng', round(extensions.st_x(p.location::extensions.geometry)::numeric, 6),
             'arrive_min', s.arrive_min, 'leave_min', s.arrive_min + s.dwell_min, 'dwell_min', s.dwell_min) order by s.ord),
           count(*)
      into v_stops, v_n
      from rows from (jsonb_to_recordset(p_trip->'stops') as (id bigint, arrive_min int, dwell_min int)) with ordinality
             as s(id, arrive_min, dwell_min, ord)
      join public.places p on p.id = s.id
     where s.arrive_min between 0 and 2880 and s.dwell_min between 0 and 600;
  exception when others then raise exception 'bad_trip' using errcode = 'P0001';
  end;
  if v_n is distinct from jsonb_array_length(p_trip->'stops') then raise exception 'bad_trip' using errcode = 'P0001'; end if;

  -- ponytail: 8 chars from 62 by byte % 62 (a slight bias toward the first 8 letters); retried on the rare clash
  loop
    v_id := (select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
                                      1 + get_byte(b, i) % 62, 1), '')
               from (select extensions.gen_random_bytes(8) b) r, generate_series(0, 7) i);
    begin
      insert into public.shared_trips (id, owner, title, mode, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng,
                                       stops, extra_min, total_min, geometry, note, demo)
      values (v_id, v_uid, v_title, p_trip->>'mode', v_origin, v_olat, v_olng, v_dest, v_dlat, v_dlng,
              v_stops, (p_trip->>'extra_min')::int, (p_trip->>'total_min')::int, v_geom, v_note,
              coalesce((p_trip->>'demo')::boolean, false));
      return v_id;
    exception
      when unique_violation then null;   -- id taken: draw another
      when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
        raise exception 'bad_trip' using errcode = 'P0001';
    end;
  end loop;
end;
$$;

-- anyone with the link: the snapshot and who shared it (nickname, colour, avatar; not their account id)
create or replace function public.view_shared_trip(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'created_at', t.created_at, 'title', t.title, 'mode', t.mode,
           'origin', jsonb_build_object('name', t.origin_name, 'lat', t.origin_lat, 'lng', t.origin_lng),
           'dest', jsonb_build_object('name', t.dest_name, 'lat', t.dest_lat, 'lng', t.dest_lng),
           'stops', t.stops, 'extra_min', t.extra_min, 'total_min', t.total_min, 'geometry', t.geometry, 'note', t.note,
           'demo', t.demo, 'who', public.who_of(t.owner) - 'id')
    from public.shared_trips t
   where t.id = p_id
$$;

revoke execute on function public.share_trip(jsonb) from public, anon;
grant execute on function public.share_trip(jsonb) to authenticated;
revoke execute on function public.view_shared_trip(text) from public;
grant execute on function public.view_shared_trip(text) to anon, authenticated;
