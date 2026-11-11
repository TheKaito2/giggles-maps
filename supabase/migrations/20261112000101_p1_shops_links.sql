-- P1 (docs/UPDATE-PLAN.md): shop subscriptions, shop statements, sponsor leads for admins, precomputed travel times.

-- ---------- Stripe subscriptions for Partner and Giggles Choice ----------
-- A shop subscribes monthly (Stripe Billing): each paid invoice runs the tier to the end of its billing period; cancelling
-- stops renewal and the tier runs out at the period end. One-off 30-day payments (apply_payment) still work.
alter table public.shops
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text check (subscription_status in ('active', 'cancelling', 'cancelled'));

create or replace function public.apply_shop_invoice(p_invoice text, p_shop uuid, p_kind text, p_amount numeric,
  p_period_end timestamptz, p_subscription text) returns boolean
language plpgsql set search_path = '' as $$
begin
  if p_kind not in ('partner', 'choice') then raise exception 'unknown subscription kind %', p_kind; end if;
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id) values (p_invoice, p_kind, p_amount, p_shop);
  -- a Partner invoice keeps a live Giggles Choice; Choice upgrades a Partner
  update public.shops set tier = case when tier = 'choice' and tier_until > now() and p_kind = 'partner' then 'choice' else p_kind end,
    tier_until = greatest(coalesce(tier_until, now()), p_period_end),
    stripe_subscription_id = p_subscription, subscription_status = 'active'
   where id = p_shop;
  return true;
exception when unique_violation then
  return false;   -- Stripe retried an invoice we already applied
end $$;
revoke execute on function public.apply_shop_invoice(text, uuid, text, numeric, timestamptz, text) from public, anon, authenticated;

create or replace function public.set_shop_subscription_status(p_subscription text, p_status text) returns void
language sql set search_path = '' as $$
  update public.shops set subscription_status = p_status where stripe_subscription_id = p_subscription
$$;
revoke execute on function public.set_shop_subscription_status(text, text) from public, anon, authenticated;

-- ---------- a month's statement for the shop: what it paid in and what was taken from its credit ----------
create or replace function public.shop_statement(p_shop uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.shops; m0 timestamptz := (date_trunc('month', p_month)::timestamp at time zone 'Asia/Bangkok');
  m1 timestamptz := ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'Asia/Bangkok');
begin
  select * into s from public.shops where id = p_shop;
  if not found or s.owner_id is distinct from auth.uid() then raise exception 'not your shop' using errcode = '42501'; end if;
  return jsonb_build_object(
    'shop', s.name, 'month', to_char(date_trunc('month', p_month), 'YYYY-MM'),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'kind', kind, 'amount', amount_thb, 'ref', stripe_session_id)
                   order by created_at), '[]') from public.payments where shop_id = p_shop and created_at >= m0 and created_at < m1),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object('at', bv.created_at, 'place', p.name, 'amount', bv.amount_thb, 'status', bv.status)
                 order by bv.created_at), '[]') from public.billable_visits bv join public.places p on p.id = bv.place_id
                where bv.shop_id = p_shop and bv.created_at >= m0 and bv.created_at < m1),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('at', b.completed_at, 'place', p.name, 'kind', b.kind, 'amount', b.charged_thb)
                   order by b.completed_at), '[]') from public.bookings b join public.places p on p.id = b.place_id
                  where b.shop_id = p_shop and b.status = 'completed' and b.completed_at >= m0 and b.completed_at < m1));
end $$;
revoke execute on function public.shop_statement(uuid, date) from public, anon;
grant execute on function public.shop_statement(uuid, date) to authenticated;

-- ---------- sponsor leads for admins ----------
alter table public.sponsor_leads add column if not exists handled_at timestamptz;
create or replace function public.sponsor_leads_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'org', org, 'contact', contact, 'message', message, 'at', created_at)
            order by created_at desc), '[]') from public.sponsor_leads where handled_at is null);
end $$;
create or replace function public.sponsor_lead_done(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  update public.sponsor_leads set handled_at = now() where id = p_id;
end $$;
revoke execute on function public.sponsor_leads_admin(), public.sponsor_lead_done(bigint) from public, anon;
grant execute on function public.sponsor_leads_admin(), public.sponsor_lead_done(bigint) to authenticated;

-- ---------- precomputed travel times between nearby places (UPDATE-PLAN 1B item 5) ----------
-- Each rated place (tier 2+) to its 8 nearest neighbours, per mode, filled by the build-place-links function from our own
-- routing server a batch at a time (cron every 5 minutes, about a week per full pass). plan-route reads them before asking
-- the routing server, so a search fetches mostly the legs to the start and the destination.
create table if not exists public.place_links (
  a bigint not null references public.places on delete cascade,
  b bigint not null references public.places on delete cascade,
  mode text not null check (mode in ('auto', 'bicycle', 'pedestrian')),
  minutes real not null check (minutes >= 0),
  built_at timestamptz not null default now(),
  primary key (a, b, mode)
);
alter table public.place_links enable row level security;   -- service role only
revoke all on public.place_links from anon, authenticated;
create table if not exists public.place_links_cursor (mode text primary key, last_id bigint not null default 0, pass_started timestamptz);
alter table public.place_links_cursor enable row level security;
revoke all on public.place_links_cursor from anon, authenticated;
insert into public.place_links_cursor (mode) values ('auto'), ('bicycle'), ('pedestrian') on conflict do nothing;

-- the next batch of source places for a mode, each with its nearest neighbours within reach (service role only)
create or replace function public.place_links_batch(p_mode text, p_n int default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_last bigint; v_reach float8 := case p_mode when 'auto' then 40000 when 'bicycle' then 20000 else 5000 end; r jsonb;
begin
  select last_id into v_last from public.place_links_cursor where mode = p_mode for update;
  select coalesce(jsonb_agg(jsonb_build_object('id', src.id, 'lat', extensions.st_y(src.location::extensions.geometry),
           'lng', extensions.st_x(src.location::extensions.geometry), 'near', src.near) order by src.id), '[]')
    into r
    from (select p.id, p.location,
            (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'lat', extensions.st_y(q.location::extensions.geometry),
                      'lng', extensions.st_x(q.location::extensions.geometry))), '[]')
               from (select q.id, q.location from public.places q
                      where q.tier >= 2 and q.id <> p.id and extensions.st_dwithin(q.location, p.location, v_reach)
                      order by q.location operator(extensions.<->) p.location limit 8) q) as near
            from public.places p where p.tier >= 2 and p.id > v_last order by p.id limit p_n) src;
  -- move the cursor; at the end of the places, start a new pass
  update public.place_links_cursor set
    last_id = coalesce((select max((e->>'id')::bigint) from jsonb_array_elements(r) e), 0),
    pass_started = case when jsonb_array_length(r) = 0 or v_last = 0 then now() else pass_started end
   where mode = p_mode;
  return r;
end $$;
revoke execute on function public.place_links_batch(text, int) from public, anon, authenticated;

select cron.schedule('build-place-links', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://xrlxfvwrkowaybtkkrdl.supabase.co/functions/v1/build-place-links',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
