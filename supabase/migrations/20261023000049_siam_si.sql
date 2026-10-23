-- Siam Si (เซียมซี) fortune sticks: every first-visit check-in earns a shake; quests, new provinces and ride-along
-- stamps earn bonus shakes (up to 5 kept). A shake gives a numbered stick (its fortune is in the app) and a prize:
-- coins, XP, an XP boost or a cosmetic. Free and earned only (never bought), odds published, pity guaranteed.
--   rarity      odds (at a landmark)   prize
--   common      60% (45%)              10-20 coins or +30 XP
--   rare        30% (38%)              40-60 coins, 24 h x1.5 XP, or a shop cosmetic up to 150 you don't own
--   epic         9% (14%)              120 coins, 3-day x1.5 XP, or a shop cosmetic 200-500 you don't own
--   legendary    1% (3%)               a Siam Si-only cosmetic you don't own (else 500 coins)
-- pity: the 10th shake in a row without a rare or better is rare; the 80th without a legendary is legendary.

alter table public.profiles add column if not exists xp_boost_until timestamptz;
alter table public.shop_items add column if not exists gacha_only boolean not null default false;
insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort, gacha_only) values
  ('title', 'fortune-favourite', 'Fortune''s favourite', 'ขวัญใจเซียมซี', 600, false, 90, true),
  ('title', 'siam-si-master', 'Siam Si master', 'เซียนเซียมซี', 1000, false, 91, true),
  ('frame', 'naga', 'Golden naga', 'พญานาคทอง', 600, false, 90, true),
  ('flair', 'fortune', 'Fortune', 'โชคดี', 400, false, 90, true),
  ('theme', 'red-lacquer', 'Red lacquer', 'รักแดง', 600, false, 90, true)
on conflict do nothing;

create table if not exists public.fortune_pulls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  checkin_id uuid unique references public.checkins on delete set null,   -- one shake per check-in
  source text not null check (source in ('checkin', 'bonus')),
  stick smallint not null check (stick between 1 and 28),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  prize_kind text not null check (prize_kind in ('coins', 'xp', 'boost', 'item')),
  coins int not null default 0 check (coins >= 0),
  xp int not null default 0 check (xp >= 0),
  boost_hours int not null default 0 check (boost_hours >= 0),
  item_kind text, item_id text,
  created_at timestamptz not null default now()
);
create index if not exists fortune_pulls_user on public.fortune_pulls (user_id, id desc);
alter table public.fortune_pulls enable row level security;
drop policy if exists "read own pulls" on public.fortune_pulls;
create policy "read own pulls" on public.fortune_pulls for select to authenticated using (user_id = auth.uid());

create table if not exists public.fortune_tickets (
  user_id uuid primary key references auth.users on delete cascade,
  balance int not null default 0 check (balance between 0 and 5),
  granted_total int not null default 0
);
alter table public.fortune_tickets enable row level security;
drop policy if exists "read own tickets" on public.fortune_tickets;
create policy "read own tickets" on public.fortune_tickets for select to authenticated using (user_id = auth.uid());

alter table public.activity drop constraint if exists activity_kind_check;
alter table public.activity add constraint activity_kind_check
  check (kind in ('stamp', 'province', 'level', 'challenge', 'badge', 'nudge', 'fortune'));

-- coins from Siam Si join the member coin balance, like stamps and quests
create or replace function public.coins_of(p_user uuid) returns int
language sql stable set search_path = '' as $$
  select case when pr.member_since is null then 0 else
    coalesce((select sum(coins) from public.stamps where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.challenge_claims where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.fortune_pulls where user_id = p_user), 0)
    + 50 * (public.level_for(pr.xp) - 1)
    - coalesce((select sum(coins) from public.coin_spends where user_id = p_user), 0) end
  from public.profiles pr where pr.id = p_user
$$;

