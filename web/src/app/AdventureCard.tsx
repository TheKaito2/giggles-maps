import { ArrowRight, Sparkles } from "lucide-react";
import { departLabel, INTERESTS, MODES, type Place, type Prefs, PRICES, ratingLabel } from "./prefs";

/** "Hello, Sakon Nakhon": hills over Nong Han, a palm, and the stupa of Wat Phra That Choeng Chum. */
export function Hero() {
  return (
    <div className="glass hero">
      <div className="hero-text">
        <span className="fine">A little off the beaten path</span>
        <h2 className="hero-title">Hello, Sakon Nakhon.</h2>
      </div>
      <svg viewBox="0 0 340 190" role="img" aria-label="Illustration: hills, a palm tree and the stupa of Wat Phra That Choeng Chum at sunset">
        <circle cx="262" cy="56" r="30" className="sun" />
        <path d="M188 40l7-5 7 5M206 30l6-4 6 4" className="birds" />
        <path d="M0 120 C60 70 120 80 170 105 S280 70 340 95 V190 H0Z" className="hill-far" />
        <path d="M0 150 C70 115 150 125 210 145 S300 125 340 135 V190 H0Z" className="hill-mid" />
        <path d="M0 172 C90 150 200 158 340 165 V190 H0Z" className="hill-near" />
        {/* stupa: stepped base, bell, lotus-bud spire */}
        <g className="stupa">
          <rect x="226" y="150" width="74" height="7" rx="1" />
          <rect x="234" y="140" width="58" height="11" rx="1" />
          <rect x="242" y="118" width="42" height="23" rx="2" />
          <rect x="258" y="124" width="10" height="17" rx="5" className="door" />
          <path d="M240 119 L263 98 L286 119Z" />
          <path d="M252 100 L263 70 L274 100Z" />
          <path d="M260 72 L263 50 L266 72Z" />
        </g>
        <g className="palm">
          <path d="M52 175 C55 150 54 128 50 108" />
          <path d="M50 108 C38 98 24 100 14 110 M50 108 C60 95 76 94 88 102 M50 108 C44 92 32 86 22 88 M50 108 C58 90 70 84 82 86" />
        </g>
      </svg>
    </div>
  );
}

interface SummaryProps {
  prefs: Prefs;
  origin: Place | null;
  dest: Place | null;
  busy: boolean;
  error: string;
  hasPlan: boolean;
  onFind: () => void;
  onReset: () => void;
}

export function Summary({ prefs, origin, dest, busy, error, hasPlan, onFind, onReset }: SummaryProps) {
  const rows: [string, string][] = [
    ["Getting around", MODES.find((m) => m.id === prefs.mode)!.label],
    ["Heading out", departLabel(prefs)],
    ["Minimum rating", prefs.minRating === 0 ? "Any" : `★ ${ratingLabel(prefs.minRating)}`],
    ["Spending", PRICES.find((p) => p.id === prefs.maxPrice)!.name],
    ["Stops", prefs.maxStops == null ? "Auto · best fit" : `Up to ${prefs.maxStops}`],
  ];
  const tags = prefs.interests.length ? INTERESTS.filter((i) => prefs.interests.includes(i.id)).map((i) => i.label) : ["Surprise me"];
  if (prefs.includeUnrated) tags.push("Unrated places too");
  return (
    <div className="glass adventure">
      <div className="row between"><h2>Your little adventure</h2><Sparkles size={20} aria-hidden className="muted" /></div>
      <ol className="route-line">
        <li className="from"><span className="fine">From</span>{origin?.name ?? "Pick a start"}</li>
        <li className="to"><span className="fine">To</span>{dest?.name ?? "Pick a destination"}</li>
      </ol>
      <div className="discovery"><span>Room for discovery</span><span className="num"><b>+{prefs.budget}</b> min</span></div>
      <dl className="facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="row tight">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
      <button type="button" className="btn big find" onClick={onFind} disabled={busy || !origin || !dest}>
        {busy ? "Finding your detour…" : hasPlan ? "Find again" : "Find my detour"} {!busy && <ArrowRight size={18} aria-hidden />}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="link center" onClick={onReset}>Reset preferences</button>
    </div>
  );
}
