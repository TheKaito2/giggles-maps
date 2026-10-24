-- Level-up rewards, reviews that earn a Siam Si shake, and photos of a stop that earn coins.
--
-- Levels: each level from 2 up lets you pick one permanent perk, +10% luck (Siam Si odds) or +10% coins (every coin earned
-- after the pick), and unlocks that level's sky-themed cosmetic (shop_items.level_req), worn free once you reach it.
-- Reviews: the first review of a place you checked in at, with at least 20 characters of text, earns a bonus Siam Si shake.
-- Photos: add up to 3 photos of a place you have a stamp at to its page; the first one there pays 10 coins.

-- ---------- level perks ----------
create table public.level_perks (
  user_id uuid not null references auth.users on delete cascade,
  level int not null check (level between 2 and 100),
  perk text not null check (perk in ('luck', 'coins')),
  chosen_at timestamptz not null default now(),
  primary key (user_id, level)
);
alter table public.level_perks enable row level security;   -- read through me(), written by choose_level_perk only

-- 1 + 0.1 per pick of that perk
create or replace function public.perk_boost(p_user uuid, p_perk text) returns numeric
language sql stable security definer set search_path = '' as $$
  select 1 + 0.1 * count(*) from public.level_perks where user_id = p_user and perk = p_perk
$$;

create or replace function public.perks_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'luck', count(*) filter (where perk = 'luck'), 'coins', count(*) filter (where perk = 'coins'),
    'chosen', coalesce(jsonb_agg(jsonb_build_object('level', level, 'perk', perk) order by level), '[]'))
  from public.level_perks where user_id = p_user
$$;

create or replace function public.choose_level_perk(p_level int, p_perk text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_level int;
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if p_perk is null or p_perk not in ('luck', 'coins') then raise exception 'bad_perk' using errcode = 'P0001'; end if;
  select public.level_for(xp) into v_level from public.profiles where id = auth.uid() for update;   -- one pick at a time
  if p_level is null or p_level < 2 or p_level > coalesce(v_level, 1) then raise exception 'level_not_reached' using errcode = 'P0001'; end if;
  insert into public.level_perks (user_id, level, perk) values (auth.uid(), p_level, p_perk) on conflict do nothing;
  if not found then raise exception 'already_chosen' using errcode = 'P0001'; end if;
  return public.perks_of(auth.uid());
end;
$$;

-- coin perks: every coin ledger row a traveller earns from now on is boosted as it's written (Siam Si boosts its own,
-- in shake_fortune, so the prize it shows is the prize you get)
create or replace function public.boost_coins() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.coins > 0 then new.coins := round(new.coins * public.perk_boost(new.user_id, 'coins')); end if;
  return new;
end;
$$;
create trigger boost_coins before insert on public.stamps for each row execute function public.boost_coins();
create trigger boost_coins before insert on public.challenge_claims for each row execute function public.boost_coins();
create trigger boost_coins before insert on public.weekly_awards for each row execute function public.boost_coins();

-- ---------- level cosmetics ----------
alter table public.shop_items add column level_req int;
insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort, gacha_only, plus_only, level_req) values
  ('frame', 'cloud-puff', 'Cloud puff', 'เมฆปุย', 0, false, 200, false, false, 2),
  ('flair', 'sky', 'Sky blue', 'ฟ้าใส', 0, false, 201, false, false, 3),
  ('title', 'cloud-hopper', 'Cloud hopper', 'นักกระโดดเมฆ', 0, false, 202, false, false, 4),
  ('theme', 'blue-sky', 'Blue sky', 'ท้องฟ้าสดใส', 0, false, 203, false, false, 5),
  ('frame', 'rainbow', 'Rainbow', 'สายรุ้ง', 0, false, 204, false, false, 6),
  ('title', 'sky-captain', 'Sky captain', 'กัปตันแห่งฟ้า', 0, false, 205, false, false, 7),
  ('flair', 'sunrise', 'Sunrise', 'รุ่งอรุณ', 0, false, 206, false, false, 8),
  ('theme', 'starry-night', 'Starry night', 'คืนดาวพราว', 0, false, 207, false, false, 9),
  ('title', 'above-the-clouds', 'Above the clouds', 'เหนือเมฆ', 0, false, 208, false, false, 10);

-- ---------- reviews earn a Siam Si shake ----------
create table public.review_shakes (
  user_id uuid not null references auth.users on delete cascade,
  place_id bigint not null references public.places on delete cascade,
  primary key (user_id, place_id)
);
alter table public.review_shakes enable row level security;

