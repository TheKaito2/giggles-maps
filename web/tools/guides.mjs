// Province guides for search: one static page per province (public/guides/<slug>/index.html), an index (public/guides/),
// their stylesheet (tokens.css + landing.css + the guide styles below, so they match the landing page) and the sitemap entries.
// The output is committed; `npm run build` copies public/ into dist/ as it is, so the guides cost nothing at runtime.
// Usage (from web/): node tools/guides.mjs   (needs the Supabase CLI logged in and linked: it runs one read-only select)
// ponytail: data comes through `supabase db query --linked`, not REST with the publishable key: anon can't read places.kind,
// places.province_id or place_photos (the Wikimedia photos and their credits), and no public RPC returns them. A public
// read-only RPC would let this run from anywhere; add one if the guides ever need regenerating outside a dev machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf } from "../src/app/kinds.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(WEB, "public/guides");
const SITE = "https://gigglesmap.xyz";
const MAX_ICONS = 12, MAX_LANDMARKS = 8;

// Icons (tier 4) are the places in supabase/data/icon_places.csv: migration 084 sets their tier, but this works before it's live
// id -> Wikipedia sitelinks (how widely known: orders the icons). ponytail: naive CSV split, the file has no quoted commas in id/sitelinks
const icons = new Map(readFileSync(join(WEB, "../supabase/data/icon_places.csv"), "utf8").trim().split("\n").slice(1)
  .map((l) => { const c = l.split(","); return [Number(c[0]), Number(c[c.length - 2])]; }));

const SQL = `select json_build_object(
  'provinces', (select json_agg(json_build_object('id', id, 'en', name_en, 'th', name_th) order by name_en) from public.provinces),
  'places', (select json_agg(row_to_json(t)) from (
    select p.id, p.name, p.name_th, p.kind, p.category, p.province_id, p.rating, p.wikidata,
           round(extensions.st_y(p.location::extensions.geometry)::numeric, 5) lat,
           coalesce(ph.url, cp.url) photo, coalesce(ph.credit, cp.author) credit, coalesce(ph.licence, cp.licence) licence
      from public.places p
      left join lateral (select f.url, f.credit, f.licence from public.place_photos f
                          where f.place_id = p.id and f.source = 'wikimedia' and not f.hidden order by f.id limit 1) ph on true
      -- no stored Wikimedia photo: the first Commons one (migration 088 + supabase/data/commons_photos.sql must be live)
      left join lateral (select c.url, c.author, c.licence from public.place_commons_photos c
                          where c.place_id = p.id order by c.rank limit 1) cp on true
     where p.tier >= 3 and p.province_id is not null and not p.is_demo and p.min_level = 0) t)) as data`;
const raw = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", SQL], { cwd: join(WEB, ".."), encoding: "utf8", maxBuffer: 64 << 20 });
const { provinces, places } = JSON.parse(raw).rows[0].data;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const thName = (p) => p.name_th && p.name_th !== p.name ? p.name_th : null;
// Commons thumbnails come in standard widths; the stored 1280px one is far more than a card needs
const thumb = (url) => url?.startsWith("https://upload.wikimedia.org/") || url?.startsWith("https://thumb.wikimedia.org/")
  ? url.replace(/\/\d+px-/, "/330px-").replace(/\?.*$/, "") : url;
// best first: has a photo, then rating, then a Wikidata entry (a known place), then id for a stable order
const rank = (a, b) => (+!!b.photo - +!!a.photo) || ((b.rating ?? -1) - (a.rating ?? -1)) || (+!!b.wikidata - +!!a.wikidata) || a.id - b.id;

/** The guide's places: Icons, then the top Landmarks, and a route idea of three of them ordered north to south. */
function pick(list) {
  const top = list.filter((p) => icons.has(p.id)).sort((a, b) => icons.get(b.id) - icons.get(a.id) || rank(a, b)).slice(0, MAX_ICONS);
  const marks = list.filter((p) => !icons.has(p.id)).sort(rank).slice(0, MAX_LANDMARKS);
  const route = [...top.slice(0, 2), ...marks].slice(0, 3).sort((a, b) => b.lat - a.lat);
  return { top, marks, route: route.length >= 2 ? route : [] };
}

