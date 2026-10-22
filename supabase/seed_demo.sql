-- Demo partners for the MVP. These are real local places from OSM used as EXAMPLES:
-- none of them has signed up. The UI labels them "Example partner".
with partners(osm_id, shop_name, bid) as (values
  ('node/12178255329', 'Fika Cafe (example)', 12),
  ('node/13342379301', 'Phuntai Coffee (example)', 10),
  ('node/13342495450', 'Sri Khram indigo cloth (example)', 15),
  ('node/13342495451', 'Sot Si Mai Thai (example)', 12),
  ('node/12888835502', 'Roti Station (example)', 6),
  ('node/12896189601', 'Di an Vietnamese (example)', 8),
  ('node/5568245021',  'Pupajoom (example)', 7),
  ('node/11268455122', 'falling in the cop (example)', 9)
), shops_ins as (
  insert into public.shops (name, wallet_thb, is_demo)
  select shop_name, 500, true from partners
  returning id, name
)
update public.places p
   set is_partner = true, is_demo = true, bid_thb = pr.bid, shop_id = s.id
  from partners pr join shops_ins s on s.name = pr.shop_name
 where p.osm_id = pr.osm_id;

insert into public.collections (slug, name, description, required_count) values
  ('temple-trail', 'Temple Trail', 'Visit 3 temples in Sakon Nakhon city.', 3),
  ('cafe-hopper', 'Café Hopper', 'Check in at 3 local cafés.', 3),
  ('indigo-and-silk', 'Indigo & Silk', 'Visit 2 craft shops or night markets.', 2),
  ('city-explorer', 'City Explorer', 'Find 3 parks, museums, viewpoints or art spots.', 3)
on conflict (slug) do nothing;

insert into public.collection_places (collection_id, place_id)
select c.id, p.id from public.collections c join public.places p on
  (c.slug = 'temple-trail' and p.category = 'temple') or
  (c.slug = 'cafe-hopper' and p.category = 'cafe') or
  (c.slug = 'indigo-and-silk' and p.category in ('craft', 'market')) or
  (c.slug = 'city-explorer' and p.category in ('park', 'museum', 'viewpoint', 'art'))
on conflict do nothing;
