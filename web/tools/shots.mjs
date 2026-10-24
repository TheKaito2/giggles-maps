// Landing-page screenshots of the web app, no dependencies: headless Chrome over the DevTools protocol.
// Needs the dev server: cd web && npm run dev -- --port 5181
// Usage: node tools/shots.mjs [only...]   e.g. node tools/shots.mjs choose quests
// GM_SESSION=path/to/storage.json adds localStorage entries ({ "sb-…-auth-token": "…" }) so shots show a real account.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.GM_BASE ?? "http://localhost:5181";
const OUT = new URL("../public/landing/", import.meta.url);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storage = {
  "gm-demo": "true", "gm-demo-bar-hidden": "1", "gm-demo-at": JSON.stringify({ lat: 13.7563, lng: 100.5018 }),
  ...(process.env.GM_SESSION ? JSON.parse(readFileSync(process.env.GM_SESSION, "utf8")) : {}),
};

const profile = mkdtempSync(join(tmpdir(), "gm-shots-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome still starting */ }
    await sleep(200);
  }
  throw new Error("Chrome did not open a debugging port");
}

const ws = new WebSocket(await target());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  m.error ? w.j(new Error(m.error.message)) : w.r(m.result);
};
const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; waiting.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (fn, ...args) => {
  const res = await send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value;
};
/** wait until fn(...args) in the page returns something truthy */
async function until(what, fn, ...args) {
  for (let i = 0; i < 100; i++) { const v = await run(fn, ...args).catch(() => null); if (v) return v; await sleep(200); }
  throw new Error(`timed out waiting for ${what}`);
}
const clickText = (sel, text) => until(`${sel} "${text}"`, (sel, text) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) || e.getAttribute("aria-label") === text);
  if (el) el.click();
  return !!el;
}, sel, text);
const tab = (label) => clickText("nav button, .tabs button, button", label);
// the "pick a name" sheet covers other tabs for a fresh account
const skipName = () => run(() => { const b = [...document.querySelectorAll("button")].find((e) => /later|skip/i.test(e.textContent)); b?.click(); return true; });

async function shoot(name) {
  // ads are for free accounts only; the landing shows the app as members see it
  await run(() => { document.querySelectorAll(".ad-banner").forEach((e) => e.remove()); return true; });
  await sleep(900);   // let sheets and counters settle
  const { data } = await send("Page.captureScreenshot", { format: "webp", quality: 82 });
  writeFileSync(new URL(`${name}.webp`, OUT), Buffer.from(data, "base64"));
  console.log("saved", `public/landing/${name}.webp`);
}

const SHOTS = {
  async choose() {
    const input = await until("Where to? field", () => !!document.querySelector('input[aria-label="Where to?"]'));
    if (!input) return;
    await run(() => document.querySelector('input[aria-label="Where to?"]').focus());
    await send("Input.insertText", { text: "Chatuchak Market" });
    await until("a place suggestion", () => !!document.querySelector(".place-results button, .place-results li[role=option]"));
    await run(() => (document.querySelector(".place-results button, .place-results li[role=option]")).click());
    await until("planned presets", () => document.querySelectorAll(".preset .thumbs, .preset .preset-stats, .preset .fine").length >= 3);
    await sleep(1500);
    await shoot("choose");
  },
  async map() { await until("Where to? field", () => !!document.querySelector('input[aria-label="Where to?"]')); await sleep(2500); await shoot("map"); },
  async profile() { await tab("Profile"); await skipName(); await until("profile", () => !!document.querySelector(".profile h1")); await run(() => scrollTo(0, 0)); await shoot("profile"); },
  async siamsi() {
    // the cup screen; a fresh account has no shakes, so the shot calls the open button's React handler directly (the cup itself isn't tapped)
    await tab("Profile"); await skipName(); await until("Siam Si", () => !!document.querySelector("#siamsi .btn.gold"));
    await run(() => { const b = document.querySelector("#siamsi .btn.gold");
      b[Object.keys(b).find((k) => k.startsWith("__reactProps"))].onClick(); return true; });
    await until("fortune cup", () => !!document.querySelector(".fortune-stage"));
    await shoot("siamsi");
  },
  async quests() { await tab("Quests"); await skipName(); await until("quests", () => !!document.querySelector(".quests-hero")); await shoot("quests"); },
  async board() { await tab("Leaderboard"); await skipName(); await until("leaderboard", () => !!document.querySelector(".board-hero")); await shoot("board"); },
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  // storage is per origin: open the origin once, seed it, then start the app fresh for each shot
  await send("Page.navigate", { url: `${BASE}/favicon.svg` });
  await sleep(500);
  await run((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); return true; }, storage);
  const only = process.argv.slice(2);
  for (const [name, take] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    await send("Page.navigate", { url: `${BASE}/app/` });
    await until("app shell", () => !!document.querySelector(".app-shell"));
    await sleep(2500);   // map tiles and the profile load
    await take().catch((e) => console.error(`${name}: ${e.message}`));
  }
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
