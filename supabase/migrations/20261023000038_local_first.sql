-- Local first (plan 2): shops add or claim their listing, OTOP products and owner photos, traveller nominations
-- confirmed by two other visitors, Support local quests, +50% XP for OTOP/community stamps, a weekly local spotlight,
-- admin stats, and the local flags passed to the planner.

alter table public.places add column otop_stars smallint check (otop_stars between 1 and 5);

-- owners must use a real account (not a guest) to run a listing
create or replace function public.is_real_user() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
$$;

create table public.shop_products (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  price numeric(10, 2) check (price >= 0),
  photo_path text,
  created_at timestamptz not null default now()
);
create index shop_products_place_idx on public.shop_products (place_id);
alter table public.shop_products enable row level security;
create policy "products are public" on public.shop_products for select using (true);

-- ---------- claim or add a shop ----------
create or replace function public.claim_shop(p_place bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_place public.places;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  select * into v_place from public.places where id = p_place and min_level = 0 for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if v_place.shop_id is not null then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), v_place.name) returning id into v_shop;
  update public.places set shop_id = v_shop where id = p_place;
  return v_shop;
end;
$$;

create or replace function public.add_shop(p_name text, p_kind text, p_lat float8, p_lng float8, p_here_lat float8, p_here_lng float8)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_place bigint; v_cat text; v_detour boolean;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if p_lat not between 5 and 21 or p_lng not between 97 and 106 or p_here_lat is null
     or extensions.st_distance(extensions.st_point(p_lng, p_lat)::extensions.geography,
                               extensions.st_point(p_here_lng, p_here_lat)::extensions.geography) > 100 then
    raise exception 'be_there' using errcode = 'P0001';
  end if;
  select category, detour into v_cat, v_detour from public.places where kind = p_kind group by category, detour order by count(*) desc limit 1;
  if v_cat is null then raise exception 'bad_kind' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), public.clean_name(p_name, 80)) returning id into v_shop;
  insert into public.places (name, category, kind, detour, location, source, shop_id, tier, local, otop, community)
  values (public.clean_name(p_name, 80), v_cat, p_kind, v_detour, extensions.st_point(p_lng, p_lat)::extensions.geography, 'owner', v_shop, 1,
          v_cat in ('food', 'cafe', 'craft', 'market'), p_kind = 'otop', p_kind = 'community_enterprise')
  returning id into v_place;
  return v_place;
end;
$$;

-- the shops I run, with their places
create or replace function public.my_places() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'shop_id', p.shop_id,
           'opening_hours', p.opening_hours, 'phone', p.phone, 'website', p.website, 'description', p.description,
           'otop', p.otop, 'otop_stars', p.otop_stars, 'community', p.community,
           'verified', p.qr_code is not null and p.last_qr_scan_at is not null, 'qr_code', p.qr_code,
           'products', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name, 'price', sp.price, 'photo', sp.photo_path) order by sp.id)
                                 from public.shop_products sp where sp.place_id = p.id), '[]'),
           'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.url) order by ph.id)
                               from public.place_photos ph where ph.place_id = p.id and ph.source = 'owner'), '[]')) order by p.name), '[]')
    from public.places p join public.shops s on s.id = p.shop_id where s.owner_id = auth.uid()
$$;

create or replace function public.owns_place(p_place bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.places p join public.shops s on s.id = p.shop_id where p.id = p_place and s.owner_id = auth.uid())
$$;

