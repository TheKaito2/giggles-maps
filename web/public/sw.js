// Offline app shell: pages network-first with a 4 s timeout (then the last copy), hashed build assets cache-first,
// fonts and the province outlines stale-while-revalidate. Saved province maps and their map fonts live in the
// "gm-packs" cache (src/app/mapLayers.ts); caches.match finds them there.
// ponytail: old hashed assets pile up across deploys; prune by the current page's asset list if the cache gets big
const SHELL = "gm-shell-v1";
const page = (u) => (u.pathname.startsWith("/app") ? "/app/" : u.pathname.startsWith("/shop") ? "/shop/" : "/");
const store = (e, req, res) => { if (res.status === 200) { const copy = res.clone(); e.waitUntil(caches.open(SHELL).then((c) => c.put(req, copy))); } return res; };

self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/app/", "/provinces.geojson"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url), same = u.origin === location.origin;
  if (r.mode === "navigate" && same) {
    const slow = new Promise((_, fail) => setTimeout(() => fail(new Error("slow")), 4000));
    e.respondWith(Promise.race([fetch(r).then((res) => store(e, page(u), res)), slow])
      .catch(() => caches.match(page(u)).then((hit) => hit || caches.match("/app/")).then((hit) => hit || fetch(r))));
    return;
  }
  if (same && u.pathname.startsWith("/assets/")) {
    // a missing old chunk can come back as the HTML page: never cache that under a script URL
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) =>
      (res.headers.get("content-type") ?? "").includes("text/html") ? res : store(e, r, res))));
    return;
  }
  if ((same && (u.pathname.startsWith("/fonts/") || u.pathname === "/provinces.geojson")) || u.host === "protomaps.github.io") {
    e.respondWith(caches.match(r).then((hit) => {
      const fresh = fetch(r).then((res) => store(e, r, res));
      if (hit) { e.waitUntil(fresh.catch(() => undefined)); return hit; }
      return fresh;
    }));
  }
});
