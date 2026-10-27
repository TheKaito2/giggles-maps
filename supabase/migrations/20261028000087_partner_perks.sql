-- Partner member perks: a paying shop (Partner or Giggles Choice) writes one short perk for Giggles members
-- ("10% off for members"). The place sheet shows it, and detour results mark partner stops that have one.
-- places.perk_text already exists (membership levels, 010); since v5 nothing showed it. Only places with a live paid tier
-- (places_tiers: verified, owner signed in, paid up) ever return it, so the old example texts on unpaid places stay hidden.

-- the perks of these places, for the ones that are paid partners right now
create function public.places_perks(p_ids bigint[]) returns table (id bigint, perk_text text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.perk_text
    from public.places_tiers(p_ids) t join public.places p on p.id = t.id
   where nullif(trim(p.perk_text), '') is not null
$$;
grant execute on function public.places_perks(bigint[]) to anon, authenticated;

-- the owner sets (or clears, with '' or null) the perk; only while their shop pays for a tier; 80 characters at most
create function public.set_my_perk(p_place bigint, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(trim(coalesce(p_text, '')), '');
begin
  if not public.owns_place(p_place) then raise exception 'not_your_place' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.places p join public.shops s on s.id = p.shop_id
                  where p.id = p_place and s.tier is not null and s.tier_until > now()) then
    raise exception 'partners_only' using errcode = 'P0001';
  end if;
  if v is not null and (char_length(v) > 80 or v ~ '[<>[:cntrl:]]') then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  update public.places set perk_text = v where id = p_place;
end $$;
revoke execute on function public.set_my_perk(bigint, text) from public, anon;
grant execute on function public.set_my_perk(bigint, text) to authenticated;

-- the listing editor: the perk, and whether this place's shop can set one (a live paid tier)
create or replace function public.my_places() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'shop_id', p.shop_id,
           'opening_hours', p.opening_hours, 'phone', p.phone, 'website', p.website, 'description', p.description,
           'otop', p.otop, 'otop_stars', p.otop_stars, 'community', p.community,
           'verified', p.qr_code is not null and p.last_qr_scan_at is not null, 'qr_code', p.qr_code,
           'perk_text', p.perk_text, 'paid', s.tier is not null and s.tier_until > now(),
           'products', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name, 'price', sp.price, 'photo', sp.photo_path) order by sp.id)
                                 from public.shop_products sp where sp.place_id = p.id), '[]'),
           'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.url) order by ph.id)
                               from public.place_photos ph where ph.place_id = p.id and ph.source = 'owner'), '[]')) order by p.name), '[]')
    from public.places p join public.shops s on s.id = p.shop_id where s.owner_id = auth.uid()
$$;