const head = ({ title, desc, url, image, jsonld }) => `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${url}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Giggles Maps" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:locale:alternate" content="th_TH" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preload" href="/fonts/LINESeedSansTH_A_Rg.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/LINESeedSansTH_A_Bd.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/guides/guides.css" />
    <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>
  </head>
  <body>
    <header class="nav" id="top">
      <div class="wrap nav-row">
        <a class="brand" href="/"><img src="/logo.svg" alt="" width="40" height="40" />giggles <span>maps</span></a>
        <nav aria-label="Main">
          <a class="nav-link" href="/guides/">Province guides</a>
          <a class="btn small" href="/app/">Open the app</a>
        </nav>
      </div>
    </header>
`;
const foot = `
    <footer class="foot wrap fine">
      <span>Giggles Maps · <a href="/guides/">Province guides</a> · <a href="/privacy.html">Privacy</a></span>
      <span>Places © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. Photos from Wikimedia Commons, credited on each.</span>
    </footer>
  </body>
</html>
`;

const card = (p, icon) => {
  const k = kindOf(p.kind, p.category), th = thName(p);
  return `<li class="g-card">
          <a href="/app/?place=${p.id}">
            ${p.photo ? `<img src="${esc(thumb(p.photo))}" alt="${esc(p.name)}" width="330" height="220" loading="lazy" decoding="async" />` : ""}
            <span class="g-body">
              <span class="chip${icon ? " icon" : ""}">${icon ? "Icon" : "Landmark"}</span>
              <b>${esc(p.name)}</b>
              ${th ? `<span class="g-th" lang="th">${esc(th)}</span>` : ""}
              <span class="fine">${esc(k.en)} · <span lang="th">${esc(k.th)}</span></span>
            </span>
          </a>
          ${p.photo ? `<span class="g-credit">${esc([...new Set([p.credit, p.licence, "Wikimedia Commons"].filter(Boolean))].join(" · "))}</span>` : ""}
        </li>`;
};
const section = (id, en, th, list, icon) => list.length ? `
      <section class="g-sec wrap" aria-labelledby="${id}">
        <h2 id="${id}">${en}<span class="g-sub" lang="th">${th}</span></h2>
        <ul class="g-grid">
        ${list.map((p) => card(p, icon)).join("\n        ")}
        </ul>
      </section>` : "";

