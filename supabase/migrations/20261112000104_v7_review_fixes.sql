-- Review fixes for 103 (prices v7).
-- bill_impressions: counts only while the tier was live (from shops.tier_since to tier_until), one appearance per traveller
--   per place per day, never guests or demo plans; catches up on any of the last 7 days a run missed.
-- route_stops.demo: plan-route marks demo-mode plans (they never cost a shop).
-- shop_reach.shown_30d: the same definition as billing, so the calculator matches the bill.
-- record_checkin_v5: no counter-scan bonus at your own shop.
-- place_page: the "scanned at the counter" mark and the check-in counts leave out demo check-ins and guests.

alter table public.route_stops add column if not exists demo boolean not null default false;
alter table public.shops add column if not exists tier_since timestamptz;
update public.shops set tier_since = coalesce(tier_since, now()) where tier is not null and tier_until > now();

-- a tier that starts (or starts again after running out) records when; renewals keep it
create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric, p_shop uuid default null, p_user uuid default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind in ('plus', 'plus_year', 'trip_pass') then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now())
      + case p_kind when 'plus_year' then interval '365 days' when 'trip_pass' then interval '7 days' else interval '30 days' end
     where id = p_user;
  elsif p_kind = 'lifetime' then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = greatest(coalesce(plus_until, now()), '2100-01-01'::timestamptz) where id = p_user;
  elsif p_kind = 'membership' then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = case when not membership_plus_given then greatest(coalesce(plus_until, now()), now()) + interval '90 days' else plus_until end
     where id = p_user;
  elsif p_kind in ('partner', 'choice') then
    -- a Partner payment keeps a live Giggles Choice (the days add on); Choice upgrades a Partner
    update public.shops set tier = case when tier = 'choice' and tier_until > now() then 'choice' else p_kind end,
      tier_since = case when tier_until is null or tier_until <= now() then now() else tier_since end,
      tier_until = greatest(coalesce(tier_until, now()), now()) + interval '30 days' where id = p_shop;
  else
    raise exception 'unknown payment kind %', p_kind;
  end if;
  return true;
exception when unique_violation then
  return false;  -- Stripe retried an event we already applied
end $$;

do $patch$
declare d text; anchor text := '    tier_until = greatest(coalesce(tier_until, now()), now()) + greatest(p_period_end - p_period_start, interval ''0''),';
begin
  d := pg_get_functiondef('public.apply_shop_invoice'::regproc);
  if position(anchor in d) = 0 then raise exception 'apply_shop_invoice anchor not found'; end if;
  d := replace(d, anchor, '    tier_since = case when tier_until is null or tier_until <= now() then now() else tier_since end,' || chr(10) || anchor);
  execute d;
end $patch$;

drop function if exists public.bill_impressions(date);
create function public.bill_impressions(p_day date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_day date; d0 timestamptz; d1 timestamptz; s record; v_n int; v_amount numeric; v_count int := 0;
  v_yesterday date := (now() at time zone 'Asia/Bangkok')::date - 1;
begin
  -- one day when asked; otherwise the last 7 days, so a missed run is billed the next night (each shop and day once)
  for v_day in select g::date from generate_series(coalesce(p_day, v_yesterday - 6), coalesce(p_day, v_yesterday), interval '1 day') g loop
    d0 := v_day::timestamp at time zone 'Asia/Bangkok'; d1 := (v_day + 1)::timestamp at time zone 'Asia/Bangkok';
    for s in select sh.* from public.shops sh join auth.users u on u.id = sh.owner_id
              where sh.tier is not null and sh.tier_until > d0 and coalesce(sh.tier_since, d0) < d1
                and not sh.is_demo and not coalesce(u.is_anonymous, false)
                and not exists (select 1 from public.impression_charges ic where ic.shop_id = sh.id and ic.day = v_day)
              for update of sh
    loop
      -- one appearance per traveller and place that day, signed-in travellers only, never a demo plan, only while live
      select count(*) into v_n from (
        select distinct rs.user_id, rs.place_id from public.route_stops rs
          join public.places p on p.id = rs.place_id join auth.users ru on ru.id = rs.user_id
         where p.shop_id = s.id and not rs.demo and not coalesce(ru.is_anonymous, false)
           and rs.shown_at >= greatest(d0, coalesce(s.tier_since, d0)) and rs.shown_at < least(d1, s.tier_until)) x;
      v_amount := least(round(v_n * public.impression_fee_per_1000() / 1000, 2), greatest(s.wallet_thb, 0));
      insert into public.impression_charges (shop_id, day, impressions, amount_thb) values (s.id, v_day, v_n, v_amount)
        on conflict do nothing;
      if found then update public.shops set wallet_thb = wallet_thb - v_amount where id = s.id; v_count := v_count + 1; end if;
    end loop;
  end loop;
  return v_count;
end $$;
revoke execute on function public.bill_impressions(date) from public, anon, authenticated;

-- the calculator's route appearances: billing's definition (30 days)
create or replace function public.shop_reach(p_place bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.name,
    'shown_30d', (select count(*) from (select distinct rs.user_id, (rs.shown_at at time zone 'Asia/Bangkok')::date
                    from public.route_stops rs join auth.users ru on ru.id = rs.user_id
                   where rs.place_id = p.id and not rs.demo and not coalesce(ru.is_anonymous, false)
                     and rs.shown_at > now() - interval '30 days') x),
    'trips_near_30d', (select count(*) from public.routes r where r.created_at > now() - interval '30 days'
                         and (extensions.st_dwithin(r.origin, p.location, 20000) or extensions.st_dwithin(r.dest, p.location, 20000))))
  from public.places p where p.id = p_place
$$;

do $patch$
declare d text; old_line text := '    if coalesce((v_result->>''qr_ok'')::boolean, false) then v_xp := v_xp + 25; end if;';
begin
  d := pg_get_functiondef('public.record_checkin_v5'::regproc);
  if position(old_line in d) = 0 then raise exception 'scan bonus line not found'; end if;
  d := replace(d, old_line, '    if coalesce((v_result->>''qr_ok'')::boolean, false) and not coalesce((p_client->>''demo'')::boolean, false)'
    || ' and not exists (select 1 from public.shops so where so.id = v_place.shop_id and so.owner_id = p_user) then v_xp := v_xp + 25; end if;');
  execute d;
end $patch$;

do $patch$
declare d text; dn text := ' and not coalesce((c.client->>''demo'')::boolean, false)';
begin
  d := pg_get_functiondef('public.place_page'::regproc);
  -- the review mark: demo scans don't count
  if position('and c.status = ''approved'' and coalesce((c.client->>''qr_ok'')::boolean, false)))' in d) = 0 then raise exception 'place_page scanned mark not found'; end if;
  d := replace(d, 'and c.status = ''approved'' and coalesce((c.client->>''qr_ok'')::boolean, false)))',
    'and c.status = ''approved''' || dn || ' and coalesce((c.client->>''qr_ok'')::boolean, false)))');
  -- the counts: signed-in travellers only
  d := replace(d, 'from public.checkins c where c.place_id = p.id and c.status = ''approved''',
    'from public.checkins c join auth.users cu on cu.id = c.user_id where not coalesce(cu.is_anonymous, false) and c.place_id = p.id and c.status = ''approved''');
  execute d;
end $patch$;

-- build-place-links only at night in Bangkok (01:00-06:55): by day it slowed travellers' searches on the same routing server
select cron.schedule('build-place-links', '*/5 18-23 * * *', $$
  select net.http_post(
    url := 'https://xrlxfvwrkowaybtkkrdl.supabase.co/functions/v1/build-place-links',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
$$);
