-- Local spotlight: a hidden (reported) traveller photo must not be the card's picture. Same query as before otherwise.
create or replace function public.local_spotlight(p_lat float8, p_lng float8) returns jsonb
language sql stable security definer set search_path = '' as $$
  with prov as (
    select pv.id from public.provinces pv
     where extensions.st_intersects(pv.geom, extensions.st_point(p_lng, p_lat)::extensions.geography) limit 1
  )
  select jsonb_build_object('id', p.id, 'name', p.name, 'name_th', p.name_th, 'kind', p.kind, 'otop', p.otop, 'community', p.community,
           'province', (select name_en from public.provinces where id = p.province_id),
           'photo', (select url from public.place_photos ph where ph.place_id = p.id and not ph.hidden order by ph.id limit 1),
           'visits', (select count(*) from public.checkins c where c.place_id = p.id and c.created_at > now() - interval '7 days'))
    from public.places p
   where (p.otop or p.community) and p.min_level = 0 and p.province_id = (select id from prov)
   order by (select count(*) from public.checkins c where c.place_id = p.id and c.created_at > now() - interval '7 days') desc,
            (select count(*) from public.reviews r where r.place_id = p.id) desc,
            exists (select 1 from public.place_photos ph where ph.place_id = p.id and not ph.hidden) desc,
            md5(p.id::text || to_char(now(), 'IYYY-IW'))
   limit 1
$$;
