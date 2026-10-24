import { useEffect, useState } from "react";
import { ShoppingBag, Sparkles } from "lucide-react";
import { type PastShake, type Profile, shakeHistory } from "../../lib/api";
import Fortune, { OddsTable, prizeText, RARITY } from "./Fortune";

/** Profile card: bonus shakes waiting, a running XP boost, and the odds and your last 20 shakes. */
export default function SiamSi({ profile, onChange, onShop }: { profile: Profile | null; onChange: () => void; onShop?: () => void }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [history, setHistory] = useState<PastShake[] | null>(null);
  useEffect(() => { if (more) shakeHistory().then(setHistory).catch(() => setHistory([])); }, [more, open]);
  const tickets = profile?.fortuneTickets ?? 0;
  const boost = profile?.xpBoostUntil && profile.xpBoostUntil > new Date() ? profile.xpBoostUntil : null;
  return (
    <section className="siam-si glass" aria-labelledby="siamsi-title">
      <div className="row between">
        <h3 id="siamsi-title"><Sparkles size={18} aria-hidden /> Siam Si <span className="fine" lang="th">เซียมซี</span></h3>
        <button type="button" className="btn gold small" disabled={!tickets} onClick={() => setOpen(true)}>
          {tickets ? `Shake · ${tickets}` : "No shakes"}</button>
      </div>
      <p className="fine">Every new place you check in at gives a shake. Quests, new provinces and riding along give bonus shakes (keep up to 5).</p>
      {boost && <p className="chip boost">XP ×1.5 until {boost.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>}
      <div className="row">
        <button type="button" className="link" aria-expanded={more} onClick={() => setMore(!more)}>Odds and history</button>
        {onShop && <button type="button" className="link" onClick={onShop}><ShoppingBag size={14} aria-hidden /> Wear your prizes</button>}
      </div>
      {more && <>
        <OddsTable />
        {history === null ? <p className="fine">Loading…</p> : history.length === 0 ? <p className="fine">No shakes yet.</p> : (
          <ul className="shake-history">
            {history.map((h) => <li key={h.id} className={`r-${h.rarity}`}>
              <span className="num">No. {h.stick}</span><b>{RARITY[h.rarity].en}</b>
              <span className="fine">{prizeText({ prize: h.prize_kind, coins: h.coins, xp: h.xp, boost_hours: h.boost_hours, item_kind: h.item_kind as never, item_en: h.item_id })}</span>
            </li>)}
          </ul>
        )}
      </>}
      {open && <Fortune onClose={() => { setOpen(false); onChange(); }} onShaken={() => undefined} name={profile?.nickname ?? undefined} hasPlus={!!profile?.plusUntil} />}
    </section>
  );
}
