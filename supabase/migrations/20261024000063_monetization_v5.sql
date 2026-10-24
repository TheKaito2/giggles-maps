-- Monetization v5 (24 Oct 2026), see docs/MONETIZATION.md
--   Ads for everyone; a lifetime membership or Plus removes them.
--   Detours need a signed-in account: free = 3 detours (destinations) + 10 edits a day; members unlimited behind a rate limit.
--   Exclusive places are gone; coins and levels are for everyone now (membership no longer gates them).
--   Paid partners: verified shops pay monthly (Partner ฿299, Giggles Choice ฿799 and hand-picked); members' routes put them first.
--   Bookings through Giggles Maps: the shop pays a flat ฿20 once the guest checks in.
--   Plus (monthly): +20 coins a day, a Plus-only shelf in the shop, the Plus title, no ads. Membership brings 3 months of Plus.

-- ---------- exclusives out ----------
update public.places set min_level = 0, exclusive_kind = null where min_level > 0 or exclusive_kind is not null;
drop function if exists public.my_exclusives();

-- ---------- partners ----------
alter table public.shops
  add column tier text check (tier in ('partner', 'choice')),
  add column tier_until timestamptz,
  add column choice_approved boolean not null default false,
  add column choice_requested_at timestamptz;

-- a place's paid tier, only while it counts: QR-verified place, owner signed in (not a guest account), paid up.
-- Giggles Choice also needs our approval; an unapproved Choice payment counts as Partner.
create function public.places_tiers(p_ids bigint[]) returns table (id bigint, tier text)
language sql stable security definer set search_path = '' as $$
  select p.id, case when s.tier = 'choice' and s.choice_approved then 'choice' else 'partner' end
    from public.places p
    join public.shops s on s.id = p.shop_id
    join auth.users u on u.id = s.owner_id
   where p.id = any(p_ids[1:300]) and s.tier is not null and s.tier_until > now()
     and p.qr_code is not null and p.last_qr_scan_at is not null and not coalesce(u.is_anonymous, false)
$$;
grant execute on function public.places_tiers(bigint[]) to anon, authenticated, service_role;

-- a shop owner asks to become Giggles Choice; an admin approves (or not)
create function public.request_choice(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.shops set choice_requested_at = now() where id = p_shop and owner_id = auth.uid();
  if not found then raise exception 'not_your_shop' using errcode = 'P0001'; end if;
end $$;
create function public.approve_choice(p_shop uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  update public.shops set choice_approved = p_ok, choice_requested_at = null where id = p_shop;
end $$;
create function public.choice_requests() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('shop', s.id, 'name', s.name, 'tier', s.tier, 'at', s.choice_requested_at) order by s.choice_requested_at), '[]')
    from public.shops s
   where s.choice_requested_at is not null and exists (select 1 from public.profiles where id = auth.uid() and is_admin)
$$;
revoke execute on function public.request_choice(uuid), public.approve_choice(uuid, boolean), public.choice_requests() from public, anon;
grant execute on function public.request_choice(uuid), public.approve_choice(uuid, boolean), public.choice_requests() to authenticated;

alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('credit', 'plus', 'membership', 'partner', 'choice'));

-- membership brings 3 months of Plus (once, when it starts); partner tiers run 30 days per payment
create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric, p_shop uuid default null, p_user uuid default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind = 'plus' then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now()) + interval '30 days' where id = p_user;
  elsif p_kind = 'membership' then
    update public.profiles set member_since = coalesce(member_since, now()),
      plus_until = case when member_since is null then greatest(coalesce(plus_until, now()), now()) + interval '90 days' else plus_until end
     where id = p_user;
  elsif p_kind in ('partner', 'choice') then
    update public.shops set tier = p_kind, tier_until = greatest(coalesce(tier_until, now()), now()) + interval '30 days' where id = p_shop;
  else
    raise exception 'unknown payment kind %', p_kind;
  end if;
  return true;
