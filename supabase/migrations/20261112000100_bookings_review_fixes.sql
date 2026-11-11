-- Review fixes for 098 (bookings v2) and 099 (pitch).
-- 1. PDPA: shop owners no longer read booking rows directly (that exposed each guest's user_id). The shop dashboard hears
--    changes through booking_events instead (booking id, shop, status: no guest identity) and reloads via shop_bookings().
-- 2. A stay completes when the guest checks in at the counter on any day from check-in to check-out (it used to be the day
--    before to the day after the first night, so passing by early charged the shop and checking in on night 2 never did);
--    an unused stay becomes a no-show only after check-out.
-- 3. A stay's fee is at least ฿25, whatever price the shop enters.
-- 4. request_booking: at most 10 requests a day per account (declined and cancelled ones count).
-- 5. send_sponsor_lead: 3 a day per account, 200 a day in total, under a lock (one script could block everyone for a day).
-- 6. shop_reach.visit_rate: first visits to a place that was shown to that traveller in the 3 hours before (the billing
--    rule), over stops shown; shown_30d counts stops only, the same definition.
-- 7. shop_overview weeks: Bangkok week boundaries (they started at 07:00 Monday); visits = verified (billed) visits, the
--    same number as the 30-day tile.

-- 1. booking events for the shop dashboard
drop policy if exists "shop reads its bookings" on public.bookings;
create table if not exists public.booking_events (
  id bigserial primary key,
  shop_id uuid not null references public.shops on delete cascade,
  booking_id bigint not null,
  status text not null,
  at timestamptz not null default now()
);
create index if not exists booking_events_shop on public.booking_events (shop_id, at);
alter table public.booking_events enable row level security;
drop policy if exists "shop reads its booking events" on public.booking_events;
create policy "shop reads its booking events" on public.booking_events for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
create or replace function public.booking_event() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.booking_events (shop_id, booking_id, status) values (new.shop_id, new.id, new.status);
  end if;
  return new;
end $$;
drop trigger if exists bookings_event on public.bookings;
create trigger bookings_event after insert or update on public.bookings for each row execute function public.booking_event();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'booking_events') then
    alter publication supabase_realtime add table public.booking_events;
  end if;
end $$;
select cron.schedule('booking-events-trim', '23 4 * * *', $$delete from public.booking_events where at < now() - interval '7 days'$$);

-- 2. the stay window, patched into the live record_checkin_v5 (only this condition changes; the patch fails loudly if the
--    text it replaces isn't there)
do $patch$
declare d text; old_cond text := 'and day between (now() at time zone ''Asia/Bangkok'')::date - 1 and (now() at time zone ''Asia/Bangkok'')::date + 1';
begin
  d := pg_get_functiondef('public.record_checkin_v5'::regproc);
  if position(old_cond in d) = 0 then raise exception 'record_checkin_v5 booking window not found'; end if;
  d := replace(d, old_cond,
    'and case when kind = ''stay'' then (now() at time zone ''Asia/Bangkok'')::date between day and check_out'
    || ' else day between (now() at time zone ''Asia/Bangkok'')::date - 1 and (now() at time zone ''Asia/Bangkok'')::date + 1 end');
  execute d;
end $patch$;

create or replace function public.expire_bookings() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Bangkok')::date; v_n int; v_m int;
begin
  update public.bookings set status = 'expired', answered_at = now() where status = 'requested' and day <= v_today;
  get diagnostics v_n = row_count;
  update public.bookings set status = 'no_show', charged_thb = 0
   where status = 'accepted' and case when kind = 'stay' then check_out < v_today else day < v_today - 1 end;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke execute on function public.expire_bookings() from public, anon, authenticated;

-- 3. a stay's fee: 10% of the price, at least ฿25
create or replace function public.answer_booking(p_id bigint, p_accept boolean, p_price numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_fee numeric;
begin
  select bk.* into b from public.bookings bk join public.shops s on s.id = bk.shop_id
   where bk.id = p_id and s.owner_id = auth.uid() and bk.status = 'requested' for update of bk;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  v_fee := b.fee_thb;
  if p_accept and b.kind = 'stay' then
    if p_price is null or p_price < 100 or p_price > 500000 then raise exception 'bad_price' using errcode = 'P0001'; end if;
    v_fee := greatest(round(p_price * 0.10), public.visit_fee_thb());
  end if;
  if p_accept and (select wallet_thb from public.shops where id = b.shop_id) < v_fee then
    raise exception 'top_up_first' using errcode = 'P0001';
  end if;
  update public.bookings set status = case when p_accept then 'accepted' else 'declined' end, answered_at = now(),
    stay_price_thb = case when p_accept and b.kind = 'stay' then p_price else stay_price_thb end, fee_thb = v_fee
   where id = p_id;
end $$;

-- 4. a daily cap on booking requests
do $patch$
declare d text; anchor text := 'perform pg_advisory_xact_lock(hashtext(''bookings:'' || auth.uid()::text));';
begin
  d := pg_get_functiondef('public.request_booking(bigint, date, int, text, time, date, int)'::regprocedure);
  if position(anchor in d) = 0 then raise exception 'request_booking lock line not found'; end if;
  d := replace(d, anchor, anchor || E'\n  if (select count(*) from public.bookings where user_id = auth.uid() and created_at > now() - interval ''1 day'') >= 10 then\n'
    || E'    raise exception ''too_many_requests'' using errcode = ''P0001'';\n  end if;');
  execute d;
end $patch$;

-- 5. sponsor leads: per account and in total, under a lock
create or replace function public.send_sponsor_lead(p_org text, p_contact text, p_message text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_org, ''))) < 2 or char_length(btrim(coalesce(p_contact, ''))) < 3 then
    raise exception 'missing_fields' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('sponsor_leads'));
  if (select count(*) from public.sponsor_leads where created_at > now() - interval '1 day' and user_id = auth.uid()) >= 3
     or (select count(*) from public.sponsor_leads where created_at > now() - interval '1 day') >= 200 then
    raise exception 'try_tomorrow' using errcode = 'P0001';
  end if;
  insert into public.sponsor_leads (org, contact, message, user_id)
  values (left(btrim(p_org), 120), left(btrim(p_contact), 160), nullif(left(btrim(coalesce(p_message, '')), 1000), ''), auth.uid());
