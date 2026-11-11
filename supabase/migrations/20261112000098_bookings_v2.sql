-- Bookings v2 (docs/UPDATE-PLAN.md sections 3 and 4).
-- Kinds, from the place's category:
--   table (food, cafe, bar): a day, a time and a party size; the shop pays ฿25 when the guest checks in
--   stay  (stay):            check-in and check-out days, rooms and guests; the shop sets the room price when it accepts and
--                            pays 10% of it when the guest checks in at the counter
--   visit (everything else): a day, a time and a party size; ฿25 on check-in
-- The shop can cancel an accepted booking with a reason. Guests and shop owners can read their own booking rows, so the app
-- hears changes live (Supabase Realtime): the shop gets a sound and a badge, the guest a toast.
-- shop_overview gains an 8-week funnel (on routes, visits, bookings); my_plan_usage counts Plus as unlimited (prices v6).

alter table public.bookings
  add column if not exists kind text not null default 'table' check (kind in ('table', 'stay', 'visit')),
  add column if not exists time_slot time,
  add column if not exists check_out date,
  add column if not exists rooms smallint check (rooms between 1 and 10),
  add column if not exists stay_price_thb numeric check (stay_price_thb > 0),
  add column if not exists cancel_reason text check (char_length(cancel_reason) <= 200),
  add column if not exists cancelled_by text check (cancelled_by in ('guest', 'shop'));
alter table public.bookings add constraint bookings_stay_dates check (kind <> 'stay' or (check_out > day and check_out <= day + 30));

create or replace function public.booking_kind(p_category text) returns text language sql immutable set search_path = '' as $$
  select case when p_category = 'stay' then 'stay' when p_category in ('food', 'cafe', 'bar') then 'table' else 'visit' end
$$;
grant execute on function public.booking_kind(text) to anon, authenticated, service_role;

drop function if exists public.request_booking(bigint, date, int, text);
create function public.request_booking(p_place bigint, p_day date, p_party int, p_note text default null,
  p_time time default null, p_check_out date default null, p_rooms int default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_kind text; v_today date := (now() at time zone 'Asia/Bangkok')::date; v_id bigint;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.places_tiers(array[p_place])) then raise exception 'not_bookable' using errcode = 'P0001'; end if;
  if p_day is null or p_day < v_today or p_day > v_today + 180 then raise exception 'bad_day' using errcode = 'P0001'; end if;
  if p_party is null or p_party not between 1 and 20 then raise exception 'bad_party' using errcode = 'P0001'; end if;
  select shop_id, public.booking_kind(category) into v_shop, v_kind from public.places where id = p_place;
  if v_kind = 'stay' then
    if p_check_out is null or p_check_out <= p_day or p_check_out > p_day + 30 then raise exception 'bad_check_out' using errcode = 'P0001'; end if;
    if p_rooms is null or p_rooms not between 1 and 10 then raise exception 'bad_rooms' using errcode = 'P0001'; end if;
  elsif p_time is null then
    raise exception 'bad_time' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('bookings:' || auth.uid()::text));
  if (select count(*) from public.bookings where user_id = auth.uid() and status in ('requested', 'accepted') and day >= v_today) >= 5 then
    raise exception 'too_many_bookings' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bookings where user_id = auth.uid() and place_id = p_place and day = p_day and status in ('requested', 'accepted')) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;
  insert into public.bookings (place_id, user_id, shop_id, day, party, note, kind, time_slot, check_out, rooms, fee_thb)
  values (p_place, auth.uid(), v_shop, p_day, p_party, nullif(btrim(left(p_note, 300)), ''), v_kind,
          case when v_kind = 'stay' then null else p_time end,
          case when v_kind = 'stay' then p_check_out end, case when v_kind = 'stay' then p_rooms end,
          case when v_kind = 'stay' then 0 else public.visit_fee_thb() end)   -- a stay's fee is set when the shop prices it
  returning id into v_id;
  return v_id;
end $$;

-- accept (a stay needs its price: the fee is 10% of it) or decline
drop function if exists public.answer_booking(bigint, boolean);
create function public.answer_booking(p_id bigint, p_accept boolean, p_price numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_fee numeric;
begin
  select bk.* into b from public.bookings bk join public.shops s on s.id = bk.shop_id
   where bk.id = p_id and s.owner_id = auth.uid() and bk.status = 'requested' for update of bk;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  v_fee := b.fee_thb;
  if p_accept and b.kind = 'stay' then
    if p_price is null or p_price < 100 or p_price > 500000 then raise exception 'bad_price' using errcode = 'P0001'; end if;
    v_fee := round(p_price * 0.10);
  end if;
  if p_accept and (select wallet_thb from public.shops where id = b.shop_id) < v_fee then
    raise exception 'top_up_first' using errcode = 'P0001';
  end if;
  update public.bookings set status = case when p_accept then 'accepted' else 'declined' end, answered_at = now(),
    stay_price_thb = case when p_accept and b.kind = 'stay' then p_price else stay_price_thb end, fee_thb = v_fee
   where id = p_id;
end $$;

-- the shop calls off a booking it accepted (full, closed, a problem), with a reason the guest sees; free of charge
create or replace function public.shop_cancel_booking(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  update public.bookings b set status = 'cancelled', cancelled_by = 'shop', cancel_reason = btrim(left(p_reason, 200)), answered_at = now()
    from public.shops s
   where b.id = p_id and s.id = b.shop_id and s.owner_id = auth.uid() and b.status in ('requested', 'accepted');
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.cancel_booking(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'cancelled', cancelled_by = 'guest', answered_at = now()
   where id = p_id and user_id = auth.uid() and status in ('requested', 'accepted');
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'place_id', b.place_id, 'place', p.name, 'day', b.day, 'party', b.party,
           'note', b.note, 'status', b.status, 'kind', b.kind, 'time', b.time_slot, 'check_out', b.check_out, 'rooms', b.rooms,
           'price', b.stay_price_thb, 'cancel_reason', b.cancel_reason, 'cancelled_by', b.cancelled_by) order by b.day desc, b.id desc), '[]')
    from public.bookings b join public.places p on p.id = b.place_id
   where b.user_id = auth.uid() and b.created_at > now() - interval '180 days'