exception when unique_violation then
  return false;  -- Stripe retried an event we already applied
end $$;

create or replace function public.apply_apple_membership(p_otid text, p_user uuid, p_env text, p_revoked timestamptz)
returns timestamptz language plpgsql set search_path = '' as $$
declare v_since timestamptz;
begin
  if exists (select 1 from public.apple_memberships where original_transaction_id = p_otid and user_id <> p_user) then
    raise exception 'membership belongs to another account' using errcode = 'P0001';
  end if;
  insert into public.apple_memberships (original_transaction_id, user_id, environment, revoked_at)
  values (p_otid, p_user, p_env, p_revoked)
  on conflict (original_transaction_id) do update set revoked_at = excluded.revoked_at, environment = excluded.environment, updated_at = now();
  if p_revoked is null then
    update public.profiles set member_since = coalesce(member_since, now()),
      plus_until = case when member_since is null then greatest(coalesce(plus_until, now()), now()) + interval '90 days' else plus_until end
     where id = p_user returning member_since into v_since;
  else
    -- keep a web (Stripe) membership if there is one
    update public.profiles set member_since = null where id = p_user
      and not exists (select 1 from public.payments where user_id = p_user and kind = 'membership')
    returning member_since into v_since;
  end if;
  return v_since;
end $$;

-- ---------- detour quotas ----------
-- one row per plan-route call. key = the destination (rounded to ~100 m) for a detour, or the edit itself
-- (destination + stops kept + stops removed) for an edit, so retries of the same edit and the 3 preset plans count once.
create table public.plan_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  kind text not null check (kind in ('detour', 'edit')),
  key text not null,
  at timestamptz not null default now()
);
create index plan_usage_user_at on public.plan_usage (user_id, at);
alter table public.plan_usage enable row level security;

create function public.plan_allowed(p_user uuid, p_edit boolean, p_key text, p_member boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_kind text := case when p_edit then 'edit' else 'detour' end;
begin
  perform pg_advisory_xact_lock(hashtext('plan_usage:' || p_user::text));
  delete from public.plan_usage where user_id = p_user and at < now() - interval '3 days';
  -- everyone: at most 20 plans a minute; members: 300 a day (the "unlimited" that keeps the router alive)
  if (select count(*) from public.plan_usage where user_id = p_user and at > now() - interval '1 minute') >= 20 then return 'slow_down'; end if;
  if p_member then
    if (select count(*) from public.plan_usage where user_id = p_user and day = v_day) >= 300 then return 'slow_down'; end if;
  elsif not exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind and key = p_key)
    and (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind) >= (case when p_edit then 10 else 3 end) then
    return case when p_edit then 'edit_limit' else 'detour_limit' end;
  end if;
  insert into public.plan_usage (user_id, day, kind, key) values (p_user, v_day, v_kind, p_key);
  return 'ok';
end $$;
revoke execute on function public.plan_allowed(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.plan_allowed(uuid, boolean, text, boolean) to service_role;

-- what's left today, for the planner screen
create function public.my_plan_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'member', coalesce((select member_since is not null from public.profiles where id = auth.uid()), false),
    'detours', (select count(distinct key) from public.plan_usage where user_id = auth.uid() and kind = 'detour' and day = (now() at time zone 'Asia/Bangkok')::date),
    'edits', (select count(distinct key) from public.plan_usage where user_id = auth.uid() and kind = 'edit' and day = (now() at time zone 'Asia/Bangkok')::date),
    'max_detours', 3, 'max_edits', 10)
$$;
revoke execute on function public.my_plan_usage() from public, anon;
grant execute on function public.my_plan_usage() to authenticated;

-- ---------- Plus: coins every day you open the app, a Plus-only shelf, the Plus title ----------
create table public.plus_logins (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  coins int not null default 20 check (coins >= 0),
  primary key (user_id, day)
);
alter table public.plus_logins enable row level security;

