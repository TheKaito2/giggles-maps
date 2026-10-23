import { useEffect, useState } from "react";
import { Check, Coins, Shirt } from "lucide-react";
import { ApiError } from "../../lib/supabase";
import { buyItem, equip, getShop, type Profile, type ShopItem, type ShopKind } from "../../lib/api";

const KINDS: { kind: ShopKind; title: string }[] = [
  { kind: "theme", title: "Passport covers" }, { kind: "frame", title: "Photo frames" }, { kind: "map", title: "Map skins" },
  { kind: "flair", title: "Name flair" }, { kind: "title", title: "Titles" },
];
const ERR: Record<string, string> = {
  members_only: "Coins come with membership. Become a member to spend them.",
  not_enough_coins: "Not enough coins yet. Stamps, challenges and level-ups earn more.",
  already_owned: "You already have this.",
};

function Preview({ item }: { item: ShopItem }) {
  if (item.kind === "theme") return <span className={`preview level-card theme-${item.id}`} aria-hidden />;
  if (item.kind === "frame") return <span className={`preview frame-${item.id}`} aria-hidden><span className="ph" /></span>;
  if (item.kind === "map") return <span className={`preview map-skin skin-${item.id}`} aria-hidden />;
  if (item.kind === "flair") return <span className={`preview flair flair-${item.id}`} aria-hidden>Aa</span>;
  return <span className="preview title-chip" aria-hidden>{item.name_en}</span>;
}

/** Cosmetics bought with earned coins (never real money). Plus includes the items marked Plus. */
export default function Shop({ profile, coins, onChange, onAvatar }: { profile: Profile | null; coins: number; onChange: () => void; onAvatar: () => void }) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { getShop().then(setItems).catch(() => setMsg("Couldn't load the shop.")); }, []);
  const plus = !!profile?.plusUntil;
  const owns = (i: ShopItem) => i.price === 0 || (plus && i.plus) || !!profile?.owned.includes(`${i.kind}:${i.id}`);
  const wearing = (i: ShopItem) => (profile?.look[i.kind] ?? (i.price === 0 ? i.id : null)) === i.id;

  const act = async (i: ShopItem) => {
    setMsg("");
    try {
      if (!owns(i)) await buyItem(i.kind, i.id);
      await equip(i.kind, i.id);
      onChange();
    } catch (e) { setMsg(ERR[e instanceof ApiError ? e.code : ""] ?? "Couldn't do that. Try again."); }
  };

  return (
    <div className="shop stack">
      <div className="row between">
        <span className="coin-balance num"><Coins size={18} aria-hidden /> {coins} coins</span>
        {!profile?.member && <span className="fine">Coins unlock with membership</span>}
      </div>
      {msg && <p className="fine" role="status">{msg}</p>}
      <button type="button" className="shop-avatar" onClick={onAvatar}>
        <Shirt size={30} aria-hidden /><span><b>Avatar items</b><span className="fine">Crowns, ngob hats, Muay Thai gear and more: try them on in the avatar builder.</span></span>
      </button>
      {KINDS.map(({ kind, title }) => (
        <section key={kind}>
          <h4 className="eyebrow">{title}</h4>
          <ul className="shop-grid">
            {items.filter((i) => i.kind === kind && (!i.gacha_only || owns(i))).map((i) => {   // Siam Si items show once won
              const on = wearing(i), own = owns(i);
              return (
                <li key={i.id} className={on ? "on" : ""}>
                  <Preview item={i} />
                  <b>{i.name_en}</b><span className="fine">{i.name_th}</span>
                  <button type="button" className={`btn ${own ? "soft" : "gold"} small`} disabled={on || (!own && (!profile?.member || coins < i.price))}
                    onClick={() => act(i)} aria-label={on ? `${i.name_en}, wearing` : own ? `Use ${i.name_en}` : `Buy ${i.name_en} for ${i.price} coins`}>
                    {on ? <><Check size={14} aria-hidden /> On</> : own ? "Use" : <><Coins size={14} aria-hidden /> {i.price}</>}
                  </button>
                  {i.plus && !own && <span className="chip">Free with Plus</span>}
                  {i.gacha_only && <span className="chip siamsi">Siam Si</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