end $$;

-- 6. the calculator's visit rate, on the billing rule's definition
create or replace function public.shop_reach(p_place bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.name,
    'shown_30d', (select count(*) from public.route_stops s where s.place_id = p.id and s.kind = 'stop' and s.shown_at > now() - interval '30 days'),
    'trips_near_30d', (select count(*) from public.routes r where r.created_at > now() - interval '30 days'
                         and (extensions.st_dwithin(r.origin, p.location, 20000) or extensions.st_dwithin(r.dest, p.location, 20000))),
    'visit_rate', (select round(
        (select count(*) from public.checkins c where c.status = 'approved' and c.rewarded
           and not coalesce((c.client->>'demo')::boolean, false) and c.created_at > now() - interval '30 days'
           and exists (select 1 from public.route_stops rs where rs.user_id = c.user_id and rs.place_id = c.place_id and rs.kind = 'stop'
                         and rs.shown_at between c.created_at - interval '3 hours' and c.created_at))::numeric
        / nullif((select count(*) from public.route_stops s where s.kind = 'stop' and s.shown_at > now() - interval '30 days'), 0), 4)))
  from public.places p where p.id = p_place
$$;

-- 7. Bangkok weeks; visits = verified (billed) visits
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.shop_overview(uuid)'::regprocedure);
  d := replace(d, 'from generate_series(date_trunc(''week'', now() at time zone ''Asia/Bangkok'') - interval ''7 weeks'',
                         date_trunc(''week'', now() at time zone ''Asia/Bangkok''), interval ''1 week'') wk',
    'from generate_series(date_trunc(''week'', now() at time zone ''Asia/Bangkok'') - interval ''7 weeks'',
                         date_trunc(''week'', now() at time zone ''Asia/Bangkok''), interval ''1 week'') wk0,
         lateral (select wk0 at time zone ''Asia/Bangkok'' as wk) w0');
  d := replace(d, '''week'', wk::date', '''week'', wk0::date');
  d := replace(d, 'order by wk)', 'order by wk0)');
  d := replace(d, '(select count(*) from public.checkins c join public.places p on p.id = c.place_id
                  where p.shop_id = s.id and c.status = ''approved'' and not coalesce((c.client->>''demo'')::boolean, false)
                    and c.created_at >= wk and c.created_at < wk + interval ''7 days'')',
    '(select count(*) from public.billable_visits bv where bv.shop_id = s.id and bv.created_at >= wk and bv.created_at < wk + interval ''7 days'')');
  if position('wk0 at time zone' in d) = 0 or position('billable_visits bv where bv.shop_id = s.id and bv.created_at >= wk' in d) = 0 then
    raise exception 'shop_overview patch failed';
  end if;
  execute d;
end $patch$;
