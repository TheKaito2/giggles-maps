import { admin, HttpError, json, serve } from "../_shared/http.ts";
import { type LatLng, type Mode, valhallaPost } from "../_shared/valhalla.ts";

// Cron (every 5 minutes, migrations 101-102): road minutes from a batch of rated places to their nearest neighbours, per
// mode, from our own routing server only (never the paid backup), into place_links. plan-route reads them before asking
// the routing server. The cursor moves only after a batch is saved; a routing failure stops this run and the same batch
// is tried again next time.
const MODES: Mode[] = ["auto", "bicycle", "pedestrian"];
const BATCH = 40;          // source places per mode per run
const PARALLEL = 4;        // routing calls at a time (gentle on the PC)
const BUDGET_MS = 100_000; // stop starting new work after this, well inside the edge function's time limit

interface Source extends LatLng { id: number; near: (LatLng & { id: number })[] }

/** Road minutes from one place to its neighbours; throws when the routing server fails. */
async function minutesTo(s: Source, mode: Mode): Promise<number[]> {
  const loc = (p: LatLng) => ({ lat: p.lat, lon: p.lng });
  const res = await valhallaPost("sources_to_targets", { sources: [loc(s)], targets: s.near.map(loc), costing: mode },
    { backupKey: "", timeoutMs: 6000 });
  // a 4xx is about this place (e.g. 442 "No path could be found": a road island): no links for it, carry on.
  // Only a 5xx or a network error (thrown by valhallaPost) means the server is in trouble and stops the run.
  if (res.status >= 400 && res.status < 500) { await res.body?.cancel(); return []; }
  if (!res.ok) throw new Error(`routing ${res.status}`);
  const d = await res.json();
  return (d.sources_to_targets?.[0] ?? []).map((c: { time: number | null }) => (c.time == null ? Infinity : c.time / 60));
}

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) throw new HttpError(401, "unauthorized");
  const db = admin();
  const t0 = Date.now();
  const report: Record<string, { places: number; links: number } | string> = {};
  for (const mode of MODES) {
    if (Date.now() - t0 > BUDGET_MS) { report[mode] = "skipped: out of time"; continue; }
    const { data, error } = await db.rpc("place_links_batch", { p_mode: mode, p_n: BATCH });
    if (error) throw error;
    const sources = (data ?? []) as Source[];
    const rows: { a: number; b: number; mode: Mode; minutes: number; built_at: string }[] = [];
    const now = new Date().toISOString();
    try {
      for (let i = 0; i < sources.length; i += PARALLEL) {
        if (Date.now() - t0 > BUDGET_MS) throw new Error("out of time");
        await Promise.all(sources.slice(i, i + PARALLEL).map(async (s) => {
          if (!s.near.length) return;
          (await minutesTo(s, mode)).forEach((min, j) => {
            if (Number.isFinite(min)) rows.push({ a: s.id, b: s.near[j].id, mode, minutes: min, built_at: now });
          });
        }));
      }
    } catch (e) {
      // routing down or slow: keep the cursor where it is, and leave the other modes for the next run
      console.error("place links stopped", mode, e);
      report[mode] = `stopped: ${(e as Error).message}`;
      break;
    }
    if (rows.length) {
      const { error: upErr } = await db.from("place_links").upsert(rows);
      if (upErr) throw upErr;
    }
    const { error: cErr } = await db.rpc("place_links_commit", { p_mode: mode, p_last: sources.length ? sources.at(-1)!.id : 0 });
    if (cErr) throw cErr;
    report[mode] = { places: sources.length, links: rows.length };
  }
  console.log(JSON.stringify({ event: "place_links", ms: Date.now() - t0, ...report }));
  return json(report);
});
