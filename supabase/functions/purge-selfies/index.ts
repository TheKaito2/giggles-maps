import { admin, HttpError, json, serve } from "../_shared/http.ts";

// Called daily by pg_cron. Check-in photos are the passport album now and stay until the user deletes them;
// this only clears, after 30 days (PDPA: keep only as long as needed), photos of check-ins that earned nothing
// (rejected, or review: GPS too rough, and nobody reviews those), uploads that never got a check-in or nomination, and
// nomination photos 30 days after the nomination closed (selfie_orphans, migration 092).
serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) throw new HttpError(401, "unauthorized");
  const db = admin();
  const { data: rows, error } = await db.from("checkins")
    .select("id, selfie_path")
    .not("selfie_path", "is", null)
    .in("status", ["rejected", "review"])
    .lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
    .limit(1000);
  if (error) throw error;
  if (rows.length) {
    const { error: rmErr } = await db.storage.from("selfies").remove(rows.map((r) => r.selfie_path!));
    if (rmErr) throw rmErr;
    const { error: upErr } = await db.from("checkins").update({ selfie_path: null }).in("id", rows.map((r) => r.id));
    if (upErr) throw upErr;
  }
  // orphans: files in the selfies bucket only, at most 1000 a run (selfie_orphans, migration 090)
  const { data: orphans, error: orErr } = await db.rpc("selfie_orphans", { p_limit: 1000 });
  if (orErr) throw orErr;
  const paths = (orphans ?? []) as string[];
  if (paths.length) {
    const { error: rmErr } = await db.storage.from("selfies").remove(paths);
    if (rmErr) throw rmErr;
  }
  return json({ purged: rows.length, orphans: paths.length });
});
