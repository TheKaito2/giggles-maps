-- Security review fixes for migration 038 (local first).

-- an admin can release a wrongly claimed listing
create or replace function public.release_shop(p_place bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  update public.places set shop_id = null where id = p_place and not is_partner;
end;
$$;
revoke execute on function public.release_shop(bigint) from public, anon;
grant execute on function public.release_shop(bigint) to authenticated;

create or replace function public.claim_shop(p_place bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_place public.places;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  select * into v_place from public.places where id = p_place and min_level = 0 for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  -- only businesses: not temples, parks, museums or landmarks, and never a partner or example listing
  if v_place.is_partner or v_place.is_demo or v_place.tier = 3
     or v_place.category not in ('food', 'cafe', 'craft', 'market', 'stay', 'shop', 'bar') then
    raise exception 'not_claimable' using errcode = 'P0001';
  end if;
  if v_place.shop_id is not null then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), v_place.name) returning id into v_shop;
  update public.places set shop_id = v_shop, qr_code = coalesce(qr_code, public.new_code(6)) where id = p_place;
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
  if p_kind in ('otop', 'community_enterprise') then raise exception 'ask_for_otop' using errcode = 'P0001'; end if;
  if exists (select 1 from public.places p where extensions.st_dwithin(p.location, extensions.st_point(p_lng, p_lat)::extensions.geography, 40)
               and lower(p.name) = lower(trim(p_name))) then
    raise exception 'already_listed' using errcode = 'P0001';
  end if;
  select category, detour into v_cat, v_detour from public.places where kind = p_kind group by category, detour order by count(*) desc limit 1;
  if v_cat is null then raise exception 'bad_kind' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), public.clean_name(p_name, 80)) returning id into v_shop;
  insert into public.places (name, category, kind, detour, location, source, shop_id, tier, local, otop, community, qr_code)
  values (public.clean_name(p_name, 80), v_cat, p_kind, v_detour, extensions.st_point(p_lng, p_lat)::extensions.geography, 'owner', v_shop, 1,
          v_cat in ('food', 'cafe', 'craft', 'market'), false, false, public.new_code(6))
  returning id into v_place;
  return v_place;
end;
$$;

