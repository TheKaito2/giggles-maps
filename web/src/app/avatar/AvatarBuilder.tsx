import { useEffect, useState } from "react";
import Modal from "../Modal";
import { Coins, Dices, Lock, X } from "lucide-react";
import { errCode } from "../../lib/supabase";
import { buyItem, getShop, type Profile, setAvatar } from "../../lib/api";
import { type AvatarLook, AvatarSvg, DEFAULT_LOOK, randomLook, type Slot, SLOTS } from "./parts";
import { Spinner } from "../Skeleton";

// builder tabs: a part slot, plus the colour slot shown under it
const TABS: { slot: Slot; colour?: Slot; label: string }[] = [
  { slot: "skin", label: "Skin" }, { slot: "face", label: "Face" }, { slot: "hair", colour: "hair_colour", label: "Hair" },
  { slot: "eyes", label: "Eyes" }, { slot: "brows", colour: "hair_colour", label: "Brows" }, { slot: "mouth", label: "Mouth" },
  { slot: "facial_hair", colour: "hair_colour", label: "Beard" }, { slot: "glasses", label: "Glasses" },
  { slot: "headwear", colour: "outfit_colour", label: "Hats" }, { slot: "outfit", colour: "outfit_colour", label: "Outfit" },
  { slot: "bg", label: "Background" },
];
const ERR: Record<string, string> = {
  not_enough_coins: "Not enough coins yet.",
};

/** Duolingo-style creator: big live preview, category tabs, a tile per option (each previewed on you), colours, Randomize. */
export default function AvatarBuilder({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const [look, setLook] = useState<Required<AvatarLook>>({ ...DEFAULT_LOOK, ...profile.avatar });
  const [tab, setTab] = useState(0);
  const [owned, setOwned] = useState(() => new Set(profile.owned));
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [coins, setCoins] = useState(profile.coins);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { getShop().then((items) => setPrices(Object.fromEntries(items.filter((i) => i.kind === "avatar").map((i) => [i.id, i.price])))).catch(() => undefined); }, []);

  const { slot, colour } = TABS[tab];
  const has = (s: Slot, id: string) => !SLOTS[s].options.find((x) => x.id === id)?.premium || owned.has(`avatar:${s}:${id}`);
  const pick = async (s: Slot, id: string) => {
    setMsg("");
    if (!has(s, id)) {
      const price = prices[`${s}:${id}`];
      if (price > coins) { setMsg(`${SLOTS[s].options.find((x) => x.id === id)!.label} costs ${price} coins: ${price - coins} more to go.`); return; }
      if (!confirm(`Buy ${SLOTS[s].options.find((x) => x.id === id)!.label} for ${price} coins?`)) return;
      try { setCoins(await buyItem("avatar", `${s}:${id}`)); setOwned((o) => new Set(o).add(`avatar:${s}:${id}`)); }
      catch (e) { setMsg(ERR[errCode(e)] ?? "Couldn't buy that. Try again."); return; }
    }
    setLook((l) => ({ ...l, [s]: id }));
  };
  const save = async () => {
    setSaving(true); setMsg("");
    try { await setAvatar(look); onSaved(); } catch { setMsg("Couldn't save your avatar. Try again."); setSaving(false); }
  };

  return (
    <Modal labelledBy="ab-title" className="builder" dismissable={false} onClose={onClose}>
        <header className="modal-head">
          <h2 id="ab-title">Your avatar</h2>
          <span className="coin-balance num"><Coins size={16} aria-hidden /> {coins}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="builder-preview">
          <AvatarSvg look={look} size={168} title="Avatar preview" />
          <button type="button" className="btn soft small" onClick={() => setLook(randomLook())}><Dices size={16} aria-hidden /> Randomize</button>
        </div>
        <div className="builder-tabs" role="tablist" aria-label="Avatar parts">
          {TABS.map((t, i) => <button key={t.label} type="button" role="tab" aria-selected={i === tab} className={i === tab ? "on" : ""} onClick={() => setTab(i)}>{t.label}</button>)}
        </div>
        {SLOTS[slot].options[0].colour ? null : (
          <ul className="builder-grid" role="radiogroup" aria-label={SLOTS[slot].label}>
            {SLOTS[slot].options.map((x) => {
              const locked = !has(slot, x.id);
              return (
                <li key={x.id}>
                  <button type="button" role="radio" aria-checked={look[slot] === x.id} className={`tile${look[slot] === x.id ? " on" : ""}`}
                    onClick={() => pick(slot, x.id)} aria-label={locked ? `${x.label}, ${prices[`${slot}:${x.id}`] ?? ""} coins` : x.label}>
                    <AvatarSvg look={{ ...look, [slot]: x.id }} size={72} />
                    <span>{x.label}</span>
                    {locked && <span className="tile-price num"><Lock size={11} aria-hidden /> {prices[`${slot}:${x.id}`] ?? "…"}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {[SLOTS[slot].options[0].colour ? slot : colour].filter(Boolean).map((cs) => (
          <div key={cs} className="swatches builder-colours" role="radiogroup" aria-label={SLOTS[cs!].label}>
            {SLOTS[cs!].options.map((x) => {
              const locked = !has(cs!, x.id);
              return (
                <button key={x.id} type="button" role="radio" aria-checked={look[cs!] === x.id} aria-label={locked ? `${x.label}, ${prices[`${cs}:${x.id}`] ?? ""} coins` : x.label}
                  className={`swatch big${look[cs!] === x.id ? " on" : ""}`} onClick={() => pick(cs!, x.id)}
                  style={{ ["--c" as string]: x.colour!.startsWith("url") ? (x.id === "sunset" ? "linear-gradient(#ff9a8b, #ffc56f, #7f7fd5)" : "radial-gradient(#fff2b0, #f2c230, #b8860b)") : x.colour }}>
                  {locked && <Lock size={12} aria-hidden />}
                </button>
              );
            })}
          </div>
        ))}
        {msg && <p className="error" role="alert">{msg}</p>}
        <button type="button" className="btn big" onClick={save} disabled={saving}>{saving ? <><Spinner /> Saving…</> : "Save avatar"}</button>
    </Modal>
  );
}
