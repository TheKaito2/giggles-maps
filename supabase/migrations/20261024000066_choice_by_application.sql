-- Giggles Choice is not a plan you buy: a Partner applies to be chosen, and only once we choose them can they pay for it.
-- shop_reach: the shop pitch's "travellers near you" number, from real counts only (no names, no routes).

create or replace function public.request_choice(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.shops where id = p_shop and owner_id = auth.uid()) then
    raise exception 'not_your_shop' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.shops where id = p_shop and tier is not null and tier_until > now()) then
    raise exception 'partners_only' using errcode = 'P0001';
  end if;
  update public.shops set choice_requested_at = now() where id = p_shop and not choice_approved;
end $$;

-- for one place: how often Giggles Maps showed it on a route, and how many trips started or ended within 20 km, in 30 days
create function public.shop_reach(p_place bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.name,
    'shown_30d', (select count(*) from public.route_stops s where s.place_id = p.id and s.shown_at > now() - interval '30 days'),
    'trips_near_30d', (select count(*) from public.routes r where r.created_at > now() - interval '30 days'
                         and (extensions.st_dwithin(r.origin, p.location, 20000) or extensions.st_dwithin(r.dest, p.location, 20000))))
  from public.places p where p.id = p_place
$$;
grant execute on function public.shop_reach(bigint) to anon, authenticated;