$$;

-- the shop sees the guest's nickname, party size, day and note only (PDPA: no email or phone)
create or replace function public.shop_bookings(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'place', p.name, 'guest', coalesce(pr.nickname, 'Guest'), 'day', b.day, 'party', b.party,
           'note', b.note, 'status', b.status, 'fee', b.fee_thb, 'charged', b.charged_thb, 'kind', b.kind, 'time', b.time_slot,
           'check_out', b.check_out, 'rooms', b.rooms, 'price', b.stay_price_thb, 'cancel_reason', b.cancel_reason,
           'cancelled_by', b.cancelled_by) order by b.day, b.time_slot nulls first, b.id), '[]')
    from public.bookings b join public.places p on p.id = b.place_id left join public.profiles pr on pr.id = b.user_id
   where b.shop_id = p_shop and exists (select 1 from public.shops s where s.id = p_shop and s.owner_id = auth.uid())
     and b.day >= (now() at time zone 'Asia/Bangkok')::date - 30
$$;

revoke execute on function public.request_booking(bigint, date, int, text, time, date, int), public.answer_booking(bigint, boolean, numeric),
  public.shop_cancel_booking(bigint, text) from public, anon;
grant execute on function public.request_booking(bigint, date, int, text, time, date, int), public.answer_booking(bigint, boolean, numeric),
  public.shop_cancel_booking(bigint, text) to authenticated;

-- live updates: each side reads only its own rows (the app reloads through the functions above when one changes)
drop policy if exists "guest reads own bookings" on public.bookings;
create policy "guest reads own bookings" on public.bookings for select to authenticated using (user_id = auth.uid());
drop policy if exists "shop reads its bookings" on public.bookings;
create policy "shop reads its bookings" on public.bookings for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;

-- the dashboard: the last 8 weeks, how often the shop was on a route, verified visits (check-ins approved there) and bookings
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
       'visits_30d', (select count(*) from public.billable_visits bv where bv.place_id = p.id and bv.created_at > now() - interval '30 days')
     )) filter (where p.id is not null), '[]'))
  into r
  from public.places p where p.shop_id = s.id;
  select coalesce(jsonb_agg(jsonb_build_object('week', wk::date,
      'shown', (select count(*) from public.route_stops rs join public.places p on p.id = rs.place_id
                 where p.shop_id = s.id and rs.shown_at >= wk and rs.shown_at < wk + interval '7 days'),
      'visits', (select count(*) from public.checkins c join public.places p on p.id = c.place_id
                  where p.shop_id = s.id and c.status = 'approved' and not coalesce((c.client->>'demo')::boolean, false)
                    and c.created_at >= wk and c.created_at < wk + interval '7 days'),
      'bookings', (select count(*) from public.bookings b where b.shop_id = s.id and b.created_at >= wk and b.created_at < wk + interval '7 days'),
      'spent', (select coalesce(sum(bv.amount_thb), 0) from public.billable_visits bv where bv.shop_id = s.id and bv.status = 'charged'
                  and bv.created_at >= wk and bv.created_at < wk + interval '7 days')
              + (select coalesce(sum(b.charged_thb), 0) from public.bookings b where b.shop_id = s.id and b.status = 'completed'
                  and b.completed_at >= wk and b.completed_at < wk + interval '7 days')
    ) order by wk), '[]')
    into w
    from generate_series(date_trunc('week', now() at time zone 'Asia/Bangkok') - interval '7 weeks',
                         date_trunc('week', now() at time zone 'Asia/Bangkok'), interval '1 week') wk;
  return r || jsonb_build_object('weeks', w);
end;
$function$;

-- prices v6: Plus (Trip Pass, yearly, Lifetime) plans without daily limits, like the membership did
create or replace function public.my_plan_usage() returns jsonb
language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'member', coalesce((select member_since is not null or coalesce(plus_until > now(), false) from public.profiles where id = auth.uid()), false),
    'detours', (select count(distinct key) from public.plan_usage where user_id = auth.uid() and kind = 'detour' and day = (now() at time zone 'Asia/Bangkok')::date),
    'edits', (select count(distinct key) from public.plan_usage where user_id = auth.uid() and kind = 'edit' and day = (now() at time zone 'Asia/Bangkok')::date),
    'max_detours', a.detours, 'max_edits', a.edits,
    'ads_left', greatest(0, 3 - (select count(*) from public.ad_rewards where user_id = auth.uid() and day = (now() at time zone 'Asia/Bangkok')::date and granted_at is not null)))
  from public.plan_allowance(auth.uid()) a
$function$;
