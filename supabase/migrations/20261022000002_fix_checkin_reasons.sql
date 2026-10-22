-- text[] || 'literal' parses the literal as an array; append reasons explicitly.
create or replace function public.record_checkin(
  p_user uuid, p_place bigint, p_lat float8, p_lng float8, p_accuracy float8,
  p_selfie_path text, p_face_count int, p_client jsonb default '{}')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_place public.places;
  v_here extensions.geography := extensions.st_point(p_lng, p_lat)::extensions.geography;
  v_dist float8;
  v_reasons text[] := '{}';
  v_status text;
  v_last record;
  v_kmh float8;
  v_rewarded boolean := false;
  v_checkin uuid;
  v_billed numeric := 0;
  v_wallet numeric;
  v_badges jsonb := '[]';
  c record;
begin
  select * into v_place from public.places where id = p_place;
  if not found then raise exception 'place % not found', p_place using errcode = 'P0002'; end if;

  v_dist := extensions.st_distance(v_place.location, v_here);
  if v_dist > 60 then v_reasons := array_append(v_reasons, 'too_far'); end if;
  if p_face_count < 1 then v_reasons := array_append(v_reasons, 'no_face'); end if;
  if p_selfie_path is null or p_selfie_path not like p_user::text || '/%' then v_reasons := array_append(v_reasons, 'no_selfie'); end if;
  if coalesce((p_client->>'is_mock')::boolean, false) then v_reasons := array_append(v_reasons, 'mock_location'); end if;

  -- teleport check against the user's previous check-in in the last 24 h
  select location, created_at into v_last from public.checkins
   where user_id = p_user and status <> 'rejected' and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if found then
    v_kmh := extensions.st_distance(v_last.location, v_here) / 1000.0
             / greatest(extract(epoch from now() - v_last.created_at) / 3600.0, 1.0 / 3600);
    if v_kmh > 150 then v_reasons := array_append(v_reasons, 'speed_jump'); end if;
  end if;

  v_status := case
    when v_reasons && array['too_far','no_face','no_selfie','mock_location','speed_jump'] then 'rejected'
    when p_accuracy > 50 then 'review'
    else 'approved' end;
  if p_accuracy > 50 then v_reasons := array_append(v_reasons, 'low_accuracy'); end if;

  -- one reward per user per place per Bangkok day
  if v_status = 'approved' then
    v_rewarded := not exists (
      select 1 from public.checkins
       where user_id = p_user and place_id = p_place and rewarded
         and (created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date);
    if not v_rewarded then v_reasons := array_append(v_reasons, 'already_rewarded_today'); end if;
  end if;

  insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, selfie_path,
                               face_count, client, status, reasons, rewarded)
  values (p_user, p_place, v_here, p_accuracy, v_dist, p_selfie_path, p_face_count, p_client,
          v_status, v_reasons, v_rewarded)
  returning id into v_checkin;

  -- bill the partner shop for a verified, rewarded visit
  if v_rewarded and v_place.is_partner and v_place.shop_id is not null and v_place.bid_thb > 0 then
    select wallet_thb into v_wallet from public.shops where id = v_place.shop_id for update;
    if v_wallet >= v_place.bid_thb then
      update public.shops set wallet_thb = wallet_thb - v_place.bid_thb where id = v_place.shop_id;
      insert into public.billable_visits (checkin_id, place_id, shop_id, amount_thb)
      values (v_checkin, p_place, v_place.shop_id, v_place.bid_thb);
      v_billed := v_place.bid_thb;
    end if;
  end if;

  -- award any collection this visit completes
  if v_rewarded then
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
  end if;

  return jsonb_build_object('checkin_id', v_checkin, 'status', v_status, 'reasons', v_reasons,
                            'rewarded', v_rewarded, 'billed_thb', v_billed,
                            'distance_m', round(v_dist::numeric, 1), 'new_badges', v_badges);
end;
$$;

