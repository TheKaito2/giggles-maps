import { admin, json, requireUser, serve } from "../_shared/http.ts";

// App Store 5.1.1(v): users must be able to delete their account in-app.
serve(async (req) => {
  const user = await requireUser(req);
  const db = admin();
  const { data: files } = await db.storage.from("selfies").list(user.id, { limit: 1000 });
  if (files?.length) await db.storage.from("selfies").remove(files.map((f) => `${user.id}/${f.name}`));
  const { error } = await db.auth.admin.deleteUser(user.id); // cascades profile, check-ins, badges
  if (error) throw error;
  return json({ deleted: true });
});
