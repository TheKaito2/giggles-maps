import type { Maneuver } from "../../lib/api";

// Valhalla has no Thai narrative, so Thai voice is built from the maneuver type and the street name.
const TH: Record<number, string> = {
  1: "ออกเดินทาง", 2: "ออกเดินทาง", 3: "ออกเดินทาง", 4: "ถึงจุดหมายแล้ว", 5: "ถึงจุดหมายแล้ว ทางขวา", 6: "ถึงจุดหมายแล้ว ทางซ้าย",
  7: "ไปต่อ", 8: "ตรงไป", 9: "เบี่ยงขวา", 10: "เลี้ยวขวา", 11: "เลี้ยวขวาหักศอก", 12: "กลับรถทางขวา", 13: "กลับรถทางซ้าย",
  14: "เลี้ยวซ้ายหักศอก", 15: "เลี้ยวซ้าย", 16: "เบี่ยงซ้าย", 17: "ขึ้นทางลาด ตรงไป", 18: "ขึ้นทางลาดทางขวา", 19: "ขึ้นทางลาดทางซ้าย",
  20: "ออกทางขวา", 21: "ออกทางซ้าย", 22: "ตรงไป", 23: "ชิดขวา", 24: "ชิดซ้าย", 25: "เข้าทางหลัก", 26: "เข้าวงเวียน",
  27: "ออกจากวงเวียน", 28: "ขึ้นเรือข้ามฟาก", 29: "ออกจากเรือข้ามฟาก", 37: "รวมเข้าทางขวา", 38: "รวมเข้าทางซ้าย",
};
const ARRIVE = new Set([4, 5, 6]);

const distanceTh = (m: number) => m >= 1000 ? `อีก ${(m / 1000).toFixed(1)} กิโลเมตร` : `อีก ${Math.round(m / 50) * 50 || 20} เมตร`;
const distanceEn = (m: number) => m >= 1000 ? `In ${(m / 1000).toFixed(1)} kilometres` : `In ${Math.round(m / 50) * 50 || 20} metres`;

/** What to say for a maneuver `m` metres ahead (0 = now). */
export function say(m: Maneuver, metres: number, lang: "th" | "en"): string {
  if (lang === "th") {
    const act = (TH[m.type] ?? "ไปต่อ") + (m.street && !ARRIVE.has(m.type) ? ` เข้าสู่ ${m.street}` : "");
    return metres > 30 ? `${distanceTh(metres)} ${act}` : act;
  }
  const act = m.instruction.replace(/\.$/, "");
  return metres > 30 ? `${distanceEn(metres)}, ${act.charAt(0).toLowerCase()}${act.slice(1)}` : act;
}