create or replace function public.update_my_place(p_place bigint, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 3000 then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  for e in select * from jsonb_each(p_payload) loop
    if e.key in ('opening_hours', 'phone', 'website', 'description') then
      if not (e.value = 'null'::jsonb or (jsonb_typeof(e.value) = 'string' and char_length(e.value #>> '{}') <= 500
              and (e.value #>> '{}') !~ '[<>[:cntrl:]]')) then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif e.key in ('otop', 'community') then
      if jsonb_typeof(e.value) <> 'boolean' then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif e.key = 'otop_stars' then
      if not (e.value = 'null'::jsonb or (jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::int between 1 and 5)) then
        raise exception 'bad_edit' using errcode = 'P0001';
      end if;
    else raise exception 'bad_edit' using errcode = 'P0001';
    end if;
  end loop;
  update public.places set
    opening_hours = case when p_payload ? 'opening_hours' then nullif(p_payload->>'opening_hours', '') else opening_hours end,
    phone = case when p_payload ? 'phone' then nullif(p_payload->>'phone', '') else phone end,
    website = case when p_payload ? 'website' then nullif(p_payload->>'website', '') else website end,
    description = case when p_payload ? 'description' then nullif(p_payload->>'description', '') else description end,
    otop = coalesce((p_payload->>'otop')::boolean, otop),
    community = coalesce((p_payload->>'community')::boolean, community),
    otop_stars = case when p_payload ? 'otop_stars' then (p_payload->>'otop_stars')::smallint else otop_stars end,
    local = local or coalesce((p_payload->>'otop')::boolean, false) or coalesce((p_payload->>'community')::boolean, false)
  where id = p_place;
end;
$$;

-- ---------- OTOP products and owner photos ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-photos', 'shop-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']) on conflict (id) do nothing;
create policy "owners upload shop photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_real_user());
create policy "owners delete shop photos" on storage.objects for delete to authenticated
  using (bucket_id = 'shop-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.save_product(p_place bigint, p_id bigint, p_name text, p_price numeric, p_photo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if p_photo is not null and p_photo not like auth.uid()::text || '/%' then raise exception 'bad_photo' using errcode = 'P0001'; end if;
  if p_id is null then
    if (select count(*) from public.shop_products where place_id = p_place) >= 30 then raise exception 'too_many_products' using errcode = 'P0001'; end if;
    insert into public.shop_products (place_id, name, price, photo_path) values (p_place, public.clean_name(p_name, 80), p_price, p_photo);
  else
    update public.shop_products set name = public.clean_name(p_name, 80), price = p_price, photo_path = coalesce(p_photo, photo_path)
     where id = p_id and place_id = p_place;
  end if;
end;
$$;

create or replace function public.delete_product(p_place bigint, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  delete from public.shop_products where id = p_id and place_id = p_place;
end;
$$;

-- owner photos are stored as "shop-photos/<path>"; the app turns that into the public URL
create or replace function public.add_owner_photo(p_place bigint, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if p_path not like auth.uid()::text || '/%' or char_length(p_path) > 200 then raise exception 'bad_photo' using errcode = 'P0001'; end if;
  if (select count(*) from public.place_photos where place_id = p_place and source = 'owner') >= 12 then raise exception 'too_many_photos' using errcode = 'P0001'; end if;
  insert into public.place_photos (place_id, source, url, credit) values (p_place, 'owner', 'shop-photos/' || p_path, 'The owner');
end;
$$;

create or replace function public.delete_owner_photo(p_place bigint, p_photo bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  delete from public.place_photos where id = p_photo and place_id = p_place and source = 'owner';
end;
$$;

-- ---------- traveller nominations ----------
create table public.nominations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  kind text not null,
  location extensions.geography(point, 4326) not null,
  photo_path text,
  otop boolean not null default false,
  community boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'live', 'rejected')),
  place_id bigint references public.places on delete set null,
  created_at timestamptz not null default now()
);
create index nominations_pending_idx on public.nominations using gist (location) where status = 'pending';
create table public.nomination_confirms (
  nomination_id bigint not null references public.nominations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (nomination_id, user_id)
);
alter table public.nominations enable row level security;
alter table public.nomination_confirms enable row level security;

create or replace function public.nominate(p_name text, p_kind text, p_otop boolean, p_community boolean, p_photo text,
  p_lat float8, p_lng float8) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_kind not in ('otop', 'community_enterprise', 'craft', 'souvenir', 'market', 'night_market', 'restaurant', 'cafe', 'bakery', 'dessert') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_lat not between 5 and 21 or p_lng not between 97 and 106 then raise exception 'be_there' using errcode = 'P0001'; end if;
  if p_photo is null or p_photo not like auth.uid()::text || '/%' then raise exception 'photo_required' using errcode = 'P0001'; end if;
  if (select count(*) from public.nominations where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5
     or (select count(*) from public.nominations where status = 'pending') >= 5000 then
    raise exception 'too_many_nominations' using errcode = 'P0001';
  end if;
  -- the same shop already on the map or already nominated
  if exists (select 1 from public.places p where extensions.st_dwithin(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography, 40)
               and lower(p.name) = lower(trim(p_name)))
     or exists (select 1 from public.nominations n where n.status = 'pending'
               and extensions.st_dwithin(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography, 40) and lower(n.name) = lower(trim(p_name))) then
    raise exception 'already_listed' using errcode = 'P0001';
  end if;
  insert into public.nominations (user_id, name, kind, location, photo_path, otop, community)
  values (auth.uid(), public.clean_name(p_name, 80), p_kind, extensions.st_point(p_lng, p_lat)::extensions.geography, p_photo,
          coalesce(p_otop, false) or p_kind = 'otop', coalesce(p_community, false) or p_kind = 'community_enterprise')
  returning id into v_id;
  return v_id;
end;
$$;

-- pending nominations around you (the nominator never sees their own to confirm)
create or replace function public.nominations_near(p_lat float8, p_lng float8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'kind', n.kind, 'otop', n.otop, 'community', n.community,
           'lat', extensions.st_y(n.location::extensions.geometry), 'lng', extensions.st_x(n.location::extensions.geometry),
           'distance_m', round(extensions.st_distance(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography)),
           'confirms', (select count(*) from public.nomination_confirms c where c.nomination_id = n.id),
           'mine', n.user_id = auth.uid(),
           'confirmed', exists (select 1 from public.nomination_confirms c where c.nomination_id = n.id and c.user_id = auth.uid()))
           order by extensions.st_distance(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography)), '[]')
    from (select * from public.nominations n where n.status = 'pending'
            and extensions.st_dwithin(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography, 5000)
            order by n.location operator(extensions.<->) extensions.st_point(p_lng, p_lat)::extensions.geography limit 30) n
$$;

-- confirm a nomination while standing there; the second confirmation puts it on the map
create or replace function public.confirm_nomination(p_id bigint, p_lat float8, p_lng float8) returns text
language plpgsql security definer set search_path = '' as $$
declare n public.nominations; v_cat text; v_detour boolean; v_place bigint;
begin
  select * into n from public.nominations where id = p_id and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if n.user_id = auth.uid() then raise exception 'own_nomination' using errcode = 'P0001'; end if;
  if extensions.st_distance(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography) > 50 then
    raise exception 'be_there' using errcode = 'P0001';
  end if;
  insert into public.nomination_confirms (nomination_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  if (select count(*) from public.nomination_confirms where nomination_id = p_id) < 2 then return 'confirmed'; end if;
  select category, detour into v_cat, v_detour from public.places where kind = n.kind group by category, detour order by count(*) desc limit 1;
  insert into public.places (name, category, kind, detour, location, source, tier, local, otop, community)
  values (n.name, coalesce(v_cat, 'craft'), n.kind, coalesce(v_detour, true), n.location, 'team', 1, true, n.otop, n.community)
  returning id into v_place;
  update public.nominations set status = 'live', place_id = v_place where id = p_id;
  update public.profiles set xp = xp + 100 where id = n.user_id;
  update public.profiles set xp = xp + 20 where id in (select user_id from public.nomination_confirms where nomination_id = p_id);
  insert into public.activity (user_id, kind, place_id, data)
  values (n.user_id, 'badge', v_place, jsonb_build_object('slug', 'nomination-live', 'name_en', 'Local Hero find', 'icon', 'heart', 'tier', 1, 'place', n.name));
  return 'live';
end;
$$;

-- ---------- quests, XP, badges ----------
create or replace function public.challenge_progress(p_user uuid)
returns table (slug text, kind text, title_en text, title_th text, have int, need int, xp int, coins int, period text, claimed boolean)
language sql stable set search_path = '' as $$
  with now_bkk as (select (now() at time zone 'Asia/Bangkok') t),
  s as (
    select st.*, pl.category, lower(pl.name || ' ' || coalesce(pl.name_th, '')) nm, (st.earned_at at time zone 'Asia/Bangkok') bkk,
           (pl.otop or pl.community) otop_like
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
    union all
    select 'weekly-support-local', 'weekly', 'Support local: 3 OTOP or community shops this week', 'อุดหนุนชุมชน: โอทอปหรือวิสาหกิจชุมชน 3 แห่งในสัปดาห์นี้',
           (select count(*) from s where s.otop_like and bkk >= (select week_start from wk))::int, 3, 200, 40, (select week_key from wk)
    union all
    select 'otop-explorer-' || g, 'collection', 'OTOP Explorer: ' || g || ' OTOP or community places', 'นักสำรวจโอทอป ' || g || ' แห่ง',
           (select count(*) from s where s.otop_like)::int, g, 100 * g, 20 * g, 'all'
      from unnest(array[10, 25, 50]) g
    union all
    -- friends quest: you and your partner for the week, 10 new stamps between you
    select 'friend-quest', 'friend', 'Friends Quest: 10 stamps together', 'เควสต์เพื่อน: สะสม 10 แสตมป์ด้วยกัน',
           (select count(*) from public.stamps st where st.user_id in (p_user, fq.b) and st.earned_at >= fq.created_at)::int,
           10, 150, 40, (select week_key from wk)
      from public.friend_quests fq where fq.a = p_user and fq.week_key = (select week_key from wk) and public.is_friend(fq.a, fq.b)
  )
  select d.slug, d.kind, d.title_en, d.title_th, least(d.have, d.need), d.need, d.xp, d.coins, d.period,
         exists (select 1 from public.challenge_claims cc where cc.user_id = p_user and cc.slug = d.slug and cc.period = d.period)
    from defs d
$$;

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
      end loop;
    end if;

    select slug into v_event from public.events where now() between starts_at and ends_at order by starts_at limit 1;
    insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins, event_slug, group_bonus)
    values (p_user, p_place, (v_result->>'checkin_id')::uuid, v_place.tier, v_place.province_id, v_xp, v_coins, v_event, v_group)
    on conflict do nothing;
    update public.profiles set xp = xp + v_xp where id = p_user;
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
    'level_up', public.level_for(v_after) > public.level_for(v_before));
end;
$$;
revoke execute on function public.record_checkin_v5(uuid, bigint, float8, float8, float8, text, int, text, jsonb) from public, anon, authenticated;

create or replace function public.achievements(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select
      (select count(distinct province_id) from public.stamps where user_id = p_user and province_id is not null)::int as provinces,
      (select count(*) from public.stamps where user_id = p_user and tier = 3)::int as landmarks,
      (select count(*) from public.stamps where user_id = p_user)::int as stamps,
      (select count(*) from public.checkins where user_id = p_user and status <> 'rejected' and selfie_path is not null)::int as photos,
      (select count(*) from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user and pl.category = 'food')::int as food,
      (select count(*) from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user and pl.category = 'temple')::int as temples,
      (select count(*) from public.friendships where p_user in (a, b))::int as friends,
      (select count(distinct m.trip_id) from public.trip_members m
        where m.user_id = p_user and exists (select 1 from public.trip_members o where o.trip_id = m.trip_id and o.user_id <> p_user))::int as crew,
      (select count(*) from public.challenge_claims where user_id = p_user)::int as quests,
      (select public.level_for(xp) from public.profiles where id = p_user) as lvl,
      (select count(*) from public.place_edits where user_id = p_user and status = 'approved')::int as edits,
      (select count(*) from public.nominations where user_id = p_user and status = 'live')::int as nominated
  ),
  b (slug, name_en, name_th, icon, val, goals, ord) as (
    select 'province-hopper', 'Province Hopper', 'นักเก็บจังหวัด', 'map', provinces, array[1, 5, 15, 40, 77], 1 from v union all
    select 'landmark-hunter', 'Landmark Hunter', 'นักล่าแลนด์มาร์ก', 'landmark', landmarks, array[1, 5, 15, 40, 100], 2 from v union all
    select 'collector', 'Collector', 'นักสะสม', 'stamp', stamps, array[5, 25, 75, 200, 500], 3 from v union all
    select 'shutterbug', 'Shutterbug', 'ตากล้อง', 'camera', photos, array[1, 10, 50, 150, 400], 4 from v union all
    select 'foodie', 'Foodie', 'นักชิม', 'utensils', food, array[1, 10, 30, 75, 150], 5 from v union all
    select 'temple-runner', 'Temple Runner', 'สายบุญ', 'temple', temples, array[1, 10, 30, 75, 150], 6 from v union all
    select 'social-butterfly', 'Social Butterfly', 'ผีเสื้อสังคม', 'users', friends, array[1, 3, 10, 25, 50], 7 from v union all
    select 'road-crew', 'Road Crew', 'แก๊งโรดทริป', 'car', crew, array[1, 3, 10, 25, 50], 8 from v union all
    select 'quest-master', 'Quest Master', 'เจ้าแห่งเควสต์', 'trophy', quests, array[5, 25, 100, 250, 500], 9 from v union all
    select 'high-flyer', 'High Flyer', 'เลเวลสูง', 'star', lvl, array[2, 4, 6, 8, 10], 10 from v union all
    select 'map-maker', 'Map Maker', 'นักทำแผนที่', 'pin', edits, array[1, 5, 20, 50, 150], 11 from v union all
    select 'local-hero', 'Local Hero', 'ฮีโร่ชุมชน', 'heart', nominated, array[1, 3, 10, 25, 50], 12 from v
  )
  select jsonb_agg(jsonb_build_object('slug', slug, 'name_en', name_en, 'name_th', name_th, 'icon', icon, 'value', val,
           'tier', (select count(*) from unnest(goals) g where val >= g), 'goals', to_jsonb(goals),
           'next', goals[least(5, 1 + (select count(*) from unnest(goals) g where val >= g))::int]) order by ord)
    from b
$$;
revoke execute on function public.achievements(uuid) from public, anon, authenticated;

-- ---------- local spotlight and stats ----------
-- one featured OTOP/community place per province this week: most check-ins in 7 days, then most reviews, then a photo
create or replace function public.local_spotlight(p_lat float8, p_lng float8) returns jsonb
language sql stable security definer set search_path = '' as $$
  with prov as (
    select pv.id from public.provinces pv
     where extensions.st_intersects(pv.geom, extensions.st_point(p_lng, p_lat)::extensions.geography) limit 1
  )
  select jsonb_build_object('id', p.id, 'name', p.name, 'name_th', p.name_th, 'kind', p.kind, 'otop', p.otop, 'community', p.community,
           'province', (select name_en from public.provinces where id = p.province_id),
           'photo', (select url from public.place_photos ph where ph.place_id = p.id order by ph.id limit 1),
           'visits', (select count(*) from public.checkins c where c.place_id = p.id and c.created_at > now() - interval '7 days'))
    from public.places p
   where (p.otop or p.community) and p.min_level = 0 and p.province_id = (select id from prov)
   order by (select count(*) from public.checkins c where c.place_id = p.id and c.created_at > now() - interval '7 days') desc,
            (select count(*) from public.reviews r where r.place_id = p.id) desc,
            exists (select 1 from public.place_photos ph where ph.place_id = p.id) desc,
            md5(p.id::text || to_char(now(), 'IYYY-IW'))
   limit 1
$$;

create or replace function public.local_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.local_visits_30d desc, x.province) from (
    select pv.name_en province,
      (select count(*) from public.checkins c join public.places p on p.id = c.place_id
        where p.province_id = pv.id and (p.otop or p.community) and c.status = 'approved' and c.created_at > now() - interval '30 days') local_visits_30d,
      (select count(*) from public.places p join public.shops s on s.id = p.shop_id
        where p.province_id = pv.id and s.created_at > now() - interval '30 days') new_shops_30d,
      (select count(*) from public.nominations n
        where extensions.st_intersects(pv.geom, n.location) and n.created_at > now() - interval '30 days') nominations_30d,
      (select round(100.0 * count(*) filter (where p.local or p.otop or p.community) / nullif(count(*), 0), 1)
         from public.route_stops rs join public.places p on p.id = rs.place_id
        where p.province_id = pv.id and rs.shown_at > now() - interval '30 days') local_stop_share_pct
    from public.provinces pv) x), '[]');
end;
$$;

-- ---------- the place page shows products, stars, description and the verified badge ----------
create or replace function public.place_extras(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('description', p.description, 'otop_stars', p.otop_stars,
           'verified', p.qr_code is not null and p.last_qr_scan_at is not null, 'claimed', p.shop_id is not null,
           'products', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name, 'price', sp.price, 'photo', sp.photo_path) order by sp.id)
                                 from public.shop_products sp where sp.place_id = p.id), '[]'))
    from public.places p where p.id = p_id and p.min_level <= public.unlock_level(auth.uid())
