-- Passport phase 1: GPS "stops", any-photo check-ins, stamps by tier, provinces, XP/levels/coins, challenges.
-- Stamps and challenge claims are the reward ledger (each row keeps the XP and coins it gave).
-- Coins are computed: members get stamp + challenge coins + 50 per level; joining pays everything already earned.

-- ---------- provinces (77, boundaries from OpenStreetMap admin_level=4; data loaded separately) ----------
create table public.provinces (
  id smallint primary key,
  iso text unique not null,
  name_en text not null,
  name_th text not null,
  geom extensions.geography(multipolygon, 4326) not null
);
create index provinces_geom_idx on public.provinces using gist (geom);
alter table public.provinces enable row level security;
create policy "provinces are public" on public.provinces for select using (true);

alter table public.places add column province_id smallint references public.provinces;
create or replace function public.set_place_province() returns trigger
language plpgsql set search_path = '' as $$
begin
  select p.id into new.province_id from public.provinces p where extensions.st_intersects(p.geom, new.location) limit 1;
  return new;
end;
$$;
create trigger places_province before insert or update of location on public.places
  for each row execute function public.set_place_province();

-- ---------- stamps, challenge claims, events ----------
create table public.stamps (
  user_id uuid not null references auth.users on delete cascade,
  place_id bigint not null references public.places on delete cascade,
  checkin_id uuid not null references public.checkins on delete cascade,
  tier smallint not null,
  province_id smallint references public.provinces,
  xp int not null default 0,
  coins int not null default 0,
  event_slug text,
  earned_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.stamps enable row level security;
create policy "read own stamps" on public.stamps for select to authenticated using (user_id = auth.uid());

create table public.challenge_claims (
  user_id uuid not null references auth.users on delete cascade,
  slug text not null,
  period text not null,          -- YYYY-MM-DD daily, IYYY-IW weekly, all once
  xp int not null,
  coins int not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, slug, period)
);
alter table public.challenge_claims enable row level security;
create policy "read own claims" on public.challenge_claims for select to authenticated using (user_id = auth.uid());

create table public.events (
  slug text primary key,
  name_en text not null,
  name_th text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);
alter table public.events enable row level security;
create policy "events are public" on public.events for select using (true);

-- photos are the passport album now: kept until the user hides or deletes them
alter table public.checkins add column photo_hidden boolean not null default false,
                            add column caption text check (char_length(caption) <= 140);
create policy "delete own selfie" on storage.objects for delete to authenticated
  using (bucket_id = 'selfies' and (storage.foldername(name))[1] = auth.uid()::text);

-- existing first visits become stamps (no XP: it was already granted under v4)
insert into public.stamps (user_id, place_id, checkin_id, tier, earned_at)
select distinct on (c.user_id, c.place_id) c.user_id, c.place_id, c.id, p.tier, c.created_at
  from public.checkins c join public.places p on p.id = c.place_id
 where c.rewarded order by c.user_id, c.place_id, c.created_at;

-- ---------- check-in rules (v3 function, phase 1 changes) ----------
create or replace function public.record_checkin(
  p_user uuid, p_place bigint, p_lat float8, p_lng float8, p_accuracy float8,
  p_selfie_path text, p_face_count int, p_qr text default null, p_client jsonb default '{}')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_place public.places;
  v_shop public.shops;
  v_here extensions.geography := extensions.st_point(p_lng, p_lat)::extensions.geography;
  v_dist float8;
  v_radius int;
  v_reasons text[] := '{}';
  v_status text;
  v_last record;
  v_kmh float8;
  v_rewarded boolean := false;
  v_checkin uuid;
  v_qr_ok boolean := false;
  v_billed numeric := 0;
  v_billing text := 'not_partner';
  v_badges jsonb := '[]';
  v_spin jsonb := null;
  v_total int;
  v_roll float8;
  v_coupon record;
  v_code text;
  c record;
