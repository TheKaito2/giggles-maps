-- Security review of 041 (share ETA) and the navigate function:
-- * share tokens come from a CSPRNG (32 hex characters), not random()
-- * missing destination or ETA values are refused (NULL slipped past the range check)
-- * the 30-second refresh never mints a new link, so a refresh racing "Stop sharing" can't reopen the share
-- * the public view no longer includes the account id; stopping a share also clears the destination
-- * navigate is throttled per account (it proxies the public Valhalla server)

drop function public.share_eta(float8, float8, text, float8);

create function public.share_eta(p_dest_lat float8, p_dest_lng float8, p_dest_name text, p_eta_min float8, p_refresh boolean default false)
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
    insert into public.trips (owner, name) values (auth.uid(), 'Trip') returning id into v_trip;
    insert into public.trip_members (trip_id, user_id) values (v_trip, auth.uid());
  end if;
  update public.trips set share_token = coalesce(share_token, encode(extensions.gen_random_bytes(16), 'hex')),
         share_started = coalesce(share_started, now()),
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
  update public.trips set share_token = null, share_started = null, eta_at = null, dest_lat = null, dest_lng = null, dest_name = null
   where owner = auth.uid() and share_token is not null
$$;

-- old 12-character links stop working; new ones are 32 lowercase hex characters
create or replace function public.view_eta(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('who', public.who_of(t.owner) - 'id', 'dest', jsonb_build_object('lat', t.dest_lat, 'lng', t.dest_lng, 'name', t.dest_name),
           'eta_at', t.eta_at,
           'at', (select jsonb_build_object('lat', m.lat, 'lng', m.lng, 'seen_at', m.seen_at) from public.trip_members m
                   where m.trip_id = t.id and m.user_id = t.owner and m.seen_at > now() - interval '10 minutes' and m.lat is not null))
    from public.trips t
   where p_token ~ '^[0-9a-f]{32}$' and t.share_token = p_token
     and t.ended_at is null and t.ends_at > now() and t.share_started > now() - interval '6 hours'
$$;

update public.trips set share_token = null, share_started = null, eta_at = null where share_token is not null;

-- navigate throttle: 40 route requests per account per 10 minutes (a reroute needs 20 s between requests)
create table public.nav_calls (user_id uuid not null references auth.users on delete cascade, at timestamptz not null default now());
create index nav_calls_user_at on public.nav_calls (user_id, at);
alter table public.nav_calls enable row level security;

create function public.nav_allowed(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.nav_calls where user_id = p_user and at < now() - interval '10 minutes';
  if (select count(*) from public.nav_calls where user_id = p_user) >= 40 then return false; end if;
  insert into public.nav_calls (user_id) values (p_user);
  return true;
end;
$$;

revoke execute on function public.share_eta(float8, float8, text, float8, boolean) from public, anon;
grant execute on function public.share_eta(float8, float8, text, float8, boolean) to authenticated;
revoke execute on function public.nav_allowed(uuid) from public, anon, authenticated;
grant execute on function public.nav_allowed(uuid) to service_role;
