-- Icon tier: tier 4 = the country's major landmarks (Grand Palace, Wat Arun, Khao Yai, Ayutthaya...), drawn on the map
-- as illustrated icons from the lowest zoom and valued a notch above tier 3 by the planner.
-- The list is supabase/data/icon_places.csv, made by supabase/tools/icon_places.py from the tier-3 places with a
-- Wikidata id (2,105): a landmark kind (temple, viewpoint, park, national park, attraction, museum, beach, waterfall, art),
-- the Wikidata P625 point within 3 km of ours (40 km for national parks: their P625 is a centroid or HQ), and >= 10
-- Wikipedia sitelinks or a UNESCO World Heritage id (P757). 113 kept; excluded: 1,904 too few sitelinks and not UNESCO,
-- 49 not a landmark kind (restaurant 25, market 14, night market 4, cafe 3, fast food 2, bakery 1), 17 no P625,
-- 11 P625 too far away, 10 a second place with the same Wikidata id, 1 Wikidata item deleted.
-- Every function that treated tier = 3 as "landmark" now says tier >= 3; the bodies are otherwise unchanged.

alter table public.places drop constraint places_tier_check,
                          add constraint places_tier_check check (tier between 1 and 4),
                          add column sitelinks smallint;   -- Wikipedia language editions, icons only: map priority
comment on column public.places.sitelinks is 'Wikidata sitelink count (icons only); orders tier-4 places on the map';

update public.places p set tier = 4, sitelinks = v.n
  from (values
(159, 52), (37420, 48), (38090, 45), (37419, 43), (37505, 43), (95346, 43), (97046, 37),
(95341, 36), (63, 35), (86746, 29), (91279, 28), (894, 26), (37443, 26), (37939, 25), (38200, 25),
(95336, 25), (197649, 25), (37427, 24), (93401, 24), (96740, 24), (2924, 23), (45896, 23), (37421, 22),
(39888, 22), (37638, 21), (2414, 20), (37454, 20), (169, 19), (627, 19), (1594, 19), (86604, 19),
(92807, 19), (4023, 18), (37884, 18), (2640, 17), (2920, 17), (37428, 17), (37444, 17), (37461, 17),
(38202, 17), (22890, 16), (37528, 16), (37922, 16), (37556, 15), (38065, 15), (38066, 15), (38155, 15),
(38468, 15), (91616, 15), (96984, 15), (15101, 14), (37989, 14), (38120, 14), (39259, 14), (95360, 14),
(95669, 14), (32053, 13), (37441, 13), (37819, 13), (38881, 13), (38974, 13), (48327, 13), (87086, 13),
(91567, 13), (95344, 13), (95345, 13), (95378, 13), (14064, 12), (37423, 12), (37820, 12), (44497, 12),
(48407, 12), (88127, 12), (95301, 12), (95330, 12), (205296, 12), (1382, 11), (2656, 11), (21224, 11),
(25677, 11), (37506, 11), (37677, 11), (38859, 11), (38965, 11), (42062, 11), (46933, 11), (48294, 11),
(91542, 11), (91594, 11), (91687, 11), (93666, 11), (95295, 11), (95304, 11), (95343, 11), (96667, 11),
(196, 10), (953, 10), (1185, 10), (2925, 10), (37442, 10), (37577, 10), (38096, 10), (38777, 10),
(40121, 10), (41544, 10), (91603, 10), (91660, 10), (91682, 10), (91689, 10), (92507, 10), (95290, 10),
(95339, 10)
  ) v(id, n)
 where p.id = v.id;

