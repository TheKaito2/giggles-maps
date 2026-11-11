-- Prices v7 and the counter sticker (Krist, 12 Nov).
-- 1. No more charge per verified visit. Partner and Giggles Choice shops pay ฿50 per 1,000 times they're shown on a
--    traveller's route (bill_impressions, daily, from prepaid credit). Bookings stay the main fee: ฿25 a table or visit,
--    10% of a stay.
-- 2. The sticker is no longer a gate: any shop owner can become Partner without a first scan (stripe-checkout, places_tiers).
-- 3. The sticker is what travellers want to scan: a counter scan gives +25 XP, marks their review "scanned at the counter",
--    and the place page shows how many travellers checked in (and how many scanned).

-- 1a. record_checkin: the per-visit billing block goes (patched into the live body; fails loudly if it moved)
do $patch$
declare d text; a int; b int;
begin
  d := pg_get_functiondef('public.record_checkin(uuid, bigint, double precision, double precision, double precision, text, integer, text, jsonb)'::regprocedure);
  a := position('  -- attribution + billing' in d);
  b := position('  if v_rewarded then' in d);
  if a = 0 or b = 0 or b < a then raise exception 'record_checkin billing block not found'; end if;
  d := left(d, a - 1) || '  -- no charge per visit since prices v7 (shops pay per 1,000 route appearances: bill_impressions)' || chr(10) || substr(d, b);
  execute d;
end $patch$;

-- 1b. ฿50 per 1,000 route appearances, billed for each Bangkok day
create or replace function public.impression_fee_per_1000() returns numeric language sql immutable set search_path = '' as $$ select 50::numeric $$;
grant execute on function public.impression_fee_per_1000() to anon, authenticated, service_role;

create table if not exists public.impression_charges (
  shop_id uuid not null references public.shops on delete cascade,
  day date not null,
  impressions int not null,
  amount_thb numeric not null check (amount_thb >= 0),
  created_at timestamptz not null default now(),
  primary key (shop_id, day)
);
alter table public.impression_charges enable row level security;
drop policy if exists "shop reads its impression charges" on public.impression_charges;
create policy "shop reads its impression charges" on public.impression_charges for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));

-- once per shop and day (the primary key makes a second run a no-op); a shop is billed only for days its tier was live,
-- never beyond its credit, and never for example shops or unclaimed ones
create or replace function public.bill_impressions(p_day date default ((now() at time zone 'Asia/Bangkok')::date - 1)) returns int
language plpgsql security definer set search_path = '' as $$
declare d0 timestamptz := (p_day::timestamp at time zone 'Asia/Bangkok'); d1 timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Bangkok');
  s record; v_n int; v_amount numeric; v_count int := 0;
begin
  for s in select sh.* from public.shops sh join auth.users u on u.id = sh.owner_id
            where sh.tier is not null and sh.tier_until > d0 and not sh.is_demo and not coalesce(u.is_anonymous, false)
              and not exists (select 1 from public.impression_charges ic where ic.shop_id = sh.id and ic.day = p_day)
            for update of sh
  loop
    select count(*) into v_n from public.route_stops rs join public.places p on p.id = rs.place_id
     where p.shop_id = s.id and rs.shown_at >= d0 and rs.shown_at < d1;
    v_amount := least(round(v_n * public.impression_fee_per_1000() / 1000, 2), greatest(s.wallet_thb, 0));
    insert into public.impression_charges (shop_id, day, impressions, amount_thb) values (s.id, p_day, v_n, v_amount);
    update public.shops set wallet_thb = wallet_thb - v_amount where id = s.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.bill_impressions(date) from public, anon, authenticated;
select cron.schedule('bill-impressions', '20 17 * * *', $$select public.bill_impressions()$$);   -- 00:20 Bangkok

-- 2. a paid tier counts without a sticker scan (still: a real, signed-in owner)
create or replace function public.places_tiers(p_ids bigint[]) returns table (id bigint, tier text)
language sql stable security definer set search_path = '' as $$
  select p.id, case when s.tier = 'choice' and s.choice_approved then 'choice' else 'partner' end
    from public.places p
    join public.shops s on s.id = p.shop_id
    join auth.users u on u.id = s.owner_id
   where p.id = any(p_ids[1:300]) and s.tier is not null and s.tier_until > now() and not coalesce(u.is_anonymous, false)
$$;

-- 3a. a counter scan: +25 XP on top of the stamp (patched into record_checkin_v5 before the stamp is written)
do $patch$
declare d text; anchor text := '    select slug into v_event from public.events';
begin
  d := pg_get_functiondef('public.record_checkin_v5'::regproc);
  if position(anchor in d) = 0 then raise exception 'record_checkin_v5 stamp anchor not found'; end if;
  d := replace(d, anchor, '    -- scanned the counter sticker: a bonus for the visit the shop can show off' || chr(10)
    || '    if coalesce((v_result->>''qr_ok'')::boolean, false) then v_xp := v_xp + 25; end if;' || chr(10) || anchor);
  execute d;
