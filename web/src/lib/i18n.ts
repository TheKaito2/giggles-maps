// Thai for the whole app without touching every screen: the English UI strings (collected from the source by
// tools/i18n-extract.cjs, translated in src/i18n/th.json) are swapped for Thai as React puts them on the page. A
// MutationObserver catches every text node and the readable attributes (aria-label, placeholder, title, alt) as they
// appear or change; React doesn't mind, it only ever writes the English again, which is swapped straight back before
// the frame paints. Dynamic text uses patterns: "{0} stops" -> "{0} จุดแวะ". People's words (reviews, names) are
// never in the dictionary, so they stay as written; mark anything else to leave alone with translate="no".
// ponytail: exact-string matching. A new English string shows in English until tools/i18n-extract.cjs is re-run and
// the new lines translated; switch to t() calls if strings ever need context-dependent translations.

export type Lang = "en" | "th";
const KEY = "gm-lang";

/** The chosen language, else the phone's: Thai phones get Thai. */
export function lang(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === "en" || v === "th") return v; } catch { /* not kept */ }
  return navigator.language?.toLowerCase().startsWith("th") ? "th" : "en";
}
/** Switching reloads the app (trips and directions are kept across reloads). */
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* this visit only */ }
  location.reload();
}

const dict = new Map<string, string>();
const patterns: { re: RegExp; th: string }[] = [];
const ATTRS = ["aria-label", "placeholder", "title", "alt"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "NOSCRIPT"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The Thai for one piece of English UI text, or null to leave it as it is. */
export function translate(text: string): string | null {
  const key = norm(text);
  if (!key || !/[A-Za-z]/.test(key)) return null;
  let th = dict.get(key) ?? null;
  if (th == null) {
    for (const p of patterns) {
      const m = p.re.exec(key);
      // a value goes in as it is, or its whole-string Thai (never pattern-translated: "Temple Runner" stays one name)
      if (m) { th = p.th.replace(/\{(\d)\}/g, (_, i: string) => { const v = m[Number(i) + 1] ?? ""; return dict.get(norm(v)) ?? v; }); break; }
    }
  }
  if (th == null || th === key) return null;
  // keep the spacing around it: JSX splits sentences around values ("3" + " stops")
  return (/^\s/.test(text) ? " " : "") + th + (/\s$/.test(text) ? " " : "");
}

const skipped = (el: Element | null) => !!el?.closest('[translate="no"], .notranslate, [contenteditable="true"]') || (!!el && SKIP.has(el.tagName));

function textNode(n: Text) {
  if (skipped(n.parentElement)) return;
  const th = translate(n.nodeValue ?? "");
  if (th != null && th !== n.nodeValue) n.nodeValue = th;
}
function attrs(el: Element) {
  if (skipped(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) { const th = translate(v); if (th != null && th !== v) el.setAttribute(a, th.trim()); }
  }
}
function subtree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { textNode(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  attrs(root as Element);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) textNode(n as Text); else attrs(n as Element);
  }
}

// Data with both languages (quests' title_en/title_th, shop items' name_en/name_th, places' name/name_th, …) teaches the
// dictionary as it arrives: every API response is read for such pairs, so names from the database show in Thai too.
// The built-in dictionary wins (a place called "Market" never renames the Market label), and short names are skipped.
const PAIRS: [string, string][] = [["name_en", "name_th"], ["title_en", "title_th"], ["item_en", "item_th"], ["blurb_en", "blurb_th"],
  ["en", "th"], ["name", "name_th"], ["title", "title_th"]];
let rescan = 0;
function learn(v: unknown, depth = 0) {
  if (!v || typeof v !== "object" || depth > 8) return;
  if (Array.isArray(v)) { v.forEach((x) => learn(x, depth + 1)); return; }
  const o = v as Record<string, unknown>;
  for (const [en, th] of PAIRS) {
    const e = o[en], t = o[th];
    if (typeof e === "string" && typeof t === "string" && t && e.length >= 3 && /[A-Za-z]/.test(e) && !dict.has(norm(e))) {
      dict.set(norm(e), t);
      clearTimeout(rescan); rescan = window.setTimeout(() => subtree(document.body), 30);   // already on screen: swap it now
    }
  }
  for (const x of Object.values(o)) if (x && typeof x === "object") learn(x, depth + 1);
}

/** Once at start, before the first render: Thai mode loads the dictionary and starts translating. */
export async function installI18n() {
  if (lang() !== "th") return;
  document.documentElement.lang = "th";
  const { default: th } = await import("../i18n/th.json");
  for (const [en, t] of Object.entries(th as Record<string, string>)) {
    if (!/\{\d\}/.test(en)) dict.set(norm(en), t);
    else patterns.push({ re: new RegExp("^" + escape(norm(en)).replace(/\\\{(\d)\\\}/g, "(.*?)") + "$"), th: t });
  }
  // the most specific pattern first: "{0} stops left" before "{0} stops"
  patterns.sort((a, b) => b.re.source.replaceAll("(.*?)", "").length - a.re.source.replaceAll("(.*?)", "").length);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") textNode(m.target as Text);
      else if (m.type === "attributes") attrs(m.target as Element);
      else m.addedNodes.forEach(subtree);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  subtree(document.body);
  document.title = translate(document.title)?.trim() ?? document.title;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await realFetch(...args);
    if ((res.headers.get("content-type") ?? "").includes("json")) res.clone().json().then((j) => learn(j)).catch(() => undefined);
    return res;
  };
}

/** A place's name in the reader's language: Thai mode shows the Thai name when there is one. */
export const nameOf = (p: { name: string; name_th?: string | null }) => (lang() === "th" && p.name_th ? p.name_th : p.name);