drop function public.write_review(bigint, int, text);
create function public.write_review(p_place bigint, p_rating int, p_body text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_xp int := 0; v_shake boolean := false;
begin
  if not exists (select 1 from public.checkins where user_id = auth.uid() and place_id = p_place and status = 'approved') then
    raise exception 'check_in_first' using errcode = 'P0001';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'bad_rating' using errcode = 'P0001'; end if;
  insert into public.reviews (user_id, place_id, rating, body)
  values (auth.uid(), p_place, p_rating, left(nullif(trim(p_body), ''), 1000))
  on conflict (user_id, place_id) do update set rating = excluded.rating, body = excluded.body, updated_at = now();
  insert into public.review_xp values (auth.uid(), p_place) on conflict do nothing;
  if found then update public.profiles set xp = xp + 20 where id = auth.uid(); v_xp := 20; end if;
  -- a few real words about the place (not just stars) earn one bonus shake per place, ever
  if char_length(coalesce(trim(p_body), '')) >= 20 then
    insert into public.review_shakes values (auth.uid(), p_place) on conflict do nothing;
    if found then perform public.grant_fortune_ticket(auth.uid()); v_shake := true; end if;
  end if;
  return jsonb_build_object('xp', v_xp, 'shake', v_shake,
    'tickets', coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0));
end;
$$;

-- ---------- photos of a stop earn coins ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-photos', 'place-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']) on conflict (id) do nothing;
create policy "travellers upload place photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "travellers delete their place photos" on storage.objects for delete to authenticated
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.place_photos drop constraint place_photos_source_check;
alter table public.place_photos add constraint place_photos_source_check check (source in ('wikimedia', 'owner', 'traveller'));
alter table public.place_photos add column user_id uuid references auth.users on delete cascade,
  add column hidden boolean not null default false;
create unique index place_photos_traveller_url on public.place_photos (url) where source = 'traveller';
create index place_photos_user_idx on public.place_photos (user_id) where user_id is not null;

create table public.photo_rewards (
  user_id uuid not null references auth.users on delete cascade,
  place_id bigint not null references public.places on delete cascade,
  coins int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.photo_rewards enable row level security;
create trigger boost_coins before insert on public.photo_rewards for each row execute function public.boost_coins();

create table public.place_photo_reports (
  photo_id bigint not null references public.place_photos on delete cascade,
  reporter uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, reporter)
);
alter table public.place_photo_reports enable row level security;