begin
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;

  v_dist := extensions.st_distance(v_place.location, v_here);
  -- the GPS stop zone: big grounds (landmarks, parks) 150 m, everything else 50 m. Any photo; no face check.
  v_radius := 50;
  if v_place.tier = 3 or v_place.category = 'park' then v_radius := 150; end if;
  if v_dist > v_radius then v_reasons := array_append(v_reasons, 'too_far'); end if;
  if p_selfie_path is null or p_selfie_path not like p_user::text || '/%' then v_reasons := array_append(v_reasons, 'no_selfie'); end if;
  if coalesce((p_client->>'is_mock')::boolean, false) then v_reasons := array_append(v_reasons, 'mock_location'); end if;

  select location, created_at into v_last from public.checkins
   where user_id = p_user and status <> 'rejected' and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if found then
    v_kmh := extensions.st_distance(v_last.location, v_here) / 1000.0
             / greatest(extract(epoch from now() - v_last.created_at) / 3600.0, 1.0 / 3600);
    if v_kmh > 150 then v_reasons := array_append(v_reasons, 'speed_jump'); end if;
  end if;

  v_status := case
    when v_reasons && array['too_far','no_selfie','mock_location','speed_jump'] then 'rejected'
    when p_accuracy > 75 then 'review'
    else 'approved' end;
  if p_accuracy > 75 then v_reasons := array_append(v_reasons, 'low_accuracy'); end if;

  if v_status = 'approved' then
    -- rewards (and the stamp) only on the first visit; later visits add photos to the passport
    v_rewarded := not exists (select 1 from public.checkins where user_id = p_user and place_id = p_place and rewarded);
    if not v_rewarded then v_reasons := array_append(v_reasons, 'already_stamped'); end if;
  end if;

  -- counter QR: proves the visitor was inside (shown to the shop as "last scan"; no effect on routing)
  v_qr_ok := v_place.qr_code is not null and upper(trim(coalesce(p_qr, ''))) = v_place.qr_code;
  if v_qr_ok and v_status <> 'rejected' then
    update public.places set last_qr_scan_at = now() where id = p_place;
  end if;

  insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, selfie_path,
                               face_count, client, status, reasons, rewarded)
  values (p_user, p_place, v_here, p_accuracy, v_dist, p_selfie_path, p_face_count,
          p_client || jsonb_build_object('qr_ok', v_qr_ok), v_status, v_reasons, v_rewarded)
  returning id into v_checkin;

  -- attribution + billing (tourist-triggered; the shop cant block it)
  if v_place.is_partner and v_place.shop_id is not null then
    select * into v_shop from public.shops where id = v_place.shop_id for update;
    v_billing := case
      when not v_rewarded then 'not_rewarded'
      when not v_qr_ok then 'no_qr'
      when not exists (select 1 from public.route_stops rs
                        where rs.user_id = p_user and rs.place_id = p_place
                          and rs.shown_at > now() - interval '3 hours') then 'not_shown_on_route'
      when exists (select 1 from public.billable_visits bv
                    where bv.user_id = p_user and bv.shop_id = v_shop.id
                      and bv.created_at > now() - interval '30 days') then 'repeat_visit_30d'
      when v_shop.wallet_thb < v_place.bid_thb then 'wallet_empty'
      else 'charged' end;
    if v_billing = 'charged' then
      update public.shops set wallet_thb = wallet_thb - v_place.bid_thb where id = v_shop.id;
      v_billed := v_place.bid_thb;
      insert into public.billable_visits (checkin_id, place_id, shop_id, user_id, amount_thb)
      values (v_checkin, p_place, v_shop.id, p_user, v_billed);
    end if;
  end if;

  if v_rewarded then
    -- badges
    for c in
      select col.id, col.slug, col.name from public.collections col
      join public.collection_places cp on cp.collection_id = col.id and cp.place_id = p_place
      where not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.collection_id = col.id)
        and (select count(distinct ch.place_id) from public.checkins ch
              join public.collection_places cp2 on cp2.place_id = ch.place_id and cp2.collection_id = col.id
             where ch.user_id = p_user and ch.rewarded) >= col.required_count
    loop
      insert into public.user_badges (user_id, collection_id) values (p_user, c.id);
      v_badges := v_badges || jsonb_build_object('slug', c.slug, 'name', c.name);
    end loop;

    -- free coupon spin: active coupons from signed-up shops with credit, within 3 km, one win per coupon per 30 days.
    -- "No prize" carries the same total weight as all prizes, so the overall win chance is 50%.
    select coalesce(sum(cp.weight), 0) into v_total
      from public.coupons cp join public.places pl on pl.id = cp.place_id join public.shops s on s.id = cp.shop_id
     where cp.active and public.shop_funded(s, pl.bid_thb)
       and extensions.st_dwithin(pl.location, v_here, 3000)
       and not exists (select 1 from public.coupon_wins w where w.coupon_id = cp.id and w.user_id = p_user
                         and w.created_at > now() - interval '30 days');
    if v_total > 0 then
      v_roll := random() * (v_total * 2);
      if v_roll < v_total then
        for v_coupon in
          select cp.id, cp.title, cp.weight, pl.name as place_name
            from public.coupons cp join public.places pl on pl.id = cp.place_id join public.shops s on s.id = cp.shop_id
           where cp.active and public.shop_funded(s, pl.bid_thb)
             and extensions.st_dwithin(pl.location, v_here, 3000)
             and not exists (select 1 from public.coupon_wins w where w.coupon_id = cp.id and w.user_id = p_user
                               and w.created_at > now() - interval '30 days')
           order by cp.id
        loop
          v_roll := v_roll - v_coupon.weight;
          if v_roll < 0 then
            v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
            insert into public.coupon_wins (user_id, coupon_id, checkin_id, code) values (p_user, v_coupon.id, v_checkin, v_code);
            v_spin := jsonb_build_object('won', true, 'title', v_coupon.title, 'place', v_coupon.place_name, 'code', v_code,
                                         'odds', round(v_coupon.weight::numeric / (v_total * 2), 3));
            exit;
          end if;
        end loop;
      else
        v_spin := jsonb_build_object('won', false, 'odds', 0.5);
      end if;
    end if;
  end if;

  return jsonb_build_object('checkin_id', v_checkin, 'status', v_status, 'reasons', v_reasons,
                            'rewarded', v_rewarded, 'billed_thb', v_billed, 'billing', v_billing,
                            'qr_ok', v_qr_ok, 'distance_m', round(v_dist::numeric, 1),
                            'new_badges', v_badges, 'spin', v_spin);
