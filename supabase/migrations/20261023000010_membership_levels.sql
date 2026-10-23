-- Monetization v4 (docs/MONETIZATION.md): one-time membership unlocks levels and exclusive places;
-- Giggles Plus is cosmetic only (themes, flair, share cards, a monthly stamp). 240-minute detours for everyone.
-- Shops are unchanged (v3).

-- ---------- security fix: clients could PATCH their own profile (incl. plus_until) ----------
drop policy if exists "own profile update" on public.profiles;
revoke update, insert, delete on public.profiles from anon, authenticated;

-- ---------- users ----------
alter table public.profiles
  add column member_since timestamptz,
  add column xp int not null default 0 check (xp >= 0),
  add column cosmetics jsonb not null default '{}';

-- Level curve: L1 0, L2 300, L3 800, L4 1500, L5 2500, L6 4000, L7 6000, L8 8500, L9 11500, L10 15000
create or replace function public.level_for(p_xp int) returns int
language sql immutable set search_path = '' as $$
  select 1 + count(*)::int from unnest(array[300, 800, 1500, 2500, 4000, 6000, 8500, 11500, 15000]) t where p_xp >= t
$$;

-- the level that counts for unlocking: members only; non-members bank XP but use level 0
create or replace function public.unlock_level(p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when member_since is not null then public.level_for(xp) else 0 end
                   from public.profiles where id = p_user), 0)
$$;
revoke execute on function public.unlock_level(uuid) from public, anon, authenticated;

-- ---------- exclusive places ----------
alter table public.places
  add column min_level int not null default 0 check (min_level between 0 and 10),
  add column exclusive_kind text check (exclusive_kind in ('gem', 'perk', 'event')),
  add column perk_text text,
  add column event_starts timestamptz,
  add column event_ends timestamptz;

create or replace function public.place_open_to(p public.places, p_level int) returns boolean
language sql stable set search_path = '' as $$
  select p.min_level = 0
      or (p.min_level <= p_level
          and (p.exclusive_kind is distinct from 'event' or now() between coalesce(p.event_starts, '-infinity') and coalesce(p.event_ends, 'infinity')))
$$;

-- routes and cards: same quality-only ranking as v3, plus the level gate
drop function public.detour_candidates(float8, float8, float8, float8, float8, int);
create or replace function public.detour_candidates(
  o_lat float8, o_lng float8, d_lat float8, d_lng float8, extra_m float8, max_n int default 16, p_level int default 0)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
               open_min int, close_min int, dwell_min int, rating numeric, is_partner boolean, is_demo boolean,
               min_level int, exclusive_kind text, perk_text text)
language sql stable security definer set search_path = ''
as $$
  with b as (
    select extensions.st_point(o_lng, o_lat)::extensions.geography o,
           extensions.st_point(d_lng, d_lat)::extensions.geography d
  )
  select p.id, p.name, p.name_th, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.open_min, p.close_min, p.dwell_min, p.rating,
         p.is_partner and p.shop_id is not null, p.is_demo, p.min_level, p.exclusive_kind, p.perk_text
  from public.places p cross join b
  where public.place_open_to(p, p_level)
    and extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
    and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
        <= extensions.st_distance(b.o, b.d) + extra_m
  order by p.rating desc,
           extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d), p.id
  limit max_n;
$$;
grant execute on function public.detour_candidates(float8, float8, float8, float8, float8, int, int) to anon, authenticated;

drop function public.places_near(float8, float8, float8, numeric);
create or replace function public.places_near(p_lat float8, p_lng float8, p_radius_m float8,
                                              p_min_rating numeric default 4.0, p_level int default 0)
