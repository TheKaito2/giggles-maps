import { type LucideIcon, Amphora, Banknote, BedDouble, Castle, CircleParking, Coffee, CreditCard, Croissant, Droplets, Fuel, Gem, Gift,
  HandHeart, Hospital, Hotel, IceCreamCone, Library, Mail, Moon, Mountain, Palette, Pill, PlugZap, Sandwich, ShieldCheck,
  ShoppingBag, ShoppingBasket, ShoppingCart, Smile, Sparkles, Stethoscope, Store, Toilet, TreePine, Trees, Users, UtensilsCrossed, Waves,
  Wine } from "lucide-react";

/** Google-Maps-style groups: one colour each for pins and icon chips. */
export const GROUPS = {
  food: { en: "Food & drink", th: "อาหารและเครื่องดื่ม", colour: "#e8710a" },
  shopping: { en: "Shopping", th: "ช้อปปิ้ง", colour: "#1a73e8" },
  local: { en: "OTOP & community", th: "โอทอปและชุมชน", colour: "#8e24aa" },
  sights: { en: "Sights", th: "ที่เที่ยว", colour: "#0f9d8a" },
  stay: { en: "Stay", th: "ที่พัก", colour: "#d81b60" },
  health: { en: "Health", th: "สุขภาพ", colour: "#d93025" },
  services: { en: "Services", th: "บริการ", colour: "#5f6368" },
} as const;
export type Group = keyof typeof GROUPS;

/** Every place kind (public.places.kind, set by the importer): icon, labels and group. */
export const KINDS: Record<string, { icon: LucideIcon; en: string; th: string; group: Group }> = {
  restaurant: { icon: UtensilsCrossed, en: "Restaurant", th: "ร้านอาหาร", group: "food" },
  fast_food: { icon: Sandwich, en: "Fast food", th: "ฟาสต์ฟู้ด", group: "food" },
  cafe: { icon: Coffee, en: "Café", th: "คาเฟ่", group: "food" },
  bakery: { icon: Croissant, en: "Bakery", th: "เบเกอรี่", group: "food" },
  dessert: { icon: IceCreamCone, en: "Dessert", th: "ของหวาน", group: "food" },
  bar: { icon: Wine, en: "Bar", th: "บาร์", group: "food" },
  temple: { icon: Castle, en: "Temple", th: "วัด", group: "sights" },
  museum: { icon: Library, en: "Museum", th: "พิพิธภัณฑ์", group: "sights" },
  viewpoint: { icon: Mountain, en: "Viewpoint", th: "จุดชมวิว", group: "sights" },
  attraction: { icon: Sparkles, en: "Attraction", th: "สถานที่ท่องเที่ยว", group: "sights" },
  waterfall: { icon: Droplets, en: "Waterfall", th: "น้ำตก", group: "sights" },
  beach: { icon: Waves, en: "Beach", th: "ชายหาด", group: "sights" },
  park: { icon: Trees, en: "Park", th: "สวนสาธารณะ", group: "sights" },
  national_park: { icon: TreePine, en: "National park", th: "อุทยานแห่งชาติ", group: "sights" },
  art: { icon: Palette, en: "Art", th: "ศิลปะ", group: "sights" },
  otop: { icon: Gem, en: "OTOP", th: "โอทอป", group: "local" },
  community_enterprise: { icon: HandHeart, en: "Community enterprise", th: "วิสาหกิจชุมชน", group: "local" },
  craft: { icon: Amphora, en: "Local craft", th: "งานฝีมือ", group: "local" },
  souvenir: { icon: Gift, en: "Souvenirs", th: "ของฝาก", group: "shopping" },
  market: { icon: Store, en: "Market", th: "ตลาด", group: "shopping" },
  night_market: { icon: Moon, en: "Night market", th: "ตลาดกลางคืน", group: "shopping" },
  mall: { icon: ShoppingBag, en: "Mall", th: "ห้างสรรพสินค้า", group: "shopping" },
  supermarket: { icon: ShoppingCart, en: "Supermarket", th: "ซูเปอร์มาร์เก็ต", group: "shopping" },
  convenience: { icon: ShoppingBasket, en: "Convenience store", th: "ร้านสะดวกซื้อ", group: "shopping" },
  hotel: { icon: Hotel, en: "Hotel", th: "โรงแรม", group: "stay" },
  guesthouse: { icon: BedDouble, en: "Guesthouse", th: "เกสต์เฮาส์", group: "stay" },
  hospital: { icon: Hospital, en: "Hospital", th: "โรงพยาบาล", group: "health" },
  clinic: { icon: Stethoscope, en: "Clinic", th: "คลินิก", group: "health" },
  pharmacy: { icon: Pill, en: "Pharmacy", th: "ร้านขายยา", group: "health" },
  dentist: { icon: Smile, en: "Dentist", th: "ทันตกรรม", group: "health" },
  fuel: { icon: Fuel, en: "Gas station", th: "ปั๊มน้ำมัน", group: "services" },
  ev_charging: { icon: PlugZap, en: "EV charging", th: "ที่ชาร์จรถไฟฟ้า", group: "services" },
  bank: { icon: Banknote, en: "Bank", th: "ธนาคาร", group: "services" },
  atm: { icon: CreditCard, en: "ATM", th: "ตู้เอทีเอ็ม", group: "services" },
  police: { icon: ShieldCheck, en: "Police", th: "สถานีตำรวจ", group: "services" },
  post_office: { icon: Mail, en: "Post office", th: "ไปรษณีย์", group: "services" },
  toilets: { icon: Toilet, en: "Toilets", th: "ห้องน้ำ", group: "services" },
  parking: { icon: CircleParking, en: "Parking", th: "ที่จอดรถ", group: "services" },
  community_centre: { icon: Users, en: "Community centre", th: "ศูนย์ชุมชน", group: "local" },
};
// places imported before kinds existed only have the coarse planner category
// "shop" in a plan is a 7-Eleven-style pit stop (the only shops the planner adds), also once kept through an edit
const FROM_CATEGORY: Record<string, string> = { food: "restaurant", craft: "craft", shop: "convenience" };
export const kindOf = (kind?: string | null, category?: string | null) =>
  KINDS[kind ?? ""] ?? KINDS[FROM_CATEGORY[category ?? ""] ?? category ?? ""] ?? KINDS.attraction;
export const colourOf = (kind?: string | null, category?: string | null) => GROUPS[kindOf(kind, category).group].colour;