end;
$$;

-- ---------- coins and challenges ----------
create or replace function public.coins_of(p_user uuid) returns int
language sql stable set search_path = '' as $$
  select case when pr.member_since is null then 0 else
    coalesce((select sum(coins) from public.stamps where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.challenge_claims where user_id = p_user), 0)
    + 50 * (public.level_for(pr.xp) - 1) end
  from public.profiles pr where pr.id = p_user
$$;

-- every challenge with the users progress. Periods use Bangkok time. One definition list for display and claiming.
create or replace function public.challenge_progress(p_user uuid)
returns table (slug text, kind text, title_en text, title_th text, have int, need int, xp int, coins int, period text, claimed boolean)
language sql stable set search_path = '' as $$
  with now_bkk as (select (now() at time zone 'Asia/Bangkok') t),
  s as (
    select st.*, pl.category, lower(pl.name || ' ' || coalesce(pl.name_th, '')) nm, (st.earned_at at time zone 'Asia/Bangkok') bkk
      from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user
  ),
  wk as (select date_trunc('week', t) as week_start, to_char(t, 'IYYY-IW') as week_key, to_char(t, 'YYYY-MM-DD') as day_key from now_bkk),
  defs (slug, kind, title_en, title_th, have, need, xp, coins, period) as (
    select 'daily-checkin', 'daily', 'Check in somewhere today', 'เช็กอินสักที่วันนี้',
           (exists (select 1 from public.checkins c where c.user_id = p_user and c.status = 'approved'
                     and (c.created_at at time zone 'Asia/Bangkok')::date = (select t::date from now_bkk)))::int, 1, 30, 5, (select day_key from wk)
    union all
    select 'weekly-landmarks', 'weekly', 'Visit 3 landmarks this week', 'ไปแลนด์มาร์ก 3 แห่งในสัปดาห์นี้',
           (select count(*) from s where tier = 3 and bkk >= (select week_start from wk))::int, 3, 200, 40, (select week_key from wk)
    union all
    select 'weekly-new-kind', 'weekly', 'Try a kind of place new to you this week', 'ลองสถานที่ประเภทใหม่ในสัปดาห์นี้',
           (select count(*) from s where bkk >= (select week_start from wk)
              and not exists (select 1 from s s2 where s2.category = s.category and s2.bkk < (select week_start from wk)))::int,
           1, 100, 20, (select week_key from wk)
    union all
    select 'waterfalls-10', 'collection', '10 waterfalls', 'น้ำตก 10 แห่ง',
           (select count(*) from s where nm like '%waterfall%' or nm like '%น้ำตก%')::int, 10, 300, 60, 'all'
    union all
    select 'temples-20', 'collection', '20 temples', 'วัด 20 แห่ง', (select count(*) from s where category = 'temple')::int, 20, 300, 60, 'all'
    union all
    select 'national-parks-5', 'collection', '5 national parks', 'อุทยานแห่งชาติ 5 แห่ง',
           (select count(*) from s where category = 'park' and (nm like '%national park%' or nm like '%อุทยานแห่งชาติ%'))::int, 5, 300, 60, 'all'
    union all
    select 'museums-10', 'collection', '10 museums', 'พิพิธภัณฑ์ 10 แห่ง', (select count(*) from s where category = 'museum')::int, 10, 300, 60, 'all'
    union all
    select 'night-markets-5', 'collection', '5 night markets', 'ตลาดกลางคืน 5 แห่ง',
           (select count(*) from s where category = 'market'
              and (nm like '%night%' or nm like '%ตลาดนัด%' or nm like '%ตลาดโต้รุ่ง%' or nm like '%walking street%'))::int, 5, 300, 60, 'all'
    union all
    -- province sets: visit 5 of a provinces landmarks (all of them if it has fewer); shown once you have stamped there
    select 'province-' || pv.iso, 'province', pv.name_en || ' Explorer', 'นักสำรวจ' || pv.name_th,
           (select count(*) from s where s.province_id = pv.id and s.tier = 3)::int,
           least(5, (select count(*) from public.places pl where pl.province_id = pv.id and pl.tier = 3))::int, 500, 100, 'all'
      from public.provinces pv
     where exists (select 1 from s where s.province_id = pv.id)
       and exists (select 1 from public.places pl where pl.province_id = pv.id and pl.tier = 3)
  )
  select d.slug, d.kind, d.title_en, d.title_th, least(d.have, d.need), d.need, d.xp, d.coins, d.period,
         exists (select 1 from public.challenge_claims cc where cc.user_id = p_user and cc.slug = d.slug and cc.period = d.period)
    from defs d