returns table (id bigint, name text, category text, lat float8, lng float8, rating numeric,
               is_partner boolean, dist_m float8, is_demo boolean, min_level int, exclusive_kind text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.category,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.rating, p.is_partner and p.shop_id is not null,
         extensions.st_distance(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography), p.is_demo,
         p.min_level, p.exclusive_kind
  from public.places p
  where p.rating >= p_min_rating and public.place_open_to(p, p_level)
    and extensions.st_dwithin(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography, p_radius_m)
  order by p.rating desc, 8;
$$;
grant execute on function public.places_near(float8, float8, float8, numeric, int) to anon, authenticated;

-- Passport "Exclusive" list: every exclusive place; locked ones hide their location and perk.
create or replace function public.my_exclusives()
returns table (id bigint, name text, category text, exclusive_kind text, min_level int, unlocked boolean,
               lat float8, lng float8, perk_text text, event_starts timestamptz, event_ends timestamptz, is_demo boolean)
language sql stable security definer set search_path = ''
as $$
  with me as (select public.unlock_level(auth.uid()) lvl)
  select p.id, p.name, p.category, p.exclusive_kind, p.min_level, public.place_open_to(p, me.lvl),
         case when public.place_open_to(p, me.lvl) then extensions.st_y(p.location::extensions.geometry) end,
         case when public.place_open_to(p, me.lvl) then extensions.st_x(p.location::extensions.geometry) end,
         case when public.place_open_to(p, me.lvl) then p.perk_text end,
         p.event_starts, p.event_ends, p.is_demo
  from public.places p cross join me
  where p.min_level > 0
  order by p.min_level, p.name;
$$;
grant execute on function public.my_exclusives() to authenticated;

-- ---------- check-in: level gate in front, XP after ----------
-- XP: +100 per rewarded check-in, +50 at a partner shop, +100 for the first visit to a new kind of place.
create or replace function public.record_checkin_v4(
  p_user uuid, p_place bigint, p_lat float8, p_lng float8, p_accuracy float8,
  p_selfie_path text, p_face_count int, p_qr text default null, p_client jsonb default '{}')
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_place public.places;
  v_level int := public.unlock_level(p_user);
  v_result jsonb;
  v_gain int := 0;
  v_before int;
  v_after int;
  v_member boolean;
begin
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;
  if not public.place_open_to(v_place, v_level) then
    return jsonb_build_object('status', 'rejected', 'reasons', jsonb_build_array('level_locked'),
                              'rewarded', false, 'required_level', v_place.min_level, 'level', v_level,
                              'new_badges', '[]'::jsonb, 'xp_gained', 0);
  end if;

  v_result := public.record_checkin(p_user, p_place, p_lat, p_lng, p_accuracy, p_selfie_path, p_face_count, p_qr, p_client);

  select xp, member_since is not null into v_before, v_member from public.profiles where id = p_user;
  if (v_result->>'rewarded')::boolean then
    v_gain := 100
      + case when v_place.is_partner and v_place.shop_id is not null then 50 else 0 end
      + case when not exists (
          select 1 from public.checkins ch join public.places pl on pl.id = ch.place_id
           where ch.user_id = p_user and ch.rewarded and pl.category = v_place.category
             and ch.id <> (v_result->>'checkin_id')::uuid) then 100 else 0 end;
    update public.profiles set xp = xp + v_gain where id = p_user returning xp into v_after;
  else
    v_after := v_before;
  end if;

  return v_result || jsonb_build_object(
    'xp_gained', v_gain, 'xp', v_after, 'member', v_member,
    'level', public.level_for(v_after),
    'level_up', public.level_for(v_after) > public.level_for(v_before));
end;
$$;
revoke execute on function public.record_checkin_v4(uuid, bigint, float8, float8, float8, text, int, text, jsonb) from public, anon, authenticated;

-- ---------- payments: membership (one-time) next to credit and plus ----------
alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('credit', 'plus', 'membership'));

create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric,
                                                p_shop uuid default null, p_user uuid default null)
returns boolean
language plpgsql set search_path = ''
as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind = 'plus' then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now()) + interval '30 days' where id = p_user;
  elsif p_kind = 'membership' then
    update public.profiles set member_since = coalesce(member_since, now()) where id = p_user;
  else
    raise exception 'unknown payment kind %', p_kind;
  end if;
  return true;
exception when unique_violation then
  return false;  -- Stripe retried an event we already applied