function guidePage(pr, list) {
  const { top, marks, route } = pick(list), url = `${SITE}/guides/${slug(pr.en)}/`, n = top.length + marks.length;
  const title = `Things to see in ${pr.en} — Giggles Maps`;
  const desc = n ? `${n} places to see in ${pr.en}, Thailand: ${[...top, ...marks].slice(0, 3).map((p) => p.name).join(", ")} and more. Plan a trip with stops that fit your time.`
    : `Places to see in ${pr.en}, Thailand. Plan a trip with stops that fit your time on Giggles Maps.`;
  const image = thumb([...top, ...marks].find((p) => p.photo)?.photo) ?? `${SITE}/og.png`;
  const all = [...top, ...marks];
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "TouristDestination", "name": pr.en, "alternateName": pr.th, "url": url, "description": desc,
      "containedInPlace": { "@type": "Country", "name": "Thailand" },
      "includesAttraction": all.map((p) => ({ "@type": "TouristAttraction", "name": p.name, "url": `${SITE}/app/?place=${p.id}` })) },
    { "@type": "ItemList", "name": `Things to see in ${pr.en}`, "numberOfItems": all.length,
      "itemListElement": all.map((p, i) => ({ "@type": "ListItem", "position": i + 1, "name": p.name, "url": `${SITE}/app/?place=${p.id}` })) },
  ] };
  return head({ title, desc, url, image, jsonld }) + `
    <main class="guide">
      <section class="g-hero wrap">
        <p class="fine"><a href="/guides/">Province guides</a> · <span lang="th">คู่มือรายจังหวัด</span></p>
        <h1>Things to see in ${esc(pr.en)}<span class="g-sub" lang="th">ที่เที่ยวใน${esc(pr.th)}</span></h1>
        <p class="lede">${n ? `${n} well-known places in ${esc(pr.en)} from the Giggles Maps map: the icons first, then the landmarks. Tap one to see it on the map.`
          : `Giggles Maps covers ${esc(pr.en)} on its map. Open the app to find places along your way.`}</p>
        <p class="lede g-th" lang="th">${n ? `${n} สถานที่เด่นใน${esc(pr.th)} จากแผนที่ Giggles Maps เรียงจากแลนด์มาร์กระดับไอคอนก่อน แตะเพื่อดูบนแผนที่`
          : `Giggles Maps มีแผนที่ของ${esc(pr.th)} เปิดแอปเพื่อหาที่แวะระหว่างทาง`}</p>
        <div class="cta"><a class="btn gold big" href="/app/">Plan a trip here</a><span class="fine" lang="th">วางแผนทริปที่นี่</span></div>
      </section>
${section("icons", "Icons", "แลนด์มาร์กระดับไอคอน", top, true)}
${section("landmarks", "Top landmarks", "แลนด์มาร์กเด่น", marks, false)}
${route.length ? `
      <section class="g-sec wrap" aria-labelledby="route">
        <h2 id="route">A route idea<span class="g-sub" lang="th">ไอเดียเส้นทาง</span></h2>
        <ol class="g-route">
          ${route.map((p) => `<li><a href="/app/?place=${p.id}">${esc(p.name)}</a></li>`).join("\n          ")}
        </ol>
        <p class="fine">An idea, not a schedule: these stops are simply ordered north to south. Giggles Maps plans the real route, the times and the stops that fit your extra time.</p>
        <p class="fine" lang="th">เป็นแค่ไอเดีย ไม่ใช่ตารางเวลา: เรียงจุดแวะจากเหนือลงใต้เท่านั้น Giggles Maps จะวางเส้นทางจริง เวลา และจุดแวะที่พอดีกับเวลาที่คุณมี</p>
        <a class="btn" href="/app/">Plan a trip here</a>
      </section>` : ""}
    </main>
` + foot;
}

function indexPage(rows) {
  const url = `${SITE}/guides/`, title = "Province guides: things to see in Thailand — Giggles Maps";
  const desc = `Things to see in all ${rows.length} provinces of Thailand: icons, landmarks and a route idea for each, from Giggles Maps.`;
  const jsonld = { "@context": "https://schema.org", "@type": "ItemList", "name": "Giggles Maps province guides", "numberOfItems": rows.length,
    "itemListElement": rows.map(({ pr }, i) => ({ "@type": "ListItem", "position": i + 1, "name": `Things to see in ${pr.en}`, "url": `${SITE}/guides/${slug(pr.en)}/` })) };
  return head({ title, desc, url, image: `${SITE}/og.png`, jsonld }) + `
    <main class="guide">
      <section class="g-hero wrap">
        <h1>Province guides<span class="g-sub" lang="th">คู่มือเที่ยวรายจังหวัด</span></h1>
        <p class="lede">Icons, landmarks and a route idea for every province of Thailand.</p>
        <p class="lede g-th" lang="th">แลนด์มาร์กและไอเดียเส้นทางของทุกจังหวัดในประเทศไทย</p>
      </section>
      <section class="g-sec wrap" aria-label="Provinces">
        <ul class="g-index">
          ${rows.map(({ pr, n }) => `<li><a href="/guides/${slug(pr.en)}/"><b>${esc(pr.en)}</b><span lang="th">${esc(pr.th)}</span><span class="fine num">${n} places</span></a></li>`).join("\n          ")}
        </ul>
      </section>
    </main>
` + foot;
}

