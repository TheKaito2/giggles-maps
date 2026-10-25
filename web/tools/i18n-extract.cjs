// Collects the English UI strings in src/ for the Thai dictionary (src/i18n/th.json): JSX text, UI attributes
// (aria-label, placeholder, title, alt), labels and messages in code, and template strings as patterns ("{0} stops").
// Usage: node tools/i18n-extract.cjs > /tmp/strings.json   (then translate the ones th.json lacks)
const ts = require("typescript"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "../src");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\.|\.d\.ts$/.test(f) && !p.includes("/i18n/")) files.push(p); } })(ROOT);

const SKIP_ATTRS = new Set(["className", "key", "id", "href", "src", "type", "role", "rel", "target", "name", "value", "htmlFor", "lang",
  "inputMode", "autoComplete", "aria-hidden", "aria-live", "aria-haspopup", "aria-current", "accept", "capture", "method", "d", "fill",
  "stroke", "viewBox", "xmlns", "strokeLinecap", "strokeLinejoin", "fillRule", "clipRule", "transform", "loading", "decoding", "dir",
  "aria-controls", "aria-labelledby", "aria-describedby", "form", "pattern", "step", "min", "max", "align", "data-testid", "tone", "backdrop"]);
const SKIP_PROPS = new Set(["id", "kind", "category", "className", "cls", "key", "icon", "colour", "color", "href", "url", "path", "type", "code",
  "theme", "value", "group", "bg", "skin", "face", "eyes", "brows", "mouth", "hair", "hair_colour", "outfit", "outfit_colour", "headwear",
  "glasses", "look", "map", "flair", "frame", "tier", "mode", "depart", "time", "event", "source", "status", "gate", "provider", "redirectTo",
  "channel", "schema", "table", "filter", "column", "order", "select", "font", "lang", "style", "variant", "rarity", "slot", "who", "home",
  "iso", "name_th", "nickname", "avatar", "joined", "province", "place", "placeTh", "photo", "credit", "licence", "at", "tag", "storage"]);
const SKIP_CALLS = /^(supabase|db|localStorage|sessionStorage|document|window|history|console|navigator|Object|JSON|URLSearchParams|addEventListener|removeEventListener|dispatchEvent|matchMedia|setTimeout|require|rpc|callFn|from|select|eq|order|in|is|neq|gte|lte|limit|single|maybeSingle|querySelector|querySelectorAll|closest|classList|getItem|setItem|removeItem|toggle|contains|getAttribute|setAttribute|includes|startsWith|endsWith|split|replace|match|test|padStart|toLocaleString|toLocaleDateString|toLocaleTimeString|Intl|getPublicUrl|upload|remove|invoke|registerPlugin|errCode|kindOf|setLook|setTab|setSheet|setPage|setOverlay|setKind|setGate|set|get|has|on|once|off|setPaintProperty|setLayoutProperty|getSource|getLayer|addLayer|addSource|setStyle|setFilter|setData|fetch|play|planPreset|track|log|warn|error|new Event|Event|CustomEvent)$/;
const hasWords = (s) => /[A-Za-z]{2,}/.test(s);
const looksUi = (s) => {
  const t = s.trim();
  if (!hasWords(t) || t.length < 2 || t.length > 400) return false;
  if (/^(https?:|mailto:|tel:|\/|\.|#|@|data:|[a-z]+:\/\/)/.test(t)) return false;
  if (/^[a-z0-9_.:\/#-]+$/.test(t)) return false;                       // identifiers, keys, paths, class names
  if (/^[a-z0-9 _.\-:]+$/.test(t) && !/ [a-z]+ /.test(" " + t + " ")) return false;
  if (/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/.test(t) && t.split(" ").every((w) => w.includes("-") || w.length < 3)) return false;
  if (/[{};=<>]|=>|\$\{/.test(t)) return false;                          // code
  if (/^[A-Z][a-z]+[A-Z]/.test(t) && !t.includes(" ")) return false;       // CamelCase identifiers
  return /^[A-Z0-9"'“(¥฿+\-–·•✓★]/.test(t) || /\s/.test(t) || /[.?!:…]$/.test(t);
};
const exact = new Map(), templates = new Map();
const add = (m, s, f) => { const k = s.replace(/\s+/g, " ").trim(); if (!m.has(k)) m.set(k, path.relative(ROOT, f)); };

for (const f of files) {
  const src = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const skipped = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
      if (ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText())) return true;
      if (ts.isPropertyAssignment(p) && p.name && SKIP_PROPS.has(p.name.getText().replace(/["']/g, ""))) return true;
      if (ts.isPropertyAssignment(p) && p.name === node) return true;
      if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
      if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(p.operatorToken.kind)) return true;
      if (ts.isCaseClause(p) && p.expression === node) return true;
      if (ts.isCallExpression(p)) {
        const callee = p.expression.getText().split(".").pop().replace(/\?$/, "");
        if (SKIP_CALLS.test(callee)) return true;
      }
      if (ts.isJsxAttribute(p) || ts.isJsxExpression(p) || ts.isFunctionLike(p) || ts.isBlock(p)) break;
    }
    return false;
  };
  (function visit(node) {
    if (ts.isJsxText(node)) { const t = node.getText(); if (hasWords(t) && t.trim()) add(exact, t, f); }
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && looksUi(node.text) && !skipped(node)) add(exact, node.text, f);
    else if (ts.isTemplateExpression(node) && !skipped(node)) {
      let pat = node.head.text; node.templateSpans.forEach((sp, i) => { pat += `{${i}}` + sp.literal.text; });
      if (looksUi(pat.replace(/\{\d\}/g, " x ")) && hasWords(pat.replace(/\{\d\}/g, ""))) add(templates, pat, f);
    }
    ts.forEachChild(node, visit);
  })(src);
}
process.stdout.write(JSON.stringify({ exact: [...exact.entries()].map(([s, f]) => ({ s, f })), templates: [...templates.entries()].map(([s, f]) => ({ s, f })) }, null, 1));