$$;

-- ---------- planner: local flags on the route shortlist ----------
drop function if exists public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int);
create or replace function public.route_detour_candidates(
  p_geometry jsonb, p_radius_m float8, p_budget_min float8, p_level int,
  p_max_n int default 22, p_per_group int default 5,
  p_min_rating numeric default 4, p_unrated boolean default true, p_max_price smallint default null,
  p_meal_slots int default 0, p_segments int default 1)
returns table (id bigint, name text, name_th text, category text, lat float8, lng float8,
  open_min int, close_min int, dwell_min int, rating numeric,
  is_partner boolean, is_demo boolean, min_level int, exclusive_kind text, perk_text text, price_level smallint, tier smallint,
  frac float8, local boolean, otop boolean, community boolean)
language sql stable security definer set search_path = '' as $$
  -- MATERIALIZED: build the line once (inlined, Postgres re-parsed the JSON line for every candidate row)
  with route as materialized (
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line
  ), segs as (select greatest(1, least(p_segments, 8)) n), nearby as (
    select p.*, extensions.st_distance(p.location, r.line::extensions.geography) distance_m,
      extensions.st_linelocatepoint(r.line, p.location::extensions.geometry) fr,
      case when p.category in ('park', 'viewpoint') then 'nature'
           when p.category in ('cafe', 'food', 'market') then 'food'
           when p.category in ('temple', 'museum', 'art') then 'culture'
           when p.category = 'craft' then 'shopping' else 'other' end grp
    from public.places p cross join route r
    where public.place_open_to(p, p_level)
      and extensions.st_dwithin(p.location, r.line::extensions.geography, least(greatest(p_radius_m, 0), 20000))
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and p.dwell_min <= p_budget_min
      and p.detour
  ), staged as (
    -- on long trips the first and last 3% are the cities you leave from and arrive in, not detours
    select n.*, least(s.n - 1, floor(n.fr * s.n))::int seg from nearby n, segs s
     where s.n = 1 or n.fr between 0.03 and 0.97
  ), ranked as (
    select n.*,
      row_number() over (partition by seg, grp order by tier desc, rating desc nulls last, distance_m, id) rn,
      row_number() over (partition by seg, tier = 3 order by distance_m, id) lm,
      row_number() over (partition by seg, category = 'food' order by distance_m, id) ml,
      row_number() over (partition by seg order by tier desc, rating desc nulls last, distance_m, id) turn,
      row_number() over (partition by seg, (otop or community) order by distance_m, id) lo
    from staged n
  ), kept as (
    select r.* from ranked r, segs s
     where r.rn <= greatest(1, ceil(least(greatest(p_per_group, 1), 5)::numeric / s.n))
        or (r.tier = 3 and r.lm <= greatest(1, ceil(6.0 / s.n)))
        or ((r.otop or r.community) and r.lo <= 2)
        or (r.category = 'food' and r.ml <= ceil(least(p_meal_slots, 4)::numeric / s.n))
  )
  select p.id, p.name, p.name_th, p.category,
    extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.fr, p.local, p.otop, p.community
  from kept p
  -- round-robin over the stretches, so the limit cuts evenly instead of keeping one end
  order by (p.category = 'food' and p.ml <= 1 and p_meal_slots > 0) desc, p.turn, p.tier desc, p.rating desc nulls last, p.id
  limit least(greatest(p_max_n, 1), 22) + 6 + least(p_meal_slots, 4);