end $patch$;

-- 3b. the place page: each review says whether its writer scanned the counter, and the place shows its check-ins
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.place_page'::regproc);
  if position('''mine'', r.user_id = auth.uid())' in d) = 0 or position('''review_count'',' in d) = 0 then raise exception 'place_page anchors not found'; end if;
  d := replace(d, '''mine'', r.user_id = auth.uid())',
    '''mine'', r.user_id = auth.uid(), ''scanned'', exists (select 1 from public.checkins c where c.user_id = r.user_id and c.place_id = r.place_id'
    || ' and c.status = ''approved'' and coalesce((c.client->>''qr_ok'')::boolean, false)))');
  d := replace(d, '''review_count'',',
    '''visits'', (select count(distinct c.user_id) from public.checkins c where c.place_id = p.id and c.status = ''approved'''
    || ' and not coalesce((c.client->>''demo'')::boolean, false)),'
    || ' ''scanned_visits'', (select count(distinct c.user_id) from public.checkins c where c.place_id = p.id and c.status = ''approved'''
    || ' and not coalesce((c.client->>''demo'')::boolean, false) and coalesce((c.client->>''qr_ok'')::boolean, false)),' || chr(10) || '    ''review_count'',');
  execute d;
end $patch$;

-- the dashboard: visits are check-ins now (nothing is billed per visit); fees include the route-appearance charges
create or replace function public.shop_overview(p_shop uuid)
 returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare s public.shops; r jsonb; w jsonb;
begin
  select * into s from public.shops where id = p_shop;
  if not found or (s.owner_id is distinct from auth.uid() and not s.is_demo) then
    raise exception 'not your shop' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'wallet_thb', s.wallet_thb,
    'places', coalesce(jsonb_agg(jsonb_build_object(
       'id', p.id, 'name', p.name, 'bid_thb', p.bid_thb, 'qr_code', p.qr_code, 'last_qr_scan_at', p.last_qr_scan_at,
       'impressions_30d', (select count(*) from public.route_stops rs where rs.place_id = p.id and rs.shown_at > now() - interval '30 days'),
       'card_impressions_30d', (select count(*) from public.route_stops rs where rs.place_id = p.id and rs.kind = 'card' and rs.shown_at > now() - interval '30 days'),
       'visits_30d', (select count(*) from public.checkins c where c.place_id = p.id and c.status = 'approved'
                        and not coalesce((c.client->>'demo')::boolean, false) and c.created_at > now() - interval '30 days')
     )) filter (where p.id is not null), '[]'))
  into r
  from public.places p where p.shop_id = s.id;
  select coalesce(jsonb_agg(jsonb_build_object('week', wk0::date,
      'shown', (select count(*) from public.route_stops rs join public.places p on p.id = rs.place_id
                 where p.shop_id = s.id and rs.shown_at >= wk and rs.shown_at < wk + interval '7 days'),
      'visits', (select count(*) from public.checkins c join public.places p on p.id = c.place_id
                  where p.shop_id = s.id and c.status = 'approved' and not coalesce((c.client->>'demo')::boolean, false)
                    and c.created_at >= wk and c.created_at < wk + interval '7 days'),
      'bookings', (select count(*) from public.bookings b where b.shop_id = s.id and b.created_at >= wk and b.created_at < wk + interval '7 days'),
      'spent', (select coalesce(sum(ic.amount_thb), 0) from public.impression_charges ic where ic.shop_id = s.id
                  and ic.day >= wk0::date and ic.day < wk0::date + 7)
              + (select coalesce(sum(b.charged_thb), 0) from public.bookings b where b.shop_id = s.id and b.status = 'completed'
                  and b.completed_at >= wk and b.completed_at < wk + interval '7 days')
    ) order by wk0), '[]')
    into w
    from generate_series(date_trunc('week', now() at time zone 'Asia/Bangkok') - interval '7 weeks',
                         date_trunc('week', now() at time zone 'Asia/Bangkok'), interval '1 week') wk0,
         lateral (select wk0 at time zone 'Asia/Bangkok' as wk) w0;
  return r || jsonb_build_object('weeks', w);
end;
$function$;

-- the monthly statement lists the route-appearance charges too
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
    'impressions', (select coalesce(jsonb_agg(jsonb_build_object('day', ic.day, 'impressions', ic.impressions, 'amount', ic.amount_thb)
                 order by ic.day), '[]') from public.impression_charges ic
                where ic.shop_id = p_shop and ic.day >= date_trunc('month', p_month)::date and ic.day < (date_trunc('month', p_month) + interval '1 month')::date),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('at', b.completed_at, 'place', p.name, 'kind', b.kind, 'amount', b.charged_thb)
                   order by b.completed_at), '[]') from public.bookings b join public.places p on p.id = b.place_id
                  where b.shop_id = p_shop and b.status = 'completed' and b.completed_at >= m0 and b.completed_at < m1));
end $$;
