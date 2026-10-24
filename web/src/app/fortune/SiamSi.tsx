import { useEffect, useState } from "react";
import { ShoppingBag, Sparkles } from "lucide-react";
import { getShop, type PastShake, type Profile, shakeHistory } from "../../lib/api";
import Fortune, { OddsTable, prizeText, RARITY } from "./Fortune";
import { SkelRows } from "../Skeleton";
import Info from "../Info";

/** Profile card: bonus shakes waiting, a running XP boost, and the odds and your last 20 shakes. */
export default function SiamSi({ profile, onChange, onShop }: { profile: Profile | null; onChange: () => void; onShop?: () => void }) {
  const [open, setOpen] = useState<string | true | false>(false);   // true = a bonus shake; a check-in id = that check-in's shake
  const [more, setMore] = useState(false);
  const [history, setHistory] = useState<PastShake[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());   // "kind:id" → item name, for the prizes in the history
  useEffect(() => {
    if (!more) return;
    shakeHistory().then(setHistory).catch(() => setHistory([]));
    getShop().then((items) => setNames(new Map(items.map((i) => [`${i.kind}:${i.id}`, i.name_en])))).catch(() => undefined);
  }, [more, open]);
  const pending = profile?.pendingShakes ?? [];   // check-ins whose shake you closed without taking
  const tickets = (profile?.fortuneTickets ?? 0) + pending.length;
  const boost = profile?.xpBoostUntil && profile.xpBoostUntil > new Date() ? profile.xpBoostUntil : null;
  return (
    <section className="siam-si glass" aria-labelledby="siamsi-title">
      <div className="row between">
        <h3 id="siamsi-title"><Sparkles size={18} aria-hidden /> Siam Si <span className="fine" lang="th">เซียมซี</span>
          <Info label="About Siam Si">Every new place you check in at gives a shake. Quests, new provinces, riding along and writing a review give
            bonus shakes (keep up to 5).</Info></h3>
        <button type="button" className="btn gold small" disabled={!tickets} onClick={() => setOpen(pending[0]?.checkin ?? true)}>
          {tickets ? `Shake · ${tickets}` : "No shakes"}</button>
      </div>
      {pending.length > 0 && <p className="fine">Waiting from your check-in at <b>{pending[0].place}</b>: shake it within a day.</p>}
      {boost && <p className="chip boost">XP ×1.5 until {boost.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>}
      <div className="row">
        <button type="button" className="link" aria-expanded={more} onClick={() => setMore(!more)}>Odds and history</button>
        {onShop && <button type="button" className="link" onClick={onShop}><ShoppingBag size={14} aria-hidden /> Wear your prizes</button>}
      </div>
      {more && <>
        <OddsTable luck={profile?.perks.luck ?? 0} />
        {history === null ? <SkelRows n={3} avatar={0} /> : history.length === 0 ? <p className="fine">No shakes yet.</p> : (
          <ul className="shake-history">
            {history.map((h) => <li key={h.id} className={`r-${h.rarity}`}>
              <span className="num">No. {h.stick}</span><b>{RARITY[h.rarity].en}</b>
              <span className="fine">{prizeText({ prize: h.prize_kind, coins: h.coins, xp: h.xp, boost_hours: h.boost_hours, item_kind: h.item_kind, item_en: names.get(`${h.item_kind}:${h.item_id}`) ?? h.item_id })}</span>
            </li>)}
          </ul>
        )}
      </>}
      {open && <Fortune checkin={typeof open === "string" ? open : undefined} onClose={() => { setOpen(false); onChange(); }} onShaken={() => undefined} name={profile?.nickname ?? undefined} hasPlus={!!profile?.plusUntil} luck={profile?.perks.luck ?? 0} />}
    </section>
  );
}
