import { admin, HttpError, json, serve } from "../_shared/http.ts";

// Called daily by pg_cron. Deletes selfies older than 30 days (PDPA: keep only as long as needed).
serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) throw new HttpError(401, "unauthorized");
  const db = admin();
  const { data: rows, error } = await db.from("checkins")
    .select("id, selfie_path")
    .not("selfie_path", "is", null)
    .lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
    .limit(1000);
  if (error) throw error;
  if (!rows.length) return json({ purged: 0 });
  const { error: rmErr } = await db.storage.from("selfies").remove(rows.map((r) => r.selfie_path!));
  if (rmErr) throw rmErr;
  const { error: upErr } = await db.from("checkins").update({ selfie_path: null }).in("id", rows.map((r) => r.id));
  if (upErr) throw upErr;
  return json({ purged: rows.length });
});