create function public.plus_daily() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and plus_until > now()) then return 0; end if;
  insert into public.plus_logins (user_id, day) values (auth.uid(), (now() at time zone 'Asia/Bangkok')::date) on conflict do nothing;
  return case when found then 20 else 0 end;
end $$;
revoke execute on function public.plus_daily() from public, anon;
grant execute on function public.plus_daily() to authenticated;

alter table public.shop_items add column plus_only boolean not null default false;
insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort, gacha_only, plus_only) values
  ('title', 'plus-explorer', 'Plus explorer', 'นักสำรวจพลัส', 300, true, 20, false, true),
  ('frame', 'holo', 'Holo foil', 'ฟอยล์รุ้ง', 300, true, 20, false, true),
  ('frame', 'aurora', 'Aurora', 'แสงเหนือ', 300, true, 21, false, true),
  ('flair', 'aurora', 'Aurora', 'แสงเหนือ', 300, true, 20, false, true);

-- ---------- bookings ----------
create table public.bookings (
  id bigserial primary key,
  place_id bigint not null references public.places on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  day date not null,
  party smallint not null check (party between 1 and 20),
  note text check (char_length(note) <= 300),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'completed', 'cancelled')),
  fee_thb numeric not null default 20 check (fee_thb >= 0),
  charged_thb numeric check (charged_thb >= 0),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  completed_at timestamptz
);
create index bookings_user on public.bookings (user_id, status);
create index bookings_shop on public.bookings (shop_id, status, day);
alter table public.bookings enable row level security;

create function public.request_booking(p_place bigint, p_day date, p_party int, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_today date := (now() at time zone 'Asia/Bangkok')::date; v_id bigint;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.places_tiers(array[p_place])) then raise exception 'not_bookable' using errcode = 'P0001'; end if;
  if p_day is null or p_day < v_today or p_day > v_today + 180 then raise exception 'bad_day' using errcode = 'P0001'; end if;
  if p_party is null or p_party not between 1 and 20 then raise exception 'bad_party' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('bookings:' || auth.uid()::text));
  if (select count(*) from public.bookings where user_id = auth.uid() and status in ('requested', 'accepted') and day >= v_today) >= 5 then
    raise exception 'too_many_bookings' using errcode = 'P0001';
  end if;
  select shop_id into v_shop from public.places where id = p_place;
  insert into public.bookings (place_id, user_id, shop_id, day, party, note)
  values (p_place, auth.uid(), v_shop, p_day, p_party, nullif(btrim(left(p_note, 300)), ''))
  returning id into v_id;
  return v_id;
end $$;

create function public.my_bookings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'place_id', b.place_id, 'place', p.name, 'day', b.day, 'party', b.party,
           'note', b.note, 'status', b.status) order by b.day desc, b.id desc), '[]')
    from public.bookings b join public.places p on p.id = b.place_id
   where b.user_id = auth.uid() and b.created_at > now() - interval '180 days'
$$;

create function public.cancel_booking(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'cancelled', answered_at = now()
   where id = p_id and user_id = auth.uid() and status in ('requested', 'accepted');
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

-- the shop sees the guest's nickname, party size, day and note only (PDPA: no email or phone)
create function public.shop_bookings(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'place', p.name, 'guest', coalesce(pr.nickname, 'Guest'), 'day', b.day, 'party', b.party,
           'note', b.note, 'status', b.status, 'fee', b.fee_thb, 'charged', b.charged_thb) order by b.day, b.id), '[]')
    from public.bookings b join public.places p on p.id = b.place_id left join public.profiles pr on pr.id = b.user_id
   where b.shop_id = p_shop and exists (select 1 from public.shops s where s.id = p_shop and s.owner_id = auth.uid())
     and b.day >= (now() at time zone 'Asia/Bangkok')::date - 30
$$;

