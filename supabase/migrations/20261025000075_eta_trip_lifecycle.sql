-- "Share live ETA" with no ride-along running made a 12-hour ride-along trip behind the scenes, and "Stop sharing" left it
-- open (joinable code, "1 on this trip", a trip album). A trip made only for sharing now ends when the share stops,
-- unless someone has joined it since.
alter table public.trips add column eta_only boolean not null default false;

create or replace function public.share_eta(p_dest_lat float8, p_dest_lng float8, p_dest_name text, p_eta_min float8, p_refresh boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare v_trip uuid := public.active_trip(auth.uid()); v_token text;
begin
  if p_dest_lat is null or p_dest_lng is null or p_eta_min is null
     or p_dest_lat not between 5 and 21 or p_dest_lng not between 97 and 106 or p_eta_min not between 0 and 1440 then
    raise exception 'bad_eta' using errcode = 'P0001';
  end if;
  if p_refresh then
    -- keep an open share fresh; a stopped share stays stopped
    update public.trips set eta_at = now() + make_interval(secs => p_eta_min * 60)
     where id = v_trip and owner = auth.uid() and share_token is not null
    returning share_token into v_token;
    return v_token;
  end if;
  if v_trip is null then
    insert into public.trips (owner, name, eta_only) values (auth.uid(), 'Trip', true) returning id into v_trip;
    insert into public.trip_members (trip_id, user_id) values (v_trip, auth.uid());
  end if;
  update public.trips set share_token = coalesce(share_token, encode(extensions.gen_random_bytes(16), 'hex')),
         share_started = coalesce(share_started, now()),
         dest_lat = p_dest_lat, dest_lng = p_dest_lng, dest_name = left(public.clean_name(p_dest_name, 80), 80),
         eta_at = now() + make_interval(secs => p_eta_min * 60)
   where id = v_trip and owner = auth.uid()
  returning share_token into v_token;
  if v_trip is null or v_token is null then raise exception 'not_your_trip' using errcode = 'P0001'; end if;
  return v_token;
end;
$$;

create or replace function public.stop_eta() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.trips set share_token = null, share_started = null, eta_at = null, dest_lat = null, dest_lng = null, dest_name = null
   where owner = auth.uid() and share_token is not null;
  -- a trip that only existed for the share, with nobody else on it: over
  update public.trips t set ended_at = now()
   where t.owner = auth.uid() and t.eta_only and t.ended_at is null
     and not exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id <> t.owner and m.left_at is null);
  update public.trip_members m set left_at = now()
    from public.trips t where t.id = m.trip_id and t.owner = auth.uid() and t.eta_only and t.ended_at is not null and m.left_at is null;
  perform public.wipe_trip_positions();
end;
$$;
