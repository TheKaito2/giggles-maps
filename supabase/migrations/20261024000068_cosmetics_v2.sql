-- Cosmetics v2: ~40 new items and three tiers above Legendary, sold in the shop's Vault.
-- Rarity is computed client side from price: Mythic 2,500 (8 items), Celestial 7,500 (5), Transcendent 25,000 (3).
-- Siam Si still draws only by its price bands (1-150 / 200-500 / gacha_only), so vault items never drop from a stick.

insert into public.shop_items (kind, id, name_en, name_th, price, plus, sort, gacha_only, plus_only) values
  -- covers
  ('theme', 'tuk-tuk', 'Tuk-tuk', 'ตุ๊กตุ๊ก', 120, false, 92, false, false),
  ('theme', 'rice-paddy', 'Rice paddy', 'นาขั้นบันได', 150, false, 93, false, false),
  ('theme', 'beach-day', 'Beach day', 'วันทะเล', 250, false, 94, false, false),
  ('theme', 'jasmine', 'Jasmine', 'มะลิ', 300, false, 95, false, false),
  ('theme', 'floating-market', 'Floating market', 'ตลาดน้ำ', 600, false, 96, false, false),
  ('theme', 'elephant-parade', 'Elephant parade', 'ขบวนช้าง', 800, false, 97, false, false),
  ('theme', 'naga-scales', 'Naga scales', 'เกล็ดพญานาค', 2500, false, 98, false, false),
  ('theme', 'golden-hour', 'Golden hour', 'แสงทองยามเย็น', 2500, false, 99, false, false),
  ('theme', 'kinnaree-dawn', 'Kinnaree dawn', 'รุ่งอรุณกินรี', 7500, false, 100, false, false),
  ('theme', 'erawan', 'Erawan', 'ช้างเอราวัณ', 25000, false, 101, false, false),
  -- frames
  ('frame', 'washi', 'Washi tape', 'เทปวาชิ', 100, false, 102, false, false),
  ('frame', 'banana-leaf', 'Banana leaf', 'ใบตอง', 150, false, 103, false, false),
  ('frame', 'bamboo', 'Bamboo', 'ไม้ไผ่', 300, false, 104, false, false),
  ('frame', 'neon', 'Neon sign', 'ป้ายนีออน', 700, false, 105, false, false),
  ('frame', 'dragon-fire', 'Dragon fire', 'ไฟมังกร', 2500, false, 106, false, false),
  ('frame', 'holo-prism', 'Holo prism', 'ปริซึมโฮโล', 7500, false, 107, false, false),
  -- name flair
  ('flair', 'mango', 'Mango', 'มะม่วง', 100, false, 108, false, false),
  ('flair', 'lime', 'Lime', 'มะนาว', 100, false, 109, false, false),
  ('flair', 'sunset', 'Sunset', 'อาทิตย์อัสดง', 250, false, 110, false, false),
  ('flair', 'ocean', 'Ocean', 'ทะเลคราม', 250, false, 111, false, false),
  ('flair', 'neon', 'Neon', 'นีออน', 600, false, 112, false, false),
  ('flair', 'ember', 'Ember', 'ถ่านเพลิง', 2500, false, 113, false, false),
  ('flair', 'starlight', 'Starlight', 'แสงดาว', 7500, false, 114, false, false),
  ('flair', 'prismatic', 'Prismatic', 'ปริซึม', 25000, false, 115, false, false),
  -- titles
  ('title', 'night-owl', 'Night owl', 'นกฮูกราตรี', 120, false, 116, false, false),
  ('title', 'street-food-scout', 'Street-food scout', 'นักล่าสตรีทฟู้ด', 150, false, 117, false, false),
  ('title', 'island-hopper', 'Island hopper', 'นักท่องเกาะ', 300, false, 118, false, false),
  ('title', 'mountain-goat', 'Mountain goat', 'นักพิชิตดอย', 300, false, 119, false, false),
  ('title', 'sunrise-chaser', 'Sunrise chaser', 'นักล่าแสงเช้า', 350, false, 120, false, false),
  ('title', 'map-maker', 'Map maker', 'นักทำแผนที่', 900, false, 121, false, false),
  ('title', 'naga-rider', 'Naga rider', 'ผู้ขี่พญานาค', 2500, false, 122, false, false),
  ('title', 'keeper-77', 'Keeper of the 77', 'ผู้พิทักษ์ 77 จังหวัด', 7500, false, 123, false, false),
  ('title', 'myth-of-siam', 'Myth of Siam', 'ตำนานแห่งสยาม', 25000, false, 124, false, false),
  -- avatar
  ('avatar', 'headwear:beret', 'Beret', 'หมวกเบเร่ต์', 150, false, 125, false, false),
  ('avatar', 'bg:rice-field', 'Rice field', 'ทุ่งนา', 200, false, 126, false, false),
  ('avatar', 'bg:beach', 'Beach', 'ชายหาด', 250, false, 127, false, false),
  ('avatar', 'glasses:monocle', 'Monocle', 'แว่นเลนส์เดียว', 300, false, 128, false, false),
  ('avatar', 'outfit:suit', 'Suit', 'ชุดสูท', 600, false, 129, false, false),
  ('avatar', 'headwear:chada', 'Chada crown', 'ชฎา', 2500, false, 130, false, false),
  ('avatar', 'outfit:chut-thai', 'Chut Thai silk', 'ชุดไทยไหมทอง', 2500, false, 131, false, false),
  ('avatar', 'bg:galaxy', 'Galaxy', 'ทางช้างเผือก', 2500, false, 132, false, false),
  ('avatar', 'headwear:halo', 'Halo', 'วงแหวนเทวดา', 7500, false, 133, false, false)
on conflict (kind, id) do nothing;

insert into public.avatar_parts (slot, id) values
  ('headwear', 'beret'), ('bg', 'rice-field'), ('bg', 'beach'), ('glasses', 'monocle'), ('outfit', 'suit'),
  ('headwear', 'chada'), ('outfit', 'chut-thai'), ('bg', 'galaxy'), ('headwear', 'halo')
on conflict do nothing;

-- daily picks: same as 20261024000054 plus "price < 2000", so vault items are never a daily pick
create or replace function public.shop_today()
returns jsonb language sql stable security definer set search_path = '' as $$
  with d as (select (now() at time zone 'Asia/Bangkok')::date as day)
  select jsonb_build_object(
    'ends', ((select day from d) + 1)::timestamp at time zone 'Asia/Bangkok',
    'picks', (select jsonb_agg(jsonb_build_object('kind', kind, 'id', id)) from (
                select i.kind, i.id from public.shop_items i, d
                 where i.price > 0 and not i.plus and not i.gacha_only and i.price < 2000
                 order by md5(i.kind || i.id || d.day::text) limit 6) p),
    'sets', (select jsonb_agg(jsonb_build_object('id', s.id, 'name_en', s.name_en, 'name_th', s.name_th, 'blurb_en', s.blurb_en,
                     'items', to_jsonb(s.items),
                     'full', (select coalesce(sum(i.price), 0) from unnest(s.items) x join public.shop_items i
                               on i.kind = split_part(x, ':', 1) and i.id = substr(x, length(split_part(x, ':', 1)) + 2)),
                     'price', (select coalesce(sum(coins), 0) from public.set_missing(auth.uid(), s.id)))
                   order by md5(s.id || extract(week from d.day)::text)) from public.shop_sets s, d))
$$;