end;
$$;

-- Apple membership (non-consumable). Refund/revoke takes it away again.
create table public.apple_memberships (
  original_transaction_id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  environment text not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.apple_memberships enable row level security;

create or replace function public.apply_apple_membership(p_otid text, p_user uuid, p_env text, p_revoked timestamptz)
returns timestamptz
language plpgsql set search_path = ''
as $$
declare v_since timestamptz;
begin
  if exists (select 1 from public.apple_memberships where original_transaction_id = p_otid and user_id <> p_user) then
    raise exception 'membership belongs to another account' using errcode = 'P0001';
  end if;
  insert into public.apple_memberships (original_transaction_id, user_id, environment, revoked_at)
  values (p_otid, p_user, p_env, p_revoked)
  on conflict (original_transaction_id) do update set revoked_at = excluded.revoked_at, environment = excluded.environment, updated_at = now();
  if p_revoked is null then
    update public.profiles set member_since = coalesce(member_since, now()) where id = p_user returning member_since into v_since;
  else
    -- keep a web (Stripe) membership if there is one
    update public.profiles set member_since = null where id = p_user
      and not exists (select 1 from public.payments where user_id = p_user and kind = 'membership')
    returning member_since into v_since;
  end if;
  return v_since;
end;
$$;
revoke execute on function public.apply_apple_membership(text, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------- Plus: cosmetic choices + monthly stamp ----------
create table public.plus_stamps (
  user_id uuid references auth.users on delete cascade,
  month date,
  primary key (user_id, month)
);
alter table public.plus_stamps enable row level security;
create policy "own plus stamps" on public.plus_stamps for select using (user_id = auth.uid());

-- Saves theme/flair (Plus only) and collects this month's stamp while Plus is active.
create or replace function public.set_cosmetics(p_theme text default null, p_flair text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_plus boolean; v_cos jsonb;
begin
  select plus_until > now() into v_plus from public.profiles where id = auth.uid();
  if not coalesce(v_plus, false) then raise exception 'plus_required' using errcode = 'P0001'; end if;
  if p_theme is not null and p_theme not in ('classic', 'indigo', 'lotus', 'night-market', 'temple-gold', 'rain') then
    raise exception 'bad_theme' using errcode = 'P0001';
  end if;
  if p_flair is not null and p_flair not in ('none', 'marigold', 'indigo', 'lotus', 'sparkle') then
    raise exception 'bad_flair' using errcode = 'P0001';
  end if;
  update public.profiles set cosmetics = cosmetics
      || case when p_theme is null then '{}'::jsonb else jsonb_build_object('theme', p_theme) end
      || case when p_flair is null then '{}'::jsonb else jsonb_build_object('flair', p_flair) end
    where id = auth.uid() returning cosmetics into v_cos;
  return v_cos;
end;
$$;
grant execute on function public.set_cosmetics(text, text) to authenticated;

create or replace function public.claim_monthly_stamp() returns date
language plpgsql security definer set search_path = ''
as $$
declare v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and plus_until > now()) then return null; end if;
  insert into public.plus_stamps (user_id, month) values (auth.uid(), v_month) on conflict do nothing;
  return v_month;
end;
$$;
grant execute on function public.claim_monthly_stamp() to authenticated;

-- ---------- example exclusive places (real places, labelled Example in the apps) ----------
update public.places set min_level = 2, exclusive_kind = 'gem', is_demo = true,
  perk_text = 'Lakeside lookout locals use for sunset. Example hidden gem.'
  where id = 33;
update public.places set min_level = 4, exclusive_kind = 'perk', is_demo = true,
  perk_text = 'Members-only 20-minute indigo dyeing try-out. Example perk, not a real offer.'
  where id = 31;
update public.places set min_level = 6, exclusive_kind = 'event', is_demo = true,
  perk_text = 'Saturday and Sunday night market. Example event.',
  event_starts = '2026-10-24 17:00+07', event_ends = '2026-10-25 23:00+07'
  where id = 51;