create or replace function public.update_my_place(p_place bigint, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e record; v text;
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 3000 then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  for e in select * from jsonb_each(p_payload) loop
    if e.key not in ('opening_hours', 'phone', 'website', 'description') then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    if e.value = 'null'::jsonb then continue; end if;
    if jsonb_typeof(e.value) <> 'string' then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    v := e.value #>> '{}';
    if v = '' then continue; end if;
    if char_length(v) > 500 or v ~ '[<>[:cntrl:]]'
       or (e.key = 'website' and v !~* '^(https?://)?[a-z0-9.-]+[.][a-z]{2,}(/[^[:space:]]*)?$')
       or (e.key = 'phone' and v !~ '^[0-9+() -]{5,30}$') then
      raise exception 'bad_edit' using errcode = 'P0001';
    end if;
  end loop;
  update public.places set
    opening_hours = case when p_payload ? 'opening_hours' then nullif(p_payload->>'opening_hours', '') else opening_hours end,
    phone = case when p_payload ? 'phone' then nullif(p_payload->>'phone', '') else phone end,
    website = case when p_payload ? 'website' then nullif(p_payload->>'website', '') else website end,
    description = case when p_payload ? 'description' then nullif(p_payload->>'description', '') else description end
  where id = p_place;
end;
$$;

create or replace function public.suggest_edit(p_place bigint, p_payload jsonb, p_here_lat float8 default null, p_here_lng float8 default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clean jsonb; e record;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 2000 then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  select coalesce(jsonb_object_agg(key, value), '{}') into v_clean from jsonb_each(p_payload)
   where key in ('name', 'name_th', 'kind', 'opening_hours', 'phone', 'website', 'closed', 'lat', 'lng', 'otop', 'community', 'otop_stars');
  if v_clean = '{}'::jsonb then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  for e in select * from jsonb_each(v_clean) loop
    if e.key in ('lat', 'lng') then
      if jsonb_typeof(e.value) <> 'number' then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif e.key = 'otop_stars' then
      if jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not in (1, 2, 3, 4, 5) then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif e.key in ('closed', 'otop', 'community') then
      if e.value <> 'true'::jsonb then raise exception 'bad_edit' using errcode = 'P0001'; end if;
    elsif jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') not between 1 and 200
          or (e.value #>> '{}') ~ '[<>[:cntrl:]]'
          or (e.key = 'website' and (e.value #>> '{}') !~* '^(https?://)?[a-z0-9.-]+[.][a-z]{2,}(/[^[:space:]]*)?$')
          or (e.key = 'phone' and (e.value #>> '{}') !~ '^[0-9+() -]{5,30}$') then
      raise exception 'bad_edit' using errcode = 'P0001';
    end if;
  end loop;
  if v_clean ? 'kind' and not exists (select 1 from public.places where kind = v_clean->>'kind' limit 1) then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_place is null then
    -- a missing place: you must be standing within 100 m of where you pin it
    if not (v_clean ? 'name' and v_clean ? 'kind' and v_clean ? 'lat' and v_clean ? 'lng') or p_here_lat is null
       or (v_clean->>'lat')::float8 not between 5 and 21 or (v_clean->>'lng')::float8 not between 97 and 106
       or extensions.st_distance(extensions.st_point((v_clean->>'lng')::float8, (v_clean->>'lat')::float8)::extensions.geography,
                                 extensions.st_point(p_here_lng, p_here_lat)::extensions.geography) > 100 then
      raise exception 'be_there' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.places where id = p_place and min_level <= public.unlock_level(auth.uid())) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if (select count(*) from public.place_edits where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20
     or (select count(*) from public.place_edits where status = 'pending') >= 2000 then
    raise exception 'too_many_edits' using errcode = 'P0001';
  end if;
  insert into public.place_edits (user_id, place_id, payload) values (auth.uid(), p_place, v_clean);
end;
$$;

create or replace function public.review_edit(p_edit bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.place_edits; v_kind text; v_cat text; v_detour boolean;
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  select * into e from public.place_edits where id = p_edit and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.place_edits set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now() where id = p_edit;
  if not p_approve then return; end if;
  v_kind := e.payload->>'kind';
  if v_kind is not null then
    select category, detour into v_cat, v_detour from public.places where kind = v_kind group by category, detour order by count(*) desc limit 1;
  end if;
  if e.place_id is null then
    insert into public.places (name, name_th, category, kind, detour, location, source, opening_hours, phone, website, tier)
    values (e.payload->>'name', e.payload->>'name_th', v_cat, v_kind, v_detour,
            extensions.st_point((e.payload->>'lng')::float8, (e.payload->>'lat')::float8)::extensions.geography, 'team',
            e.payload->>'opening_hours', e.payload->>'phone', e.payload->>'website', 1);
  elsif e.payload->'closed' = 'true'::jsonb then
    -- never delete: check-ins, reviews and stamps keep pointing at it; it just leaves the map and plans
    update public.places set min_level = 10, detour = false where id = e.place_id;
  else
    update public.places set name = coalesce(e.payload->>'name', name), name_th = coalesce(e.payload->>'name_th', name_th),
           kind = coalesce(v_kind, kind), category = coalesce(v_cat, category), detour = coalesce(v_detour, detour),
           opening_hours = coalesce(e.payload->>'opening_hours', opening_hours), phone = coalesce(e.payload->>'phone', phone),
           website = coalesce(e.payload->>'website', website),
           otop = otop or coalesce((e.payload->>'otop')::boolean, false),
           community = community or coalesce((e.payload->>'community')::boolean, false),
           otop_stars = coalesce((e.payload->>'otop_stars')::smallint, otop_stars),
           local = local or coalesce((e.payload->>'otop')::boolean, false) or coalesce((e.payload->>'community')::boolean, false)
     where id = e.place_id;
  end if;
  update public.profiles set xp = xp + 50 where id = e.user_id;
end;
$$;

create or replace function public.save_product(p_place bigint, p_id bigint, p_name text, p_price numeric, p_photo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if p_photo is not null and (p_photo not like auth.uid()::text || '/%' or p_photo !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$') then raise exception 'bad_photo' using errcode = 'P0001'; end if;
  if p_id is null then
    if (select count(*) from public.shop_products where place_id = p_place) >= 30 then raise exception 'too_many_products' using errcode = 'P0001'; end if;
    insert into public.shop_products (place_id, name, price, photo_path) values (p_place, public.clean_name(p_name, 80), p_price, p_photo);
  else
    update public.shop_products set name = public.clean_name(p_name, 80), price = p_price, photo_path = coalesce(p_photo, photo_path)
     where id = p_id and place_id = p_place;
  end if;
end;
$$;

create or replace function public.add_owner_photo(p_place bigint, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if p_path not like auth.uid()::text || '/%' or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' then raise exception 'bad_photo' using errcode = 'P0001'; end if;
  if (select count(*) from public.place_photos where place_id = p_place and source = 'owner') >= 12 then raise exception 'too_many_photos' using errcode = 'P0001'; end if;
  insert into public.place_photos (place_id, source, url, credit) values (p_place, 'owner', 'shop-photos/' || p_path, 'The owner');
end;
$$;

create or replace function public.nominate(p_name text, p_kind text, p_otop boolean, p_community boolean, p_photo text,
  p_lat float8, p_lng float8) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if p_photo is not null and p_photo !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' then raise exception 'photo_required' using errcode = 'P0001'; end if;
  if p_kind not in ('otop', 'community_enterprise', 'craft', 'souvenir', 'market', 'night_market', 'restaurant', 'cafe', 'bakery', 'dessert') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_lat not between 5 and 21 or p_lng not between 97 and 106 then raise exception 'be_there' using errcode = 'P0001'; end if;
  if p_photo is null or p_photo not like auth.uid()::text || '/%' then raise exception 'photo_required' using errcode = 'P0001'; end if;
  if (select count(*) from public.nominations where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5
     or (select count(*) from public.nominations where status = 'pending' and created_at > now() - interval '30 days') >= 5000 then
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

create or replace function public.confirm_nomination(p_id bigint, p_lat float8, p_lng float8) returns text
language plpgsql security definer set search_path = '' as $$
declare n public.nominations; v_cat text; v_detour boolean; v_place bigint;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if (select created_at from public.profiles where id = auth.uid()) > now() - interval '7 days' then
    raise exception 'account_too_new' using errcode = 'P0001';
  end if;
  select * into n from public.nominations where id = p_id and status = 'pending' and created_at > now() - interval '30 days' for update;
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

create or replace function public.nominations_near(p_lat float8, p_lng float8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'kind', n.kind, 'otop', n.otop, 'community', n.community,
           'lat', extensions.st_y(n.location::extensions.geometry), 'lng', extensions.st_x(n.location::extensions.geometry),
           'distance_m', round(extensions.st_distance(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography)),
           'confirms', (select count(*) from public.nomination_confirms c where c.nomination_id = n.id),
           'mine', n.user_id = auth.uid(),
           'confirmed', exists (select 1 from public.nomination_confirms c where c.nomination_id = n.id and c.user_id = auth.uid()))
           order by extensions.st_distance(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography)), '[]')
    from (select * from public.nominations n where n.status = 'pending' and n.created_at > now() - interval '30 days'
            and extensions.st_dwithin(n.location, extensions.st_point(p_lng, p_lat)::extensions.geography, 5000)
            order by n.location operator(extensions.<->) extensions.st_point(p_lng, p_lat)::extensions.geography limit 30) n
$$;

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
$$;