create function public.answer_booking(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings b set status = case when p_accept then 'accepted' else 'declined' end, answered_at = now()
    from public.shops s
   where b.id = p_id and s.id = b.shop_id and s.owner_id = auth.uid() and b.status = 'requested';
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

revoke execute on function public.request_booking(bigint, date, int, text), public.my_bookings(), public.cancel_booking(bigint),
  public.shop_bookings(uuid), public.answer_booking(bigint, boolean) from public, anon;
grant execute on function public.request_booking(bigint, date, int, text), public.my_bookings(), public.cancel_booking(bigint),
  public.shop_bookings(uuid), public.answer_booking(bigint, boolean) to authenticated;

-- ---------- coins and levels for everyone; membership no longer gates them ----------
CREATE OR REPLACE FUNCTION public.coins_of(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    coalesce((select sum(coins) from public.stamps where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.challenge_claims where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.fortune_pulls where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.weekly_awards where user_id = p_user), 0)
    + 50 * (public.level_for(pr.xp) - 1)
    + coalesce((select sum(coins) from public.plus_logins where user_id = p_user), 0)
    - coalesce((select sum(coins) from public.coin_spends where user_id = p_user), 0)
  from public.profiles pr where pr.id = p_user
$function$;

CREATE OR REPLACE FUNCTION public.unlock_level(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select public.level_for(xp) from public.profiles where id = p_user), 0)
$function$;

CREATE OR REPLACE FUNCTION public.buy_item(p_kind text, p_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_item public.shop_items;
begin
  perform 1 from public.profiles where id = auth.uid() for update;   -- one purchase at a time per user
  select * into v_item from public.shop_items where kind = p_kind and id = p_id;
  if not found or v_item.gacha_only then raise exception 'bad_item' using errcode = 'P0001'; end if;
  if v_item.plus_only then raise exception 'plus_only' using errcode = 'P0001'; end if;
  if v_item.price = 0 or exists (select 1 from public.coin_spends where user_id = auth.uid() and kind = p_kind and item_id = p_id) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if public.coins_of(auth.uid()) < v_item.price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  insert into public.coin_spends (user_id, kind, item_id, coins) values (auth.uid(), p_kind, p_id, v_item.price);
  return public.coins_of(auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.buy_set(p_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_price int;
begin
  perform 1 from public.profiles where id = auth.uid() for update;
  if not exists (select 1 from public.shop_sets where id = p_id) then raise exception 'bad_item' using errcode = 'P0001'; end if;
  select coalesce(sum(coins), 0) into v_price from public.set_missing(auth.uid(), p_id);
  if v_price = 0 then raise exception 'already_owned' using errcode = 'P0001'; end if;
  if public.coins_of(auth.uid()) < v_price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  insert into public.coin_spends (user_id, kind, item_id, coins) select auth.uid(), kind, item_id, coins from public.set_missing(auth.uid(), p_id);
  return public.coins_of(auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_quest(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c record; v_before int; v_after int;
  v_plus boolean := exists (select 1 from public.profiles where id = auth.uid() and plus_until > now());
  v_member boolean := exists (select 1 from public.profiles where id = auth.uid() and member_since is not null);
  v_coins int;
begin
  select * into c from public.challenge_progress(auth.uid()) p where p.slug = p_slug and p.have >= p.need and not p.claimed limit 1;
  if not found then raise exception 'not_ready' using errcode = 'P0001'; end if;
  v_coins := case when v_plus then round(c.coins * 1.25) else c.coins end;
  select xp into v_before from public.profiles where id = auth.uid() for update;
  insert into public.challenge_claims (user_id, slug, period, xp, coins) values (auth.uid(), c.slug, c.period, c.xp, v_coins) on conflict do nothing;
  if not found then raise exception 'not_ready' using errcode = 'P0001'; end if;   -- claimed a moment ago
  update public.profiles set xp = xp + c.xp where id = auth.uid() returning xp into v_after;
  perform public.grant_fortune_ticket(auth.uid());   -- each finished quest: a bonus Siam Si shake
  insert into public.activity (user_id, kind, data)
  values (auth.uid(), 'challenge', jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', v_coins));
  if public.level_for(v_after) > public.level_for(v_before) then
    insert into public.activity (user_id, kind, data) values (auth.uid(), 'level', jsonb_build_object('level', public.level_for(v_after)));
  end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', v_coins, 'member', v_member,
    'level', public.level_for(v_after), 'level_up', public.level_for(v_after) > public.level_for(v_before),
    'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_checkin_v5(p_user uuid, p_place bigint, p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text, p_face_count integer, p_qr text DEFAULT NULL::text, p_client jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_place public.places;
  v_level int := public.unlock_level(p_user);
  v_result jsonb;
  v_before int;
  v_after int;
  v_member boolean;
  v_booking public.bookings;
  v_plus boolean;
  v_new_province boolean := false;
  v_xp int := 0;
  v_coins int := 0;
  v_event text;
  v_challenges jsonb := '[]';
  v_trip uuid;
  v_badges_before jsonb := public.achievements(p_user);
  v_badges_new jsonb := '[]';
  ch jsonb;
  v_group boolean := false;
  b record;
begin
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;
  if not public.place_open_to(v_place, v_level) then
    return jsonb_build_object('status', 'rejected', 'reasons', jsonb_build_array('level_locked'),
                              'rewarded', false, 'required_level', v_place.min_level, 'level', v_level,
                              'new_badges', '[]'::jsonb, 'xp_gained', 0);
  end if;

  v_result := public.record_checkin(p_user, p_place, p_lat, p_lng, p_accuracy, p_selfie_path, p_face_count, p_qr, p_client);
  select xp, member_since is not null, coalesce(plus_until > now(), false) into v_before, v_member, v_plus
    from public.profiles where id = p_user;

  if (v_result->>'rewarded')::boolean then
    -- first visit: a stamp. XP and coins for everyone.
    v_new_province := v_place.province_id is not null
      and not exists (select 1 from public.stamps where user_id = p_user and province_id = v_place.province_id);
    v_xp := case v_place.tier when 3 then 150 when 2 then 75 else 30 end + case when v_new_province then 100 else 0 end;
    v_coins := case v_place.tier when 3 then 30 when 2 then 10 else 3 end;
    if v_plus then v_coins := round(v_coins * 1.25); end if;
    -- supporting OTOP and community enterprises pays more
    if v_place.otop or v_place.community then v_xp := round(v_xp * 1.5); end if;
    -- a Siam Si XP boost (Rare/Epic prize) still running
    if exists (select 1 from public.profiles where id = p_user and xp_boost_until > now()) then v_xp := round(v_xp * 1.5); end if;

    -- ride along: another member of my running trip checked in here in the last hour, so both stamps get +50%
    v_trip := public.active_trip(p_user);
    if v_trip is not null then
      v_group := public.group_partner_here(v_trip, p_user, p_place);
    end if;
    if v_group then
      v_xp := round(v_xp * 1.5); v_coins := round(v_coins * 1.5);
      for b in
        select st.user_id, round(st.xp * 0.5)::int as add_xp, round(st.coins * 0.5)::int as add_coins
          from public.stamps st join public.trip_members m on m.user_id = st.user_id
         where m.trip_id = v_trip and m.left_at is null and st.user_id <> p_user
           and st.place_id = p_place and not st.group_bonus and st.earned_at > now() - interval '60 minutes'
           and st.earned_at >= m.joined_at
           for update of st
      loop
        update public.stamps set group_bonus = true, xp = xp + b.add_xp, coins = coins + b.add_coins
         where user_id = b.user_id and place_id = p_place;
        update public.profiles set xp = xp + b.add_xp where id = b.user_id;
        -- riding along: a bonus shake each, at most 3 a day (so two accounts of one person can't farm them)
        if (select count(*) from public.stamps where user_id = b.user_id and group_bonus and earned_at > now() - interval '24 hours') <= 3 then
          perform public.grant_fortune_ticket(b.user_id);
        end if;
      end loop;
      if (select count(*) from public.stamps where user_id = p_user and group_bonus and earned_at > now() - interval '24 hours') < 3 then
        perform public.grant_fortune_ticket(p_user);
      end if;
    end if;

    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug, group_bonus)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event, v_group)
    on conflict do nothing;
    update public.profiles set xp = xp + v_xp where id = p_user;
    if v_new_province then perform public.grant_fortune_ticket(p_user); end if;   -- a new province: a bonus shake
  end if;
  -- finished quests wait for you to claim them (Quests tab: tap Claim, the chest opens); here they're only reported as ready
  if v_result->>'status' = 'approved' then
    select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', c.coins, 'ready', true)), '[]')
      into v_challenges from public.challenge_progress(p_user) c where c.have >= c.need and not c.claimed;
  end if;
  select xp into v_after from public.profiles where id = p_user;

  -- the feed: what happened on this check-in
  if (v_result->>'rewarded')::boolean then
    insert into public.activity (user_id, kind, place_id, province_id, checkin_id, data)
    values (p_user, 'stamp', p_place, v_place.province_id, (v_result->>'checkin_id')::uuid,
            jsonb_build_object('tier', v_place.tier, 'group_bonus', v_group));
    if v_new_province then
      insert into public.activity (user_id, kind, place_id, province_id, checkin_id)
      values (p_user, 'province', p_place, v_place.province_id, (v_result->>'checkin_id')::uuid);
    end if;
  end if;
  -- a booking made through Giggles Maps is done once the guest checks in there (around the booked day): the shop pays the flat fee
  if v_result->>'status' <> 'rejected' then
    update public.bookings set status = 'completed', completed_at = now()
     where id = (select id from public.bookings where user_id = p_user and place_id = p_place and status = 'accepted'
                   and day between (now() at time zone 'Asia/Bangkok')::date - 1 and (now() at time zone 'Asia/Bangkok')::date + 1
                 order by day limit 1)
    returning * into v_booking;
    if found then
      update public.bookings set charged_thb = least(v_booking.fee_thb, s.wallet_thb) from public.shops s
       where bookings.id = v_booking.id and s.id = v_booking.shop_id;
      update public.shops set wallet_thb = wallet_thb - least(v_booking.fee_thb, wallet_thb) where id = v_booking.shop_id;
    end if;
  end if;
  if public.level_for(v_after) > public.level_for(v_before) then
    insert into public.activity (user_id, kind, data) values (p_user, 'level', jsonb_build_object('level', public.level_for(v_after)));
  end if;
  select coalesce(jsonb_agg(n), '[]') into v_badges_new
    from jsonb_array_elements(public.achievements(p_user)) n
    join jsonb_array_elements(v_badges_before) o on o->>'slug' = n->>'slug'
   where (n->>'tier')::int > (o->>'tier')::int;
  for ch in select * from jsonb_array_elements(v_badges_new) loop
    insert into public.activity (user_id, kind, data) values (p_user, 'badge', ch);
  end loop;

  return v_result || jsonb_build_object(
    'stamp', case when (v_result->>'rewarded')::boolean then jsonb_build_object(
               'tier', v_place.tier, 'new_province', v_new_province, 'event', v_event,
               'province', (select name_en from public.provinces where id = v_place.province_id)) end,
    'group_bonus', v_group,
    'badges', v_badges_new,
    'challenges', v_challenges,
    'xp_gained', v_after - v_before, 'xp', v_after, 'member', v_member,
    'coins', public.coins_of(p_user),
    'level', public.level_for(v_after),
    'level_up', public.level_for(v_after) > public.level_for(v_before),
    -- a first visit earns a Siam Si shake for this check-in (shake_fortune)
    'shake', coalesce((v_result->>'rewarded')::boolean, false),
    'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = p_user), 0));
end;
$function$;
