// MADE-UP demo-mode content: fake traveller reviews for showing the app off. Shown ONLY while demo mode is on
// (lib/demoGps.ts `demoOn()`), never to real users, never written to the database.
import { seeded } from "./types";
import type { PlaceReview, Who } from "../lib/api";

type Cat = "temple" | "museum" | "art" | "park" | "viewpoint" | "food" | "market" | "cafe" | "craft" | "shop" | "hotel" | "other";

// Each category: 8+ English and 4+ Thai bodies so pages do not repeat.
const T: Record<Cat, { en: string[]; th: string[] }> = {
  temple: {
    en: [
      "Went at 7am before the tour buses. Quiet, cool, and the murals on the ubosot walls are worth the slow walk round.",
      "Dress code is strict: covered shoulders and knees. Bring a sarong just in case.",
      "Small temple but beautiful gold details. Didn't need more than 30 minutes.",
      "Shade in the cloister and bell sounds from the chedi. Peaceful even at midday.",
      "Sunset from the back terrace is the best time. Few visitors after 5pm.",
      "Left a few baht in the offering box and the monk on duty was happy to answer questions.",
      "Stairs are steep, take your time. The view over the river from the top is worth it.",
      "Took my kids here; they liked feeding the fish in the pond by the entrance.",
      "Parking is tricky on weekends. A tuk-tuk from the pier is easier.",
      "Nice spot to rest between sights. Keep your voice low inside the bot.",
    ],
    th: [
      "เช้าๆ ไปแล้วเงียบมาก ลมเย็น ภาพจิตรกรรมฝาผนังสวยมาก แนะนำให้ไปก่อน 8 โมง",
      "วัดสวยมาก ต้องแต่งกายสุภาพนะ ถ้าไม่มีผ้าคลุมไหล่ ทางวัดมีให้ยืมที่หน้าประตู",
      "ไหว้พระแล้วนั่งพักใต้ต้นโพธิ์ตอนบ่าย ร่มเย็นดี ไม่ค่อยมีคนมาเลย",
      "ตอนเย็นพระอาทิตย์ตกหลังองค์พระสวยมาก ควรมาช่วงนี้",
    ],
  },
  museum: {
    en: [
      "Exhibits on the old trade routes are well presented. The audio guide is worth the small fee.",
      "Aircon is strong, a good escape from the heat. Two floors, budget ninety minutes.",
      "Kids loved the dinosaur hall. Stroller friendly with lifts between floors.",
      "Front desk staff gave us a useful map. Captions are in Thai and English.",
      "Smaller than I expected but the coin collection is excellent.",
      "Closed on Mondays, so check hours before you go. The cafe on the ground floor is decent.",
      "Photography is allowed in most rooms except the royal regalia section.",
      "Quiet on weekdays, though school trips arrive on Wednesday mornings.",
      "Historical maps and old photos are the highlight. Good for a rainy afternoon.",
      "Toilets are clean and there are lockers at the entrance for bags.",
    ],
    th: [
      "พิพิธภัณฑ์เย็นสบาย มีของเก่าจัดแสดงเยอะ เด็กๆ ชอบห้องไดโนเสาร์มาก",
      "ค่าเข้าไม่แพง ไกด์ให้ความรู้ดี ป้ายบรรยายมีทั้งไทยและอังกฤษ",
      "ชั้นล่างมีคาเฟ่เล็กๆ เหมาะแวะพักระหว่างชม อาหารพอใช้",
      "วันจันทร์ปิดนะ ก่อนไปเช็คเวลาเปิดปิดก่อน",
    ],
  },
  art: {
    en: [
      "Small gallery but thoughtful curation. The ceramics room was my favourite.",
      "Aircon is cold, so it's a good escape from the heat. Allow about an hour.",
      "Kids got to touch some of the interactive pieces. Staff are patient with them.",
      "The weekend exhibition opening was lively, with a live band and free drinks.",
      "Labels are in Thai and English, which helps. Photography is allowed without flash.",
      "Worth it for the textile section alone, the patterns are incredible.",
      "Quiet on weekday afternoons, almost empty. Bring a notebook for sketching.",
      "Entry fee is modest. The gift shop sells postcards from local artists.",
      "The upstairs gallery has the best natural light, so save it for last.",
      "Not very big, one hour is enough to see everything properly.",
    ],
    th: [
      "นิทรรศการเกี่ยวกับงานช่างฝีมือไทยดีมาก ได้ความรู้เยอะ ค่าเข้าไม่แพง",
      "แอร์เย็นสบาย เดินชมได้เรื่อยๆ ไม่แออัด เหมาะกับพาเด็กมา",
      "ภาพวาดชุดนี้สวยมาก จัดแสงได้ดี ชั้นบนมีมุมให้เด็กเล่นด้วย",
      "พิพิธภัณฑ์เล็กแต่เนื้อหาแน่น ใช้เวลาประมาณชั่วโมงกว่าๆ",
    ],
  },
  park: {
    en: [
      "Sunset from the lake shore is gorgeous. Bring a mat, the grass is soft.",
      "Shade under the big trees makes midday walks bearable. Restrooms near the entrance.",
      "Parking fills up fast on weekends, so arrive before 8am or take a taxi.",
      "Joggers early in the morning, families in the evening. Benches line the path.",
      "Kids loved the playground. The water fountains work, so bring a bottle.",
      "Small park, lovely for a quick break. The pond has turtles.",
      "Lit up nicely after dark and feels safe with plenty of people walking.",
      "The bike lane is clear. Rented one from the shop at the north gate.",
      "Less crowded on weekdays. Good for reading or just sitting with a coffee.",
      "Mosquitoes near the water after sunset, so bring repellent.",
    ],
    th: [
      "พระอาทิตย์ตกที่สวนนี้สวยมาก ลมเย็นๆ เหมาะกับพาหมาไปเดินเล่น",
      "ร่มรื่นดี มีต้นไม้ใหญ่เยอะ นั่งเล่นใต้ต้นได้ทั้งบ่าย",
      "ที่จอดรถหายากตอนเสาร์อาทิตย์ มาเช้าหน่อยจะดีกว่า",
      "มีลานออกกำลังกายให้คนมาทำกันเยอะ บรรยากาศดีมาก สะอาดด้วย",
    ],
  },
  viewpoint: {
    en: [
      "Hike up at golden hour, the view over the river bend is the best photo in town.",
      "Steep last bit, so wear proper shoes. Water is sold at the top but pricey.",
      "Crowded at sunset, arrive 30 minutes early to get a spot at the rail.",
      "Clear mornings give the best visibility, afternoons get hazy.",
      "Breezy and shady at the top, a good place to rest after the climb.",
      "The viewing deck is small but the panorama covers the whole valley.",
      "Took a taxi up, it drops you at the car park, then a 5-minute walk to the lookout.",
      "Entry is free, just tip the guy who keeps the gate.",
      "The night view of the city lights is underrated. Bring a jacket, it gets windy.",
      "Easy to miss the sign on the road, look for the blue gate.",
    ],
    th: [
      "วิวสวยมาก ขึ้นมาตอนเย็นได้ทั้งพระอาทิตย์ตกและไฟเมืองเปิด",
      "ทางขึ้นชันนิดนึงแต่คุ้มค่า ลมแรงด้วย ระวังหมวกหลุด",
      "มีที่นั่งพักตรงศาลาริมทาง ถ่ายรูปตรงจุดชมวิวได้เยอะ",
      "หมอกลงตอนเช้า วิวหน้าผาสวยเหมือนภาพวาด ควรมาช่วง 6 โมงเช้า",
    ],
  },
  food: {
    en: [
      "Order the khao soi, the broth is rich and the noodles are perfectly soft. About 60 baht a bowl.",
      "The queue at lunch is long but moves fast. Cash only, so bring small notes.",
      "Best pad kra pao I've had in the city. Ask for it spicy and they won't hold back.",
      "Tiny shophouse with four plastic stools. The food is simple and honest, prices are fair.",
      "Went for the grilled pork neck, smoky and sweet. Sticky rice was included.",
      "Arrive before 11 or after 1:30 to avoid the rush. The soup sold out by 1pm once.",
      "Good for a cheap breakfast; the rice porridge is comforting on a rainy morning.",
      "No aircon, so eat early or be ready to sweat. Worth it for the som tam.",
      "Prices went up a bit since last year but still reasonable for the portion size.",
      "Vegetarian option available if you ask for no fish sauce, though the broth is not vegetarian.",
    ],
    th: [
      "ก๋วยเตี๋ยวเรือลูกชิ้นน้ำใสรสกลมกล่อมมาก เส้นเหนียวนุ่ม ชามละ 50 บาท",
      "ข้าวมันไก่เจ้านี้อร่อยที่สุดในย่าน น้ำจิ้มเข้มข้น คิวยาวแต่ไม่นานเท่าไหร่",
      "ผัดกะเพราหมูกรอบ ใส่ไข่ดาวด้วย คนขายบอกว่าเผ็ดแค่ไหนก็ได้ ชอบมาก",
      "ร้านเล็กมาก นั่งได้ไม่กี่โต๊ะ แต่รสชาติคงที่ ไปกี่ครั้งก็อร่อย",
    ],
  },
  market: {
    en: [
      "Go after 5pm when the stalls are fully lit. Grilled squid and sticky rice are the must-eats.",
      "Bargain politely on souvenirs, but food prices are usually fixed.",
      "Crowded and narrow, so keep your bag in front. Worth the squeeze for the snacks.",
      "Try the coconut ice cream from the cart near the gate, creamy and cheap.",
      "Cash is king here, many stalls don't take cards. Bring 100-baht notes for change.",
      "Smell of fried fish and herbs everywhere. Good for dinner if you're hungry.",
      "The clothes stalls at the back have decent prices if you dig through the piles.",
      "Very hot in the day, so come in the evening when it cools down a bit.",
      "Lots of fresh fruit to sample, the pineapple is sweet. Ask before you taste.",
      "Easy to get lost, but that is half the fun. Walk the central lane first.",
    ],
    th: [
      "ตลาดคึกคักมาก ตอนเย็นเดินชิลๆ ลองปลาหมึกย่างกับข้าวเหนียวมะม่วง",
      "ของฝากราคาไม่แพง ต่อรองได้นิดหน่อย แม่ค้าใจดี",
      "ไปตอนค่ำ ลมเย็นสบาย มีของกินให้เลือกเยอะมาก",
      "ขนมครกตรงมุมหัวตลาดอร่อย หอมกะทิ กรอบนอกนุ่มใน",
    ],
  },
  cafe: {
    en: [
      "Flat white is smooth and not too bitter. Seats by the window get good light for working.",
      "Aircon is strong, so bring a jacket. Wifi is fast and there are plugs at every table.",
      "The matcha here is the real deal, not sugar syrup. Pastries sell out by noon.",
      "Upstairs has a view over the old town rooftops. Go late afternoon.",
      "Cosy little place, the owner roasts their own beans. Ask for the single origin pour-over.",
      "Slightly pricey for the size but the cold brew is worth it on a hot day.",
      "Quiet on weekday mornings, loud at weekend brunch. Staff are friendly.",
      "Good spot to sit for hours. The toilet is clean and they don't rush you.",
      "The cheesecake was dense and rich, one slice was plenty for two people.",
      "Oat milk is a standard option, which is nice for a Thai cafe.",
    ],
    th: [
      "กาแฟดริปรสชาติดีมาก กลิ่นหอม ร้านบรรยากาศเหมาะกับการนั่งอ่านหนังสือ",
      "มุมนั่งริมหน้าต่างแดดดีมาก ไวไฟแรง ปลั๊กมีทุกโต๊ะ",
      "ชาเขียวเข้มข้น ไม่หวานเกินไป ขนมเค้กนุ่มมาก",
      "แอร์เย็นสบาย ชั้นสองวิวดี เห็นหลังคาเมืองเก่าทั้งผืน",
    ],
  },
  craft: {
    en: [
      "Watched the indigo dye process, the fabric changes colour as it comes out of the vat.",
      "Every piece is handmade so no two are the same. Bought a scarf for my sister.",
      "The workshop is small, so book ahead for the weaving class.",
      "Prices are fair for the time that goes into each item. Staff explain everything.",
      "Great souvenirs that aren't tacky. Ask about the natural dyes.",
      "The shop is tucked behind the main road, look for the wooden sign.",
      "Tried a pottery class here, messy but fun. Took about two hours.",
      "The silver jewellery is well made, buy from the workshop rather than the front shop.",
      "Cute bags and purses with good stitching. Card payment accepted.",
      "Quiet place, you can see the artisans working behind the counter.",
    ],
    th: [
      "ย้อมครามด้วยมือเอง สนุกมาก ได้ผ้าสีสวยติดมือกลับบ้าน",
      "ผ้าทอฝีมือชาวบ้าน ลายสวย เนื้อผ้าดี ราคาไม่แพงเลย",
      "ซื้อของฝากที่นี่ได้เลย ทุกชิ้นทำมือ ไม่เหมือนกันสักชิ้น",
      "เจ้าของร้านใจดี สอนวิธีทอให้ด้วย ได้ความรู้กลับบ้านเยอะ",
    ],
  },
  shop: {
    en: [
      "Good range of local brands, the staff know their products well.",
      "Prices are a bit higher than the market but the quality is clearly better.",
      "Quick stop for snacks and drinks, and the aircon is strong.",
      "Small shop, easy to browse in ten minutes. Cash and card both accepted.",
      "Bought a few gifts here, the packaging was nice and neat.",
      "Shelves are well organised, easy to find what you need.",
      "Staff are friendly and didn't push sales. Good place to ask for recommendations.",
      "Open late, handy if you forgot something on the way back to the hotel.",
      "Limited stock on weekends, so get there early for the popular items.",
      "Clean and bright, a nice break from the street outside.",
    ],
    th: [
      "ร้านใหญ่กว่าที่คิด มีของให้เลือกเยอะ พนักงานช่วยหาให้ดี",
      "ของฝากแพ็กสวย ราคาโอเค ซื้อได้ทั้งของกินและของใช้",
      "แวะซื้อน้ำกับขนมระหว่างทางได้ แอร์เย็นมาก",
      "ร้านเล็กๆ แต่สินค้าดี มีของท้องถิ่นให้เลือกเยอะ",
    ],
  },
  hotel: {
    en: [
      "The room was clean and quiet, and the bed was comfortable. Breakfast spread is decent.",
      "Staff remembered our names by the second day. The pool is small but nice in the evening.",
      "A short walk to the night market. Aircon works well.",
      "Breakfast ends at 10am, so plan accordingly. Good coffee in the lobby.",
      "Bathroom has good water pressure. Bring a power adapter, there are only a few sockets.",
      "Wifi was patchy in the room but strong near the lobby.",
      "Pricey for what you get, but the rooftop bar sunset view is lovely.",
      "The front desk arranged a driver for the day trip at a fair price.",
      "Quiet street, so sleep is good. The lift can be slow at peak times.",
      "Clean and simple, exactly what we needed for a short stay.",
    ],
    th: [
      "ห้องสะอาดมาก เตียงนอนสบาย เจ้าหน้าที่ต้อนรับอัธยาศัยดี",
      "อาหารเช้าหลากหลาย ข้าวต้มอร่อย ที่จอดรถกว้างขวาง",
      "วิวจากระเบียงห้องดีมาก เงียบสงบ เหมาะกับการพักผ่อน",
      "ทำเลสะดวก เดินไปตลาดกลางคืนได้ ราคาคุ้มค่า",
    ],
  },
  other: {
    en: [
      "Good spot, worth a stop if you're in the area.",
      "Easy to find and not too crowded. Staff were helpful.",
      "Nice atmosphere, took some photos here.",
      "Clean and well kept, would come back.",
      "A bit hard to reach by public transport, a taxi is easier.",
      "Quick visit, around an hour. Nothing fancy but pleasant.",
      "Good for a relaxed afternoon, not overly touristy.",
      "Locals seem to come here too, always a good sign.",
      "Parking is limited, so plan ahead on weekends.",
      "Would recommend going early before the heat hits.",
    ],
    th: [
      "ที่นี่บรรยากาศดี เงียบสงบ เหมาะกับการมาพักผ่อน",
      "เดินทางง่าย มีที่จอดรถ พนักงานพูดคุยเป็นกันเอง",
      "คุ้มค่ากับเวลาที่เสียไป ไว้จะมาอีก",
      "สะอาดเรียบร้อย ไปตอนเช้าอากาศเย็นสบาย",
    ],
  },
};

