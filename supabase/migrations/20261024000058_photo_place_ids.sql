-- Passport photos carry their place id, so a stamp in the book can open every photo taken at that place.

create or replace function public.passport_v2()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                  'province_id', pl.province_id, 'place_id', pl.id, 'at', ch.created_at) order by ch.created_at desc)
                from public.checkins ch join public.places pl on pl.id = ch.place_id
               where ch.user_id = auth.uid() and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden), '[]'),
    'provinces', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th,
                  'stamps', (select count(*) from public.stamps st where st.user_id = auth.uid() and st.province_id = pv.id)))
                from public.provinces pv), '[]'),
    'challenges', coalesce((select jsonb_agg(to_jsonb(c)) from public.challenge_progress(auth.uid()) c), '[]'),
    -- ride-alongs you shared with someone: each trip's 3 memory photos, newest trip first
    'trips', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'started_at', t.started_at, 'photos', p.photos)
                         order by t.started_at desc)
                from public.trips t
                join lateral (select jsonb_agg(jsonb_build_object('checkin_id', ch.id, 'path', ch.selfie_path, 'caption', ch.caption,
                                'place', pl.name, 'at', ch.created_at, 'nickname', coalesce(pr.nickname, 'Explorer')) order by ch.created_at) photos
                                from public.trip_picks(t.id) k join public.checkins ch on ch.id = k
                                join public.places pl on pl.id = ch.place_id join public.profiles pr on pr.id = ch.user_id) p on p.photos is not null
               where exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id = auth.uid())
                 and exists (select 1 from public.trip_members o where o.trip_id = t.id and o.user_id <> auth.uid())), '[]'))
$function$;

create or replace function public.friend_passport(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_friend(auth.uid(), p_id) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'card', public.card_of(p_id),
    'stamps', coalesce((select jsonb_agg(jsonb_build_object(
                  'place_id', st.place_id, 'name', pl.name, 'name_th', pl.name_th, 'category', pl.category, 'tier', st.tier,
                  'province_id', st.province_id, 'event', st.event_slug, 'earned_at', st.earned_at) order by st.earned_at desc)
                from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_id), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
                  'checkin_id', ch.id, 'path', ch.selfie_path, 'caption', ch.caption, 'place', pl.name,
                  'province_id', pl.province_id, 'place_id', pl.id, 'at', ch.created_at) order by ch.created_at desc)
                from public.checkins ch join public.places pl on pl.id = ch.place_id
               where ch.user_id = p_id and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden), '[]'),
    'provinces', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th,
                  'stamps', (select count(*) from public.stamps st where st.user_id = p_id and st.province_id = pv.id)))
                from public.provinces pv), '[]'));
end;
$function$;

