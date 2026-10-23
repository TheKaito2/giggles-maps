-- Lat/lng for one place (QR sticker deep link opens check-in for it). Geography isn't JSON-friendly via the REST API.
create or replace function public.place_for_checkin(p_id bigint)
returns table (id bigint, name text, lat float8, lng float8, is_partner boolean, is_demo boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, extensions.st_y(p.location::extensions.geometry), extensions.st_x(p.location::extensions.geometry),
         p.is_partner, p.is_demo
  from public.places p where p.id = p_id
$$;
grant execute on function public.place_for_checkin(bigint) to anon, authenticated;