-- Siam Si-only cosmetics can't be bought
create or replace function public.buy_item(p_kind text, p_id text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_item public.shop_items; v_member boolean;
begin
  select member_since is not null into v_member from public.profiles where id = auth.uid() for update;
  if not coalesce(v_member, false) then raise exception 'members_only' using errcode = 'P0001'; end if;
  select * into v_item from public.shop_items where kind = p_kind and id = p_id;
  if not found or v_item.gacha_only then raise exception 'bad_item' using errcode = 'P0001'; end if;
  if v_item.price = 0 or exists (select 1 from public.coin_spends where user_id = auth.uid() and kind = p_kind and item_id = p_id) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if public.coins_of(auth.uid()) < v_item.price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  insert into public.coin_spends (user_id, kind, item_id, coins) values (auth.uid(), p_kind, p_id, v_item.price);
  return public.coins_of(auth.uid());
end;
$$;

create or replace function public.grant_fortune_ticket(p_user uuid, p_n int default 1) returns void
language sql security definer set search_path = '' as $$
  insert into public.fortune_tickets (user_id, balance, granted_total) values (p_user, least(5, p_n), p_n)
  on conflict (user_id) do update set balance = least(5, public.fortune_tickets.balance + p_n),
                                     granted_total = public.fortune_tickets.granted_total + p_n
$$;

-- the published odds, with pity; pure so it can be tested and simulated
create or replace function public.fortune_rarity(p_roll float8, p_landmark boolean, p_since_rare int, p_since_legendary int)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_since_legendary >= 79 then 'legendary'
    when p_roll < l then 'legendary'
    when p_roll < l + e then 'epic'
    when p_roll < l + e + r then 'rare'
    when p_since_rare >= 9 then 'rare'
    else 'common' end
  from (select case when p_landmark then 0.03 else 0.01 end l, case when p_landmark then 0.14 else 0.09 end e,
               case when p_landmark then 0.38 else 0.30 end r) o
$$;

create or replace function public.shake_fortune(p_checkin uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_landmark boolean := false;
  v_source text;
  v_since_rare int; v_since_legendary int;
  v_rarity text; v_stick int; v_r float8;
  v_kind text; v_coins int := 0; v_xp int := 0; v_hours int := 0;
  v_item public.shop_items;
begin
  if v_user is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_user for update;   -- one shake at a time per traveller
  if p_checkin is not null then
    -- your own first-visit check-in from the last day, not shaken yet
    select p.tier = 3 into v_landmark from public.checkins c join public.places p on p.id = c.place_id
     where c.id = p_checkin and c.user_id = v_user and c.rewarded and c.status = 'approved'
       and c.created_at > now() - interval '24 hours'
       and not exists (select 1 from public.fortune_pulls f where f.checkin_id = c.id);
    if not found then raise exception 'nothing_to_shake' using errcode = 'P0001'; end if;
    v_source := 'checkin';
  else
    update public.fortune_tickets set balance = balance - 1 where user_id = v_user and balance > 0;
    if not found then raise exception 'nothing_to_shake' using errcode = 'P0001'; end if;
    v_source := 'bonus';
  end if;

  select count(*) into v_since_rare from public.fortune_pulls
   where user_id = v_user and id > coalesce((select max(id) from public.fortune_pulls where user_id = v_user and rarity <> 'common'), 0);
  select count(*) into v_since_legendary from public.fortune_pulls
   where user_id = v_user and id > coalesce((select max(id) from public.fortune_pulls where user_id = v_user and rarity = 'legendary'), 0);
  v_rarity := public.fortune_rarity(random(), v_landmark, v_since_rare, v_since_legendary);
  v_stick := 1 + floor(random() * 28)::int;
  v_r := random();

  -- a cosmetic you don't own yet, from this rarity's shelf; none left = coins instead
  if (v_rarity = 'rare' and v_r >= 0.7) or (v_rarity = 'epic' and v_r >= 0.6) or v_rarity = 'legendary' then
    select * into v_item from public.shop_items i
     where case v_rarity when 'legendary' then i.gacha_only
                         when 'epic' then not i.gacha_only and i.price between 200 and 500
                         else not i.gacha_only and i.price between 1 and 150 end
       and not exists (select 1 from public.coin_spends s where s.user_id = v_user and s.kind = i.kind and s.item_id = i.id)
     order by random() limit 1;
  end if;
  if v_item.id is not null then
    v_kind := 'item';
    insert into public.coin_spends (user_id, kind, item_id, coins) values (v_user, v_item.kind, v_item.id, 0) on conflict do nothing;
  elsif v_rarity = 'common' then
    if v_r < 0.5 then v_kind := 'coins'; v_coins := 10 + floor(random() * 11)::int; else v_kind := 'xp'; v_xp := 30; end if;
  elsif v_rarity = 'rare' then
    if v_r < 0.4 or v_r >= 0.7 then v_kind := 'coins'; v_coins := case when v_r >= 0.7 then 75 else 40 + floor(random() * 21)::int end;
    else v_kind := 'boost'; v_hours := 24; end if;
  elsif v_rarity = 'epic' then
    if v_r < 0.35 or v_r >= 0.6 then v_kind := 'coins'; v_coins := case when v_r >= 0.6 then 175 else 120 end;
    else v_kind := 'boost'; v_hours := 72; end if;
  else
    v_kind := 'coins'; v_coins := 500;
  end if;
  if v_xp > 0 then update public.profiles set xp = xp + v_xp where id = v_user; end if;
  if v_hours > 0 then
    update public.profiles set xp_boost_until = greatest(coalesce(xp_boost_until, now()), now()) + make_interval(hours => v_hours)
     where id = v_user;
  end if;

  insert into public.fortune_pulls (user_id, checkin_id, source, stick, rarity, prize_kind, coins, xp, boost_hours, item_kind, item_id)
  values (v_user, p_checkin, v_source, v_stick, v_rarity, v_kind, v_coins, v_xp, v_hours, v_item.kind, v_item.id);
  if v_rarity in ('epic', 'legendary') then
    insert into public.activity (user_id, kind, data) values (v_user, 'fortune',
      jsonb_build_object('rarity', v_rarity, 'stick', v_stick, 'prize', v_kind, 'item', v_item.name_en, 'coins', v_coins));
  end if;

  return jsonb_build_object('stick', v_stick, 'rarity', v_rarity, 'prize', v_kind, 'coins', v_coins, 'xp', v_xp,
    'boost_hours', v_hours, 'item_kind', v_item.kind, 'item_id', v_item.id, 'item_en', v_item.name_en, 'item_th', v_item.name_th,
    'xp_boost_until', (select xp_boost_until from public.profiles where id = v_user),
    'member', (select member_since is not null from public.profiles where id = v_user),
    'tickets', coalesce((select balance from public.fortune_tickets where user_id = v_user), 0));
end;
$$;

CREATE OR REPLACE FUNCTION public.claim_challenges(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_plus boolean := exists (select 1 from public.profiles where id = p_user and plus_until > now());
  v_out jsonb := '[]';
  c record;
begin
  for c in select * from public.challenge_progress(p_user) where have >= need and not claimed loop
    insert into public.challenge_claims (user_id, slug, period, xp, coins)
    values (p_user, c.slug, c.period, c.xp, case when v_plus then round(c.coins * 1.25) else c.coins end)
    on conflict do nothing;
    if found then
      update public.profiles set xp = xp + c.xp where id = p_user;
      perform public.grant_fortune_ticket(p_user);   -- each finished quest: a bonus Siam Si shake
      v_out := v_out || jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', c.coins);
    end if;
  end loop;
  return v_out;
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
    -- first visit: a stamp. XP is banked for everyone (free users unlock it by joining); coins count for members.
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
        perform public.grant_fortune_ticket(b.user_id);   -- riding along: a bonus shake each
      end loop;
      perform public.grant_fortune_ticket(p_user);
    end if;

    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug, group_bonus)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event, v_group)
    on conflict do nothing;
    update public.profiles set xp = xp + v_xp where id = p_user;
    if v_new_province then perform public.grant_fortune_ticket(p_user); end if;   -- a new province: a bonus shake
  end if;
  if v_result->>'status' = 'approved' then v_challenges := public.claim_challenges(p_user); end if;
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
  if v_member and public.level_for(v_after) > public.level_for(v_before) then
    insert into public.activity (user_id, kind, data) values (p_user, 'level', jsonb_build_object('level', public.level_for(v_after)));
  end if;
  for ch in select * from jsonb_array_elements(v_challenges) loop
    insert into public.activity (user_id, kind, data) values (p_user, 'challenge', ch);
  end loop;
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

create or replace function public.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('member', pr.member_since is not null, 'xp', pr.xp, 'plus_until', pr.plus_until,
           'nickname', pr.nickname, 'colour', pr.colour, 'friend_code', pr.friend_code, 'on_leaderboard', pr.on_leaderboard,
           'avatar', pr.avatar, 'joined', pr.created_at, 'coins', public.coins_of(pr.id), 'is_admin', pr.is_admin,
           'provinces', (select count(distinct province_id) from public.stamps where user_id = pr.id and province_id is not null),
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)),
           'owned', coalesce((select jsonb_agg(s.kind || ':' || s.item_id) from public.coin_spends s where s.user_id = pr.id), '[]'),
           'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = pr.id), 0),
           'xp_boost_until', case when pr.xp_boost_until > now() then pr.xp_boost_until end)
    from public.profiles pr where pr.id = auth.uid()
$$;

revoke execute on function public.shake_fortune(uuid) from public, anon;
grant execute on function public.shake_fortune(uuid) to authenticated;
revoke execute on function public.grant_fortune_ticket(uuid, int), public.fortune_rarity(float8, boolean, int, int)
  from public, anon, authenticated;
