import { useEffect, useState } from "react";
import { Check, Clover, Coins, Gift, X } from "lucide-react";
import { chooseLevelPerk, equip, getShop, KIND_NAME, type Perk, pendingLevels, type Profile, type ShopItem } from "../lib/api";
import { errCode } from "../lib/supabase";
import { buzz } from "../lib/native";
import { useDialog } from "../lib/useDialog";
import { Preview } from "./passport/Shop";

const PERKS: { id: Perk; Icon: typeof Clover; title: string; blurb: string }[] = [
  { id: "luck", Icon: Clover, title: "+10% luck", blurb: "Siam Si: every stick above Common comes up 10% more often." },
  { id: "coins", Icon: Coins, title: "+10% coins", blurb: "Every coin you earn from now on: stamps, quests, Siam Si and photos." },
];

/** Level-up rewards: for each level reached, pick one permanent perk; the level's cosmetic is already yours. Lowest level first. */
export default function LevelRewards({ profile, onChange, onClose }: { profile: Profile; onChange: () => void; onClose: () => void }) {
  const box = useDialog(onClose);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [pick, setPick] = useState<Perk | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [worn, setWorn] = useState(false);
  useEffect(() => { getShop().then((l) => setItems(l.filter((i) => i.level_req != null))).catch(() => undefined); }, []);

  const pending = pendingLevels(profile);
  const level = pending[0];
  const item = items.find((i) => i.level_req === level);
  const total = (p: Perk) => profile.perks[p] * 10;

  const choose = async () => {
    if (!pick || !level) return;
    setBusy(true); setMsg("");
    try {
      await chooseLevelPerk(level, pick);
      buzz("done");
      setMsg(`Level ${level}: ${pick === "luck" ? "luck" : "coins"} +${total(pick) + 10}% in total now.`);
      setPick(null); setWorn(false);
      onChange();
    } catch (e) {
      setMsg(errCode(e) === "already_chosen" ? "You picked this level's reward already." : "Couldn't save your pick. Try again.");
      onChange();
    } finally { setBusy(false); }
  };
  const wear = (i: ShopItem) => equip(i.kind, i.id).then(() => { setWorn(true); onChange(); }).catch(() => setMsg("Couldn't put it on. Try again."));

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="lvl-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal level-rewards" ref={box} tabIndex={-1}>
        <header className="modal-head">
          <span><span className="eyebrow">{level ? `Level ${level} reward${pending.length > 1 ? ` · ${pending.length} waiting` : ""}` : "Level rewards"}</span>
            <h2 id="lvl-title">{level ? "Pick a perk. It's yours for good." : "All picked"}</h2></span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        {msg && <p className="notice-line" role="status">{msg}</p>}
        {level ? <>
          <div className="perk-picks" role="radiogroup" aria-label="Perk">
            {PERKS.map(({ id, Icon, title, blurb }) => (
              <button key={id} type="button" role="radio" aria-checked={pick === id} className={`perk-pick p-${id}${pick === id ? " on" : ""}`} onClick={() => setPick(id)}>
                <span className="perk-icon" aria-hidden><Icon size={26} /></span>
                <b>{title}</b>
                <span className="fine">{blurb}</span>
                <span className="perk-total num">{total(id)}% → {total(id) + 10}%</span>
              </button>
            ))}
          </div>
          {item && <div className="level-unlock">
            <Preview item={item} profile={profile} />
            <span className="grow unlock-text"><span className="eyebrow"><Gift size={12} aria-hidden /> Unlocked</span>
              <b>{item.name_en}</b><span className="fine">{KIND_NAME[item.kind]}</span></span>
            {worn || profile.look[item.kind] === item.id ? <span className="chip on"><Check size={13} aria-hidden /> On</span>
              : <button type="button" className="btn soft small" onClick={() => wear(item)}>Wear it</button>}
          </div>}
          <button type="button" className="btn big" disabled={!pick || busy} onClick={choose}>
            {pick ? `Take ${PERKS.find((p) => p.id === pick)!.title}` : "Pick one"}</button>
        </> : <>
          <p>Luck <b className="num">+{total("luck")}%</b> · Coins <b className="num">+{total("coins")}%</b>. Every new level brings another pick.</p>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </>}
      </div>
    </div>
  );
}
