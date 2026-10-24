-- Ride-along memories: each trip keeps 3 photos from its album (first, middle and last, by time). People who were on the
-- trip can still see those 3 after it ends; the rest of the album stays visible only while the trip runs (as before).

create or replace function public.trip_picks(p_trip uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with album as (
    select ch.id, row_number() over (order by ch.created_at) as n, count(*) over () as total
      from public.trip_members m
      join public.checkins ch on ch.user_id = m.user_id and ch.created_at >= m.joined_at and (m.left_at is null or ch.created_at <= m.left_at)
     where m.trip_id = p_trip and ch.status <> 'rejected' and ch.selfie_path is not null and not ch.photo_hidden)
  select id from album where n in (1, (total + 1) / 2, total)
$$;
revoke all on function public.trip_picks(uuid) from public, anon, authenticated;

create or replace function public.can_see_photo(p_path text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.checkins c
     where c.selfie_path = p_path and not c.photo_hidden and c.status <> 'rejected'
       and (c.public_photo or public.is_friend(auth.uid(), c.user_id)
            or exists (select 1 from public.trips t
                         join public.trip_members a on a.trip_id = t.id and a.user_id = auth.uid() and a.left_at is null
                         join public.trip_members b on b.trip_id = t.id and b.user_id = c.user_id
                        where t.ended_at is null and t.ends_at > now()
                          and c.created_at >= b.joined_at and (b.left_at is null or c.created_at <= b.left_at))
            -- a trip's 3 memory photos stay visible to everyone who was on it
            or exists (select 1 from public.trip_members a join public.trip_members b on b.trip_id = a.trip_id and b.user_id = c.user_id
                        where a.user_id = auth.uid() and c.id in (select public.trip_picks(a.trip_id)))))
$function$;

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
                  'province_id', pl.province_id, 'at', ch.created_at) order by ch.created_at desc)
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
