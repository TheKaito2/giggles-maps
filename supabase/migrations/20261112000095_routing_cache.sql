-- A trip's routing work kept for 30 minutes (plan-route, _shared/trip-cache.ts): the direct route and the road times
-- fetched between points, so edits, theme taps and reopening a trip don't route it again. Service role only.
create table if not exists public.routing_cache (
  key text primary key,          -- mode|origin|destination, each to 4 decimals (~10 m)
  baseline jsonb not null,       -- the direct road route (geometry, leg minutes)
  pairs jsonb not null default '{}'::jsonb,   -- "lat,lng>lat,lng" -> road minutes
  expires_at timestamptz not null
);
alter table public.routing_cache enable row level security;   -- no policies: clients can't read or write it
revoke all on public.routing_cache from anon, authenticated;
create index if not exists routing_cache_expires on public.routing_cache (expires_at);

-- expired rows go hourly (pg_cron is already used by this project)
select cron.schedule('routing-cache-expire', '17 * * * *', $$delete from public.routing_cache where expires_at < now()$$);