const DAY_MS = 86_400_000;

function categoryKey(category: string): Cat {
  return category in T ? (category as Cat) : "other";
}

/** Deterministic made-up reviews for a place: same placeId always gives the same output. */
export function demoReviews(
  placeId: number,
  category: string,
  people: { id: string; nickname: string; colour: string; avatar: Record<string, string>; level: number }[],
  now = new Date(),
): { reviews: PlaceReview[]; rating: number; count: number } {
  const r = seeded(placeId);
  const bank = T[categoryKey(category)];

  // Shuffle a copy of the people, then take the first n: no repeats.
  const pool = people.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const n = Math.min(pool.length, 3 + Math.floor(r() * 4));

  // Days ago, ascending, so the list comes out newest first.
  const daysAgo = Array.from({ length: n }, () => Math.floor(r() * 120)).sort((a, b) => a - b);

  const used = new Set<string>();   // no two reviews of one place say the same thing
  const reviews: PlaceReview[] = pool.slice(0, n).map((p, i) => {
    const roll = r();
    const rating = roll < 0.15 ? 3 : roll < 0.55 ? 4 : 5;
    const useThai = r() < 0.3;
    const noBody = r() < 0.12;
    const texts = useThai ? bank.th : bank.en;
    let k = Math.floor(r() * texts.length);
    for (let tries = 0; used.has(texts[k]) && tries < texts.length; tries++) k = (k + 1) % texts.length;
    const body = noBody || used.has(texts[k]) ? null : texts[k];
    if (body) used.add(body);
    const who: Who = { id: p.id, nickname: p.nickname, colour: p.colour, avatar: p.avatar, level: p.level };
    return {
      who,
      rating,
      body,
      at: new Date(now.getTime() - daysAgo[i] * DAY_MS).toISOString(),
      mine: false,
    };
  });

  const total = reviews.reduce((sum, rv) => sum + rv.rating, 0);
  const rating = reviews.length ? Math.round((total / reviews.length) * 10) / 10 : 0;
  const count = reviews.length + 5 + Math.floor(r() * 76);
  return { reviews, rating, count };
}