-- achievements: 1 change(s)
CREATE OR REPLACE FUNCTION public.achievements(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with v as (
    select
      (select count(distinct province_id) from public.stamps where user_id = p_user and province_id is not null)::int as provinces,
      (select count(*) from public.stamps where user_id = p_user and tier >= 3)::int as landmarks,
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
$function$;

-- board_value: 1 change(s)
CREATE OR REPLACE FUNCTION public.board_value(p_user uuid, p_metric text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with st as (
    select s.*, pl.category from public.stamps s join public.places pl on pl.id = s.place_id
     where s.user_id = p_user and not public.is_demo_checkin(s.checkin_id)
       and (p_from is null or s.earned_at >= p_from) and (p_to is null or s.earned_at < p_to))
  select (case p_metric
    when 'xp' then case when p_from is null then public.board_xp(p_user) else
        coalesce((select sum(xp) from st), 0)
      + coalesce((select sum(c.xp) from public.challenge_claims c where c.user_id = p_user and c.claimed_at >= p_from
                    and (p_to is null or c.claimed_at < p_to)), 0)
      + coalesce((select sum(f.xp) from public.fortune_pulls f where f.user_id = p_user and f.created_at >= p_from
                    and (p_to is null or f.created_at < p_to) and not public.is_demo_checkin(f.checkin_id)), 0) end
    when 'provinces' then (select count(distinct province_id) from st where province_id is not null)
    when 'landmarks' then (select count(*) from st where tier >= 3)
    when 'temples' then (select count(*) from st where category = 'temple')
    when 'food' then (select count(*) from st where category = 'food')
  end)::int
$function$;

-- challenge_progress: 4 change(s)
CREATE OR REPLACE FUNCTION public.challenge_progress(p_user uuid)
 RETURNS TABLE(slug text, kind text, title_en text, title_th text, have integer, need integer, xp integer, coins integer, period text, claimed boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
           (select count(*) from s where tier >= 3 and bkk >= (select week_start from wk))::int, 3, 200, 40, (select week_key from wk)
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
           (select count(*) from s where s.province_id = pv.id and s.tier >= 3)::int,
           least(5, (select count(*) from public.places pl where pl.province_id = pv.id and pl.tier >= 3))::int, 500, 100, 'all'
      from public.provinces pv
     where exists (select 1 from s where s.province_id = pv.id)
       and exists (select 1 from public.places pl where pl.province_id = pv.id and pl.tier >= 3)
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
$function$;

-- claim_shop: 1 change(s)
CREATE OR REPLACE FUNCTION public.claim_shop(p_place bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_shop uuid; v_place public.places;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  select * into v_place from public.places where id = p_place and min_level = 0 for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  -- only businesses: not temples, parks, museums or landmarks, and never a partner or example listing
  if v_place.is_partner or v_place.is_demo or v_place.tier >= 3
     or v_place.category not in ('food', 'cafe', 'craft', 'market', 'stay', 'shop', 'bar') then
    raise exception 'not_claimable' using errcode = 'P0001';
  end if;
  if v_place.shop_id is not null then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), v_place.name) returning id into v_shop;
  update public.places set shop_id = v_shop, qr_code = coalesce(qr_code, public.new_code(6)) where id = p_place;
  return v_shop;
end;
$function$;

-- detour_candidates: 2 change(s)
CREATE OR REPLACE FUNCTION public.detour_candidates(o_lat double precision, o_lng double precision, d_lat double precision, d_lng double precision, extra_m double precision, max_n integer DEFAULT 16, p_level integer DEFAULT 0, p_per_group integer DEFAULT 5, p_min_rating numeric DEFAULT 4, p_unrated boolean DEFAULT true, p_max_price smallint DEFAULT NULL::smallint, p_meal_slots integer DEFAULT 0)
 RETURNS TABLE(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer, close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text, perk_text text, price_level smallint, tier smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b as (
    select extensions.st_point(o_lng, o_lat)::extensions.geography o,
           extensions.st_point(d_lng, d_lat)::extensions.geography d
  ), inside as (
    select p.*,
           extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d) via_m,
           case when p.category in ('park', 'viewpoint') then 'nature'
                when p.category in ('cafe', 'food', 'market') then 'food'
                when p.category in ('temple', 'museum', 'art') then 'culture'
                when p.category = 'craft' then 'shopping'
                else 'other' end grp
    from public.places p cross join b
    where public.place_open_to(p, p_level)
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
      and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
          <= extensions.st_distance(b.o, b.d) + extra_m
  ), ranked as (
    select i.*, row_number() over (partition by i.grp order by i.tier desc, i.rating desc nulls last, i.via_m, i.id) rn,
           row_number() over (partition by i.tier >= 3 order by i.via_m, i.id) lm,
           row_number() over (partition by i.category = 'food' order by i.via_m, i.id) ml from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text, r.price_level, r.tier
  from ranked r
  where r.rn <= p_per_group or (r.tier >= 3 and r.lm <= 6) or (r.category = 'food' and r.ml <= p_meal_slots)
  order by (r.category = 'food' and r.ml <= p_meal_slots) desc, r.tier desc, r.rating desc nulls last, r.via_m, r.id
  limit max_n + 6 + p_meal_slots;
$function$;

-- detour_candidates: 2 change(s)
CREATE OR REPLACE FUNCTION public.detour_candidates(o_lat double precision, o_lng double precision, d_lat double precision, d_lng double precision, extra_m double precision, max_n integer DEFAULT 16, p_level integer DEFAULT 0, p_per_group integer DEFAULT 5, p_min_rating numeric DEFAULT 4, p_unrated boolean DEFAULT true, p_max_price smallint DEFAULT NULL::smallint)
 RETURNS TABLE(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer, close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text, perk_text text, price_level smallint, tier smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b as (
    select extensions.st_point(o_lng, o_lat)::extensions.geography o,
           extensions.st_point(d_lng, d_lat)::extensions.geography d
  ), inside as (
    select p.*,
           extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d) via_m,
           case when p.category in ('park', 'viewpoint') then 'nature'
                when p.category in ('cafe', 'food', 'market') then 'food'
                when p.category in ('temple', 'museum', 'art') then 'culture'
                when p.category = 'craft' then 'shopping'
                else 'other' end grp
    from public.places p cross join b
    where public.place_open_to(p, p_level) and p.detour
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and extensions.st_dwithin(p.location, b.o, extensions.st_distance(b.o, b.d) + extra_m)
      and extensions.st_distance(b.o, p.location) + extensions.st_distance(p.location, b.d)
          <= extensions.st_distance(b.o, b.d) + extra_m
  ), ranked as (
    select i.*, row_number() over (partition by i.grp order by i.tier desc, i.rating desc nulls last, i.via_m, i.id) rn,
           row_number() over (partition by i.tier >= 3 order by i.via_m, i.id) lm from inside i
  )
  select r.id, r.name, r.name_th, r.category,
         extensions.st_y(r.location::extensions.geometry), extensions.st_x(r.location::extensions.geometry),
         r.open_min, r.close_min, r.dwell_min, r.rating,
         r.is_partner and r.shop_id is not null, r.is_demo, r.min_level, r.exclusive_kind, r.perk_text, r.price_level, r.tier
  from ranked r
  where r.rn <= p_per_group or (r.tier >= 3 and r.lm <= 6)
  order by r.tier desc, r.rating desc nulls last, r.via_m, r.id
  limit max_n + 6;
$function$;

-- record_checkin: 1 change(s)
CREATE OR REPLACE FUNCTION public.record_checkin(p_user uuid, p_place bigint, p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text, p_face_count integer, p_qr text DEFAULT NULL::text, p_client jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if v_place.tier >= 3 or v_place.category = 'park' then v_radius := 150; end if;
  if v_dist > v_radius then v_reasons := array_append(v_reasons, 'too_far'); end if;
  if p_selfie_path is null or p_selfie_path not like p_user::text || '/%' then v_reasons := array_append(v_reasons, 'no_selfie'); end if;
  if coalesce((p_client->>'is_mock')::boolean, false) then v_reasons := array_append(v_reasons, 'mock_location'); end if;

  select location, created_at into v_last from public.checkins
   where user_id = p_user and status <> 'rejected' and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if found then
    v_kmh := extensions.st_distance(v_last.location, v_here) / 1000.0
             / greatest(extract(epoch from now() - v_last.created_at) / 3600.0, 1.0 / 3600);
    -- demo mode teleports on purpose (tap the map, fast-forward to a stop): no speed check for it
    if v_kmh > 150 and not coalesce((p_client->>'demo')::boolean, false) then v_reasons := array_append(v_reasons, 'speed_jump'); end if;
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
    -- pace: at most 12 stamps an hour and 60 a day, 30 s apart. Faster than anyone visits places, so the photo
    -- is kept and the stamp waits (the place can be stamped on a later visit). Nothing else is checked or stored.
    if v_rewarded and (
         exists (select 1 from public.checkins where user_id = p_user and rewarded and created_at > now() - interval '30 seconds')
      or (select count(*) from public.checkins where user_id = p_user and rewarded and created_at > now() - interval '1 hour') >= 12
      or (select count(*) from public.checkins where user_id = p_user and rewarded and created_at > now() - interval '24 hours') >= 60) then
      v_rewarded := false;
      v_reasons := array_append(v_reasons, 'slow_down');
    end if;
  end if;

  -- counter QR: proves the visitor was inside (shown to the shop as "last scan"; no effect on routing)
  v_qr_ok := v_place.qr_code is not null and upper(trim(coalesce(p_qr, ''))) = v_place.qr_code
             and not coalesce((select u.is_anonymous from auth.users u where u.id = p_user), false);   -- guests never bill a shop
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
$function$;

-- record_checkin_v5: 2 change(s)
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
  v_charge numeric;
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
    v_xp := case least(v_place.tier, 3) when 3 then 150 when 2 then 75 else 30 end + case when v_new_province then 100 else 0 end;
    v_coins := case least(v_place.tier, 3) when 3 then 30 when 2 then 10 else 3 end;
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
  -- a booking made through Giggles Maps is done once the guest's check-in there is approved (around the booked day): the shop pays
  -- the flat fee from its credit. Row locks: a double-tapped check-in can't complete or charge the same booking twice.
  if v_result->>'status' = 'approved' then
    select * into v_booking from public.bookings
     where user_id = p_user and place_id = p_place and status = 'accepted'
       and day between (now() at time zone 'Asia/Bangkok')::date - 1 and (now() at time zone 'Asia/Bangkok')::date + 1
     order by day limit 1 for update skip locked;
    if found then
      select least(v_booking.fee_thb, wallet_thb) into v_charge from public.shops where id = v_booking.shop_id for update;
      update public.shops set wallet_thb = wallet_thb - coalesce(v_charge, 0) where id = v_booking.shop_id;
      update public.bookings set status = 'completed', completed_at = now(), charged_thb = coalesce(v_charge, 0) where id = v_booking.id;
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

-- route_detour_candidates: 3 change(s)
CREATE OR REPLACE FUNCTION public.route_detour_candidates(p_geometry jsonb, p_radius_m double precision, p_budget_min double precision, p_level integer, p_max_n integer DEFAULT 22, p_per_group integer DEFAULT 5, p_min_rating numeric DEFAULT 4, p_unrated boolean DEFAULT true, p_max_price smallint DEFAULT NULL::smallint, p_meal_slots integer DEFAULT 0, p_segments integer DEFAULT 1, p_kinds text[] DEFAULT NULL::text[], p_landmarks boolean DEFAULT false, p_open_only boolean DEFAULT false, p_no_chains boolean DEFAULT false)
 RETURNS TABLE(id bigint, name text, name_th text, category text, lat double precision, lng double precision, open_min integer, close_min integer, dwell_min integer, rating numeric, is_partner boolean, is_demo boolean, min_level integer, exclusive_kind text, perk_text text, price_level smallint, tier smallint, frac double precision, local boolean, otop boolean, community boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- MATERIALIZED: build the line once (inlined, Postgres re-parsed the JSON line for every candidate row)
  with route as materialized (
    select extensions.st_simplify(extensions.st_setsrid(extensions.st_geomfromgeojson(
      jsonb_build_object('type', 'LineString', 'coordinates', p_geometry)::text), 4326), 0.002) line
  ), cells as materialized (
    select extensions.st_subdivide(extensions.st_buffer(r.line::extensions.geography,
      least(greatest(p_radius_m, 1), 20000))::extensions.geometry, 32) cell
    from route r
  ), hits as (
    -- a place on a cell border matches two cells: keep it once. Only the columns used below: the whole places row
    -- is wide, and five window sorts carrying it took over a second on a 1,500 km trip
    select distinct on (p.id) p.id, p.name, p.name_th, p.category, p.location, p.open_min, p.close_min, p.dwell_min,
      p.rating, p.is_partner, p.shop_id, p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier,
      p.local, p.otop, p.community
    from cells c
      join public.places p on extensions.st_intersects(p.location::extensions.geometry, c.cell)
    where public.place_open_to(p, p_level)
      and (p.rating >= p_min_rating or (p.rating is null and p_unrated))
      and (p_max_price is null or p.price_level is null or p.price_level <= p_max_price)
      and p.dwell_min <= p_budget_min
      and p.detour
      -- = fitsInterests / independent in themes.ts
      and (p_kinds is null or p.category = any(p_kinds) or (p_landmarks and p.tier >= 3) or (p_meal_slots > 0 and p.category = 'food'))
      and (not p_open_only or (p.open_min is not null and p.close_min is not null))
      and (not p_no_chains or p.category not in ('food', 'cafe', 'market', 'craft') or p.local or p.otop or p.community)
  ), segs as (select greatest(1, least(p_segments, 8)) n), nearby as materialized (
    -- MATERIALIZED with plain columns: otherwise the route line (~8 kB) rode along in every row through the sorts below
    select p.id, p.name, p.name_th, p.category, p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner, p.shop_id,
      p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.local, p.otop, p.community,
      extensions.st_y(p.location::extensions.geometry) lat, extensions.st_x(p.location::extensions.geometry) lng,
      extensions.st_distance(p.location::extensions.geometry, r.line) * 111320 distance_m,
      extensions.st_linelocatepoint(r.line, p.location::extensions.geometry) fr,
      case when p.category in ('park', 'viewpoint') then 'nature'
           when p.category in ('cafe', 'food', 'market') then 'food'
           when p.category in ('temple', 'museum', 'art') then 'culture'
           when p.category = 'craft' then 'shopping' else 'other' end grp
    from hits p cross join route r
  ), staged as (
    -- on long trips the first and last 3% are the cities you leave from and arrive in, not detours
    select n.*, least(s.n - 1, floor(n.fr * s.n))::int seg from nearby n, segs s
     where s.n = 1 or n.fr between 0.03 and 0.97
  ), ranked as (
    select n.*,
      row_number() over (partition by seg, grp order by tier desc, rating desc nulls last, distance_m, id) rn,
      row_number() over (partition by seg, tier >= 3 order by distance_m, id) lm,
      row_number() over (partition by seg, category = 'food' order by distance_m, id) ml,
      row_number() over (partition by seg order by tier desc, rating desc nulls last, distance_m, id) turn,
      row_number() over (partition by seg, (otop or community) order by distance_m, id) lo
    from staged n
  ), kept as (
    select r.* from ranked r, segs s
     where r.rn <= greatest(1, ceil(least(greatest(p_per_group, 1), 5)::numeric / s.n))
        or (r.tier >= 3 and r.lm <= greatest(1, ceil(6.0 / s.n)))
        or ((r.otop or r.community) and r.lo <= 2)
        or (r.category = 'food' and r.ml <= ceil(least(p_meal_slots, 4)::numeric / s.n))
  )
  select p.id, p.name, p.name_th, p.category, p.lat, p.lng,
    p.open_min, p.close_min, p.dwell_min, p.rating, p.is_partner and p.shop_id is not null,
    p.is_demo, p.min_level, p.exclusive_kind, p.perk_text, p.price_level, p.tier, p.fr, p.local, p.otop, p.community
  from kept p
  -- round-robin over the stretches, so the limit cuts evenly instead of keeping one end
  order by (p.category = 'food' and p.ml <= 1 and p_meal_slots > 0) desc, p.turn, p.tier desc, p.rating desc nulls last, p.id
  limit least(greatest(p_max_n, 1), 22) + 6 + least(p_meal_slots, 4);
$function$;

-- shake_fortune: 1 change(s)
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
    select p.tier >= 3 into v_landmark from public.checkins c join public.places p on p.id = c.place_id
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

-- stops_near: 1 change(s)
CREATE OR REPLACE FUNCTION public.stops_near(p_lat double precision, p_lng double precision, p_radius_m double precision DEFAULT 1500)
 RETURNS TABLE(id bigint, name text, name_th text, category text, tier smallint, lat double precision, lng double precision, zone_m integer, distance_m double precision, stamped boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with here as (select extensions.st_point(p_lng, p_lat)::extensions.geography g)
  select p.id, p.name, p.name_th, p.category, p.tier,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         case when p.tier >= 3 or p.category = 'park' then 150 else 50 end,
         extensions.st_distance(p.location, h.g),
         exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = p.id)
    from public.places p cross join here h
   where p.min_level = 0 and p.detour and extensions.st_dwithin(p.location, h.g, least(greatest(p_radius_m, 100), 5000))
   order by p.tier desc, extensions.st_distance(p.location, h.g)
   limit 80
$function$;

-- map_places: 3 change(s)
CREATE OR REPLACE FUNCTION public.map_places(p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision, p_zoom double precision, p_kinds text[] DEFAULT NULL::text[])
 RETURNS TABLE(id bigint, name text, name_th text, kind text, category text, tier smallint, lat double precision, lng double precision, local boolean, otop boolean, community boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.name, p.name_th, p.kind, p.category, p.tier,
         extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.local, p.otop, p.community
    from public.places p
   where (p.location::extensions.geometry) operator(extensions.&&)
           extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
     and p.min_level = 0
     and (p_kinds is null or p.kind = any (p_kinds))
     and coalesce(cardinality(p_kinds), 0) <= 40
     -- a chip filter on a very wide box shows the zoomed-out mix (landmarks, OTOP), not every match nationwide
     and (p_kinds is null or (p_max_lng - p_min_lng <= 3 and p_max_lat - p_min_lat <= 3) or p.tier >= 3 or p.otop or p.community)
     and (p_kinds is not null or p_zoom >= 14
          or p.tier >= 3 or p.otop or p.community
          or (p_zoom >= 11 and (p.detour or p.kind = 'hospital')))
   order by p.tier desc, p.sitelinks desc nulls last, (p.otop or p.community) desc, p.local desc,
            (p.location::extensions.geometry) operator(extensions.<->)
              extensions.st_setsrid(extensions.st_point((p_min_lng + p_max_lng) / 2, (p_min_lat + p_max_lat) / 2), 4326)
   limit 400
$function$;