$$;

-- claim everything completed and not yet claimed; returns what was claimed (XP added here, coins via coins_of)
create or replace function public.claim_challenges(p_user uuid) returns jsonb
language plpgsql set search_path = '' as $$
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
      v_out := v_out || jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', c.coins);
    end if;
  end loop;
  return v_out;
end;
$$;

-- ---------- check-in v5: level gate, stamp, XP/coins, challenges ----------
create or replace function public.record_checkin_v5(
  p_user uuid, p_place bigint, p_lat float8, p_lng float8, p_accuracy float8,
  p_selfie_path text, p_face_count int, p_qr text default null, p_client jsonb default '{}')
returns jsonb
language plpgsql set search_path = ''
as $$
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
    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event)
    on conflict do nothing;
    update public.profiles set xp = xp + v_xp where id = p_user;
  end if;
  if v_result->>'status' = 'approved' then v_challenges := public.claim_challenges(p_user); end if;
  select xp into v_after from public.profiles where id = p_user;

  return v_result || jsonb_build_object(
    'stamp', case when (v_result->>'rewarded')::boolean then jsonb_build_object(
               'tier', v_place.tier, 'new_province', v_new_province, 'event', v_event,
               'province', (select name_en from public.provinces where id = v_place.province_id)) end,
    'challenges', v_challenges,
    'xp_gained', v_after - v_before, 'xp', v_after, 'member', v_member,
    'coins', public.coins_of(p_user),
    'level', public.level_for(v_after),
    'level_up', public.level_for(v_after) > public.level_for(v_before));
end;
$$;
revoke execute on function public.record_checkin_v5(uuid, bigint, float8, float8, float8, text, int, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_challenges(uuid) from public, anon, authenticated;

-- ---------- passport for the signed-in user ----------
create or replace function public.passport_v2() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('xp', pr.xp, 'level', public.level_for(pr.xp), 'member', pr.member_since is not null,
                       'plus', coalesce(pr.plus_until > now(), false), 'coins', public.coins_of(pr.id))
                  from public.profiles pr where pr.id = auth.uid()),
    'stamps', coalesce((select jsonb_agg(jsonb_build_object(
                  'place_id', st.place_id, 'name', pl.name, 'name_th', pl.name_th, 'category', pl.category, 'tier', st.tier,
                  'province_id', st.province_id, 'event', st.event_slug, 'earned_at', st.earned_at,
                  'photo', ch.selfie_path) order by st.earned_at desc)
                from public.stamps st join public.places pl on pl.id = st.place_id
                left join public.checkins ch on ch.id = st.checkin_id and not ch.photo_hidden
               where st.user_id = auth.uid()), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
                  'checkin_id', ch.id, 'path', ch.selfie_path, 'caption', ch.caption, 'place', pl.name,
                  'province_id', pl.province_id, 'at', ch.created_at) order by ch.created_at desc)
                from public.checkins ch join public.places pl on pl.id = ch.place_id
               where ch.user_id = auth.uid() and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden), '[]'),
    'provinces', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th,
                  'stamps', (select count(*) from public.stamps st where st.user_id = auth.uid() and st.province_id = pv.id)))
                from public.provinces pv), '[]'),
    'challenges', coalesce((select jsonb_agg(to_jsonb(c)) from public.challenge_progress(auth.uid()) c), '[]'))
$$;
revoke execute on function public.passport_v2() from public, anon;
grant execute on function public.passport_v2() to authenticated;

-- hide or caption your own photo
create or replace function public.set_photo(p_checkin uuid, p_hidden boolean, p_caption text default null) returns void
language sql security definer set search_path = '' as $$
  update public.checkins set photo_hidden = p_hidden, caption = left(nullif(trim(p_caption), ''), 140)
   where id = p_checkin and user_id = auth.uid()
$$;
revoke execute on function public.set_photo(uuid, boolean, text) from public, anon;
grant execute on function public.set_photo(uuid, boolean, text) to authenticated;
