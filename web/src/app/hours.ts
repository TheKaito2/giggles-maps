// OpenStreetMap opening_hours, the common forms only: "24/7", "Mo-Fr 08:00-17:00; Sa 09:00-12:00",
// "Mo,We 10:00-14:00,16:00-20:00", "08:00-17:00" (every day), "Su off". Anything else -> null (unknown, never "closed").
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const dayIdx = (d: Date) => (d.getDay() + 6) % 7;   // Monday = 0

function daysOf(spec: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
    if (!m) return null;
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return out;
}

/** true open, false closed, null when the hours are missing or in a form we don't read. */
export function openNow(oh: string | null | undefined, now = new Date()): boolean | null {
  if (!oh) return null;
  const s = oh.trim();
  if (s === "24/7") return true;
  const today = dayIdx(now), mins = now.getHours() * 60 + now.getMinutes();
  let result: boolean | null = null;   // later rules override earlier ones, as in the OSM spec
  for (const rule of s.split(";").map((r) => r.trim()).filter(Boolean)) {
    const m = /^(?:([A-Za-z,-]+)\s+)?(off|closed|(?:\d{1,2}:\d{2}-\d{1,2}:\d{2})(?:\s*,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? daysOf(m[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    if (!days.has(today)) { result ??= false; continue; }
    if (m[2] === "off" || m[2] === "closed") { result = false; continue; }
    result = m[2].split(",").some((span) => {
      const [a, b] = span.trim().split("-").map((t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; });
      return b > a ? mins >= a && mins < b : mins >= a || mins < b;   // past midnight, e.g. 18:00-02:00
    });
  }
  return result;
}

/** The hours as people read them: "24/7" -> "Open 24 hours", "sunrise-sunset" -> "Sunrise to sunset", day codes spelled
 *  out ("Mo-Fr 08:00-17:00; Su off" -> "Mon–Fri 08:00–17:00 · Sun closed"). Anything else is shown as it is. */
const DAY_NAME: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "holidays" };
export function readableHours(oh: string): string {
  const s = oh.trim();
  if (s === "24/7") return "Open 24 hours";
  return s.split(";").map((r) => r.trim()).filter(Boolean).join(" · ")
    .replace(/\bsunrise\s*-\s*sunset\b/gi, "sunrise to sunset").replace(/^sunrise to sunset/, "Sunrise to sunset")
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAY_NAME[d])
    .replace(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g, "$1–$2").replace(/([a-z])-([A-Z])/g, "$1–$2").replace(/\b(off|closed)\b/g, "closed");
}