-- p_path: "<your uid>/<file>" in the place-photos bucket, uploaded first
create or replace function public.add_place_photo(p_place bigint, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_coins int;
begin
  if v_me is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.stamps where user_id = v_me and place_id = p_place) then
    raise exception 'check_in_first' using errcode = 'P0001';
  end if;
  if p_path is null or p_path !~ ('^' || v_me::text || '/[A-Za-z0-9._-]{1,80}$')
     or not exists (select 1 from storage.objects where bucket_id = 'place-photos' and name = p_path) then
    raise exception 'bad_photo' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = v_me for update;   -- one at a time: the limits below can't be raced
  if exists (select 1 from public.place_photos where source = 'traveller' and url = 'place-photos/' || p_path) then
    raise exception 'already_added' using errcode = 'P0001';
  end if;
  if (select count(*) from public.place_photos where user_id = v_me and place_id = p_place) >= 3
     or (select count(*) from public.place_photos where user_id = v_me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'photo_limit' using errcode = 'P0001';
  end if;
  insert into public.place_photos (place_id, source, url, credit, user_id)
  values (p_place, 'traveller', 'place-photos/' || p_path, 'Explorer', v_me);
  insert into public.photo_rewards (user_id, place_id, coins) values (v_me, p_place, 10) on conflict do nothing
  returning coins into v_coins;
  return jsonb_build_object('coins_earned', coalesce(v_coins, 0), 'coins', public.coins_of(v_me));
end;
$$;

-- your own photo: off the page (the app then deletes the file); the coins you got for the place stay yours
create or replace function public.delete_place_photo(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  delete from public.place_photos where id = p_id and source = 'traveller' and user_id = auth.uid()
$$;

-- three reports from three people hide a photo until an admin looks at it
create or replace function public.report_place_photo(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  insert into public.place_photo_reports (photo_id, reporter)
  select id, auth.uid() from public.place_photos where id = p_id and source = 'traveller' and user_id is distinct from auth.uid()
  on conflict do nothing;
  update public.place_photos set hidden = true
   where id = p_id and (select count(*) from public.place_photo_reports where photo_id = p_id) >= 3;
end;
$$;



-- ---------- redefined: luck and coin perks in Siam Si ----------
CREATE OR REPLACE FUNCTION public.shake_fortune(p_checkin uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- backstop against forged check-ins: no honest day of travel needs more than 30 shakes
  if (select count(*) from public.fortune_pulls where user_id = v_user and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'shake_limit' using errcode = 'P0001';
  end if;
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
  -- luck perks (level rewards): +10% each makes every rarity above Common that much likelier
  v_rarity := public.fortune_rarity(random() / public.perk_boost(v_user, 'luck'), v_landmark, v_since_rare, v_since_legendary);
  v_stick := 1 + floor(random() * 28)::int;
  v_r := random();

  -- a cosmetic you don't own yet, from this rarity's shelf; none left = coins instead
  if (v_rarity = 'rare' and v_r >= 0.7) or (v_rarity = 'epic' and v_r >= 0.6) or v_rarity = 'legendary' then
    select * into v_item from public.shop_items i
     where case v_rarity when 'legendary' then i.gacha_only
                         when 'epic' then not i.gacha_only and not i.plus and i.price between 200 and 500
                         else not i.gacha_only and not i.plus and i.price between 1 and 150 end
       and not exists (select 1 from public.coin_spends s where s.user_id = v_user and s.kind = i.kind and s.item_id = i.id)
     order by random() limit 1;
  end if;
  if v_item.id is not null then
    v_kind := 'item';
    insert into public.coin_spends (user_id, kind, item_id, coins) values (v_user, v_item.kind, v_item.id, 0) on conflict do nothing;
  elsif v_rarity = 'common' then
    if v_r < 0.5 then v_kind := 'coins'; v_coins := 10 + floor(random() * 11)::int; else v_kind := 'xp'; v_xp := 30; end if;
  elsif v_rarity = 'rare' then
    if v_r < 0.4 or v_r >= 0.7 then v_kind := 'coins'; v_coins := 40 + floor(random() * 21)::int;   -- no item left: published coins
    else v_kind := 'boost'; v_hours := 24; end if;
  elsif v_rarity = 'epic' then
    if v_r < 0.35 or v_r >= 0.6 then v_kind := 'coins'; v_coins := 120;
    else v_kind := 'boost'; v_hours := 72; end if;
  else
    v_kind := 'coins'; v_coins := 500;
  end if;
  if v_coins > 0 then v_coins := round(v_coins * public.perk_boost(v_user, 'coins')); end if;   -- coin perks
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
$function$;

-- level cosmetics are worn once you reach their level
CREATE OR REPLACE FUNCTION public.can_wear(p_user uuid, p_kind text, p_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.shop_items i where i.kind = p_kind and i.id = p_id and (
           (i.price = 0 and i.level_req is null)
           or (i.level_req is not null and (select public.level_for(pr.xp) from public.profiles pr where pr.id = p_user) >= i.level_req)
           or exists (select 1 from public.coin_spends s where s.user_id = p_user and s.kind = p_kind and s.item_id = p_id)
           or (i.plus and exists (select 1 from public.profiles pr where pr.id = p_user and pr.plus_until > now()))))
      or (p_kind = 'title' and exists (select 1 from public.challenge_claims cc where cc.user_id = p_user and cc.slug = p_id
                                        and p_id like 'province-%'))
$function$;

-- ...and never sold
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
  if v_item.level_req is not null then raise exception 'level_reward' using errcode = 'P0001'; end if;   -- earned by levelling, never sold
  if v_item.price = 0 or exists (select 1 from public.coin_spends where user_id = auth.uid() and kind = p_kind and item_id = p_id) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if public.coins_of(auth.uid()) < v_item.price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  insert into public.coin_spends (user_id, kind, item_id, coins) values (auth.uid(), p_kind, p_id, v_item.price);
  return public.coins_of(auth.uid());
end;
$function$;

-- photo coins count
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
    + coalesce((select sum(coins) from public.photo_rewards where user_id = p_user), 0)
    - coalesce((select sum(coins) from public.coin_spends where user_id = p_user), 0)
  from public.profiles pr where pr.id = p_user
$function$;

-- your perks travel with your profile
CREATE OR REPLACE FUNCTION public.me()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('member', pr.member_since is not null, 'xp', pr.xp, 'plus_until', pr.plus_until,
           'nickname', pr.nickname, 'colour', pr.colour, 'friend_code', pr.friend_code, 'on_leaderboard', pr.on_leaderboard,
           'avatar', pr.avatar, 'joined', pr.created_at, 'coins', public.coins_of(pr.id), 'is_admin', pr.is_admin,
           'provinces', (select count(distinct province_id) from public.stamps where user_id = pr.id and province_id is not null),
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)),
           'owned', coalesce((select jsonb_agg(s.kind || ':' || s.item_id) from public.coin_spends s where s.user_id = pr.id), '[]'),
           'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = pr.id), 0),
           'xp_boost_until', case when pr.xp_boost_until > now() then pr.xp_boost_until end,
           'perks', public.perks_of(pr.id))
    from public.profiles pr where pr.id = auth.uid()
$function$;

-- a claimed quest reports the coins actually paid (after Plus and coin perks)
CREATE OR REPLACE FUNCTION public.claim_challenges(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_plus boolean := exists (select 1 from public.profiles where id = p_user and plus_until > now());
  v_out jsonb := '[]';
  c record;
  v_coins int;
begin
  for c in select * from public.challenge_progress(p_user) where have >= need and not claimed loop
    insert into public.challenge_claims (user_id, slug, period, xp, coins)
    values (p_user, c.slug, c.period, c.xp, case when v_plus then round(c.coins * 1.25) else c.coins end)
    on conflict do nothing
    returning coins into v_coins;   -- after Plus and the coin perks: what was actually paid
    if found then
      update public.profiles set xp = xp + c.xp where id = p_user;
      perform public.grant_fortune_ticket(p_user);   -- each finished quest: a bonus Siam Si shake
      v_out := v_out || jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', v_coins);
    end if;
  end loop;
  return v_out;
end;
$function$;

-- traveller photos on the place page (with who took them), and whether this place still pays for a photo or a review
CREATE OR REPLACE FUNCTION public.place_page(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'name_th', p.name_th, 'kind', p.kind, 'category', p.category, 'tier', p.tier,
    'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry),
    'opening_hours', p.opening_hours, 'phone', p.phone, 'website', p.website, 'address', p.address,
    'local', p.local, 'otop', p.otop, 'community', p.community, 'detour', p.detour,
    'rating', (select round(avg(rating), 1) from public.reviews r where r.place_id = p.id having count(*) >= 3),
    'review_count', (select count(*) from public.reviews r where r.place_id = p.id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('who', public.who_of(r.user_id), 'rating', r.rating, 'body', r.body,
                 'at', r.updated_at, 'mine', r.user_id = auth.uid()) order by r.updated_at desc)
               from (select * from public.reviews r where r.place_id = p.id order by r.updated_at desc limit 20) r), '[]'),
    'checked_in', exists (select 1 from public.checkins c where c.user_id = auth.uid() and c.place_id = p.id and c.status <> 'rejected'),
    'stamped', exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = p.id),
    'photo_reward', not exists (select 1 from public.photo_rewards r where r.user_id = auth.uid() and r.place_id = p.id),
    'review_shake', not exists (select 1 from public.review_shakes r where r.user_id = auth.uid() and r.place_id = p.id),
    'photos', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('id', ph.id, 'url', ph.url, 'credit', coalesce(pr.nickname, ph.credit), 'licence', ph.licence,
                          'source', ph.source, 'mine', ph.user_id is not null and ph.user_id = auth.uid()) x
                   from public.place_photos ph left join public.profiles pr on pr.id = ph.user_id
                  where ph.place_id = p.id and not ph.hidden
                 union all
                 select jsonb_build_object('path', c.selfie_path, 'credit', coalesce(pr.nickname, 'Explorer'), 'source', 'checkin')
                   from public.checkins c join public.profiles pr on pr.id = c.user_id
                  where c.place_id = p.id and c.public_photo and not c.photo_hidden and c.status <> 'rejected' and c.selfie_path is not null
                  limit 30) y), '[]'),
    'busy', (select case when sum(n) >= 20 then jsonb_agg(case when n < 3 then 0 else n end order by h) end from (
               select h, (select count(*) from public.checkins c where c.place_id = p.id and c.status <> 'rejected'
                           and extract(isodow from c.created_at at time zone 'Asia/Bangkok') = extract(isodow from now() at time zone 'Asia/Bangkok')
                           and extract(hour from c.created_at at time zone 'Asia/Bangkok') = h) n
                 from generate_series(6, 23) h) hist),
    'regular', public.place_regular(p.id),
    'saved_in', coalesce((select jsonb_agg(lp.list_id) from public.list_places lp join public.lists l on l.id = lp.list_id
                          where lp.place_id = p.id and l.user_id = auth.uid()), '[]'))
  from public.places p where p.id = p_id and p.min_level <= public.unlock_level(auth.uid())
$function$;

-- ---------- grants ----------
revoke execute on function public.perk_boost(uuid, text), public.perks_of(uuid), public.boost_coins() from public, anon, authenticated;
revoke execute on function public.choose_level_perk(int, text), public.write_review(bigint, int, text), public.add_place_photo(bigint, text),
  public.delete_place_photo(bigint), public.report_place_photo(bigint) from public, anon;
grant execute on function public.choose_level_perk(int, text), public.write_review(bigint, int, text), public.add_place_photo(bigint, text),
  public.delete_place_photo(bigint), public.report_place_photo(bigint) to authenticated;