$$;
revoke all on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int)
  from public, anon, authenticated;
grant execute on function public.route_detour_candidates(jsonb, float8, float8, int, int, int, numeric, boolean, smallint, int, int)
  to service_role;

-- ---------- grants ----------
revoke execute on function public.claim_shop(bigint), public.add_shop(text, text, float8, float8, float8, float8), public.my_places(),
  public.update_my_place(bigint, jsonb), public.save_product(bigint, bigint, text, numeric, text), public.delete_product(bigint, bigint),
  public.add_owner_photo(bigint, text), public.delete_owner_photo(bigint, bigint),
  public.nominate(text, text, boolean, boolean, text, float8, float8), public.nominations_near(float8, float8),
  public.confirm_nomination(bigint, float8, float8), public.local_spotlight(float8, float8), public.local_stats(),
  public.place_extras(bigint) from public, anon;
grant execute on function public.claim_shop(bigint), public.add_shop(text, text, float8, float8, float8, float8), public.my_places(),
  public.update_my_place(bigint, jsonb), public.save_product(bigint, bigint, text, numeric, text), public.delete_product(bigint, bigint),
  public.add_owner_photo(bigint, text), public.delete_owner_photo(bigint, bigint),
  public.nominate(text, text, boolean, boolean, text, float8, float8), public.nominations_near(float8, float8),
  public.confirm_nomination(bigint, float8, float8), public.local_spotlight(float8, float8), public.local_stats(),
  public.place_extras(bigint) to authenticated;
revoke execute on function public.owns_place(bigint) from public, anon, authenticated;
