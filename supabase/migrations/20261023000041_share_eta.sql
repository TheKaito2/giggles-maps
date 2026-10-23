-- Share live ETA (Google-Maps-style "Share trip progress"): a read-only link anyone can open, showing your position,
-- destination and arrival time. It rides on the ride-along trip (positions come from trip_ping) and ends when you stop
-- sharing, when the trip ends, or 6 hours after you started sharing.
alter table public.trips
  add column share_token text unique,
  add column share_started timestamptz,
  add column dest_lat float8, add column dest_lng float8, add column dest_name text check (char_length(dest_name) <= 80),
  add column eta_at timestamptz;

create or replace function public.share_eta(p_dest_lat float8, p_dest_lng float8, p_dest_name text, p_eta_min float8) returns text
language plpgsql security definer set search_path = '' as $$
declare v_trip uuid := public.active_trip(auth.uid()); v_token text;
begin
  if p_dest_lat not between 5 and 21 or p_dest_lng not between 97 and 106 or p_eta_min not between 0 and 1440 then
    raise exception 'bad_eta' using errcode = 'P0001';
  end if;
  if v_trip is null then
    insert into public.trips (owner, name) values (auth.uid(), 'Trip') returning id into v_trip;
    insert into public.trip_members (trip_id, user_id) values (v_trip, auth.uid());
  end if;
  update public.trips set share_token = coalesce(share_token, public.new_code(12)), share_started = coalesce(share_started, now()),
         dest_lat = p_dest_lat, dest_lng = p_dest_lng, dest_name = left(public.clean_name(p_dest_name, 80), 80),
         eta_at = now() + make_interval(secs => p_eta_min * 60)
   where id = v_trip and owner = auth.uid()
  returning share_token into v_token;
  if v_token is null then raise exception 'not_your_trip' using errcode = 'P0001'; end if;
  return v_token;
end;
$$;

create or replace function public.stop_eta() returns void
language sql security definer set search_path = '' as $$
  update public.trips set share_token = null, share_started = null, eta_at = null where owner = auth.uid() and share_token is not null
$$;

-- anyone with the link: who, where they are now (only a fix from the last 10 minutes), destination and arrival time
create or replace function public.view_eta(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('who', public.who_of(t.owner), 'dest', jsonb_build_object('lat', t.dest_lat, 'lng', t.dest_lng, 'name', t.dest_name),
           'eta_at', t.eta_at,
           'at', (select jsonb_build_object('lat', m.lat, 'lng', m.lng, 'seen_at', m.seen_at) from public.trip_members m
                   where m.trip_id = t.id and m.user_id = t.owner and m.seen_at > now() - interval '10 minutes' and m.lat is not null))
    from public.trips t
   where t.share_token = upper(trim(p_token)) and char_length(trim(p_token)) = 12
     and t.ended_at is null and t.ends_at > now() and t.share_started > now() - interval '6 hours'
$$;

revoke execute on function public.share_eta(float8, float8, text, float8), public.stop_eta() from public, anon;
grant execute on function public.share_eta(float8, float8, text, float8), public.stop_eta() to authenticated;
revoke execute on function public.view_eta(text) from public;
grant execute on function public.view_eta(text) to anon, authenticated;