const CSS = `
/* province guides (tools/guides.mjs) */
.guide { gap: clamp(40px, 6vw, 64px); }
.g-hero { display: grid; gap: 12px; padding-top: 16px; }
.g-hero h1 { font: 700 var(--fs-land-h2)/1.2 var(--font-display); }
.g-hero .lede { max-width: 46ch; color: var(--ink); }
.g-hero .lede.g-th { color: var(--ink-2); font-size: var(--fs-body); }
.g-hero .cta { margin-top: 8px; }
.g-sub { display: block; font: 700 var(--fs-headline)/1.4 var(--font-body); color: var(--ink-2); margin-top: 2px; }
main.guide h2 { text-align: left; font-size: var(--fs-land-h3); }
.g-sec { display: grid; gap: 18px; }
.g-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
.g-card { background: var(--card); border-radius: 20px; box-shadow: var(--shadow); overflow: hidden; display: grid; align-content: start; }
.g-card a { color: inherit; text-decoration: none; display: grid; }
.g-card img { display: block; width: 100%; aspect-ratio: 3 / 2; height: auto; object-fit: cover; background: var(--brand-soft); }
.g-body { display: grid; gap: 4px; padding: 14px 16px 16px; justify-items: start; }
.g-body b { font: 700 var(--fs-headline)/var(--lh-headline) var(--font-body); }
.g-th { color: var(--ink-2); }
.chip.icon { background: var(--marigold); color: #241a00; }
.g-credit { font-size: var(--fs-micro); line-height: var(--lh-micro); color: var(--ink-2); padding: 0 16px 12px; overflow-wrap: anywhere; }
.g-route { margin: 0; padding: 18px 20px; background: var(--card); border-radius: 20px; box-shadow: var(--shadow); list-style: none;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-weight: 700; }
.g-route li { display: inline-flex; align-items: center; gap: 10px; }
.g-route li + li::before { content: "→"; color: var(--ink-2); }
.g-route a { text-decoration: none; }
.g-sec > .btn { justify-self: start; }
.g-index { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.g-index a { display: grid; gap: 2px; padding: 14px 16px; background: var(--card); border-radius: 16px; box-shadow: var(--shadow); color: var(--ink); text-decoration: none; }
.g-index a:hover b { color: var(--brand); }
.g-index span { color: var(--ink-2); }
@media (max-width: 420px) { .nav .nav-link { display: none; } .g-grid { grid-template-columns: 1fr; } }
`;

{
  const byProvince = new Map(provinces.map((p) => [p.id, []]));
  for (const p of places) byProvince.get(p.province_id)?.push(p);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const styles = (f) => readFileSync(join(WEB, "src/styles", f), "utf8").replace(/^@import .*$/m, "");
  writeFileSync(join(OUT, "guides.css"), `/* generated by tools/guides.mjs from src/styles/tokens.css + landing.css: edit those (or the generator), then re-run it */\n${styles("tokens.css")}\n${styles("landing.css")}\n${CSS}`);
  const rows = [];
  for (const pr of provinces) {
    const list = byProvince.get(pr.id), { top, marks } = pick(list);
    mkdirSync(join(OUT, slug(pr.en)), { recursive: true });
    writeFileSync(join(OUT, slug(pr.en), "index.html"), guidePage(pr, list));
    rows.push({ pr, n: top.length + marks.length });
  }
  writeFileSync(join(OUT, "index.html"), indexPage(rows));
  // sitemap: everything else kept as it is, the guide lines replaced
  const map = join(WEB, "public/sitemap.xml");
  const urls = [`${SITE}/guides/`, ...provinces.map((p) => `${SITE}/guides/${slug(p.en)}/`)].map((u) => `  <url><loc>${u}</loc></url>`);
  const kept = readFileSync(map, "utf8").split("\n").filter((l) => !l.includes("/guides/") && !l.includes("</urlset>") && l.trim());
  writeFileSync(map, [...kept, ...urls, "</urlset>", ""].join("\n"));
  console.log(`${provinces.length} province guides + index in public/guides/, ${places.length} places read, ${urls.length} sitemap URLs`);
}
