import { useEffect, useState } from "react";
import { Backpack, Check, Clock, Coins, Lock, Shirt, ShoppingBag, Vault, X } from "lucide-react";
import { errCode } from "../../lib/supabase";
import { buyItem, buySet, equip, getShop, getShopToday, KIND_NAME, levelFor, type Profile, setAvatar, type ShopItem, type ShopKind, type ShopSet,
  type ShopToday } from "../../lib/api";
import { AvatarSvg, type Slot } from "../avatar/parts";
import { useDialog } from "../../lib/useDialog";
import { SkelBlock, SkelTiles } from "../Skeleton";

const KINDS: { kind: ShopKind; title: string }[] = [
  { kind: "theme", title: "Passport covers" }, { kind: "frame", title: "Photo frames" }, { kind: "avatar", title: "Avatar items" },
  { kind: "flair", title: "Name flair" }, { kind: "title", title: "Titles" }, { kind: "map", title: "Map skins" },
];
const ERR: Record<string, string> = {
  plus_only: "This comes with Plus.",
  not_enough_coins: "Not enough coins yet. Stamps, quests and level-ups earn more.",
  already_owned: "You already have this.",
  level_reward: "A level reward: it's yours when you reach its level.",
};
// the same names as Siam Si sticks: price sets the rarity, Siam Si-only items are Legendary
// above Legendary, the Vault: saved up for, never drawn from Siam Si or shown as a daily pick (both cap by price)
type ItemRarity = "common" | "rare" | "epic" | "legendary" | "mythic" | "celestial" | "transcendent";
const rarityOf = (i: ShopItem): ItemRarity | null => i.gacha_only ? "legendary" : i.price >= 20000 ? "transcendent" : i.price >= 6000 ? "celestial"
  : i.price >= 2000 ? "mythic" : i.price === 0 || i.plus_only ? null : i.price <= 150 ? "common" : i.price <= 400 ? "rare" : "epic";
const VAULT: { r: ItemRarity; title: string }[] = [{ r: "mythic", title: "Mythic" }, { r: "celestial", title: "Celestial" }, { r: "transcendent", title: "Transcendent" }];
const inVault = (i: ShopItem) => VAULT.some((v) => v.r === rarityOf(i));
const key = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
const left = (iso: string) => {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

/** A small picture of the item, worn by you where that makes sense (avatar items on your avatar, flair on your name). */
export function Preview({ item, profile, big = false }: { item: ShopItem; profile: Profile | null; big?: boolean }) {
  const name = profile?.nickname ?? "Explorer";
  if (item.kind === "avatar") {
    const [slot, part] = item.id.split(":");
    return <span className="preview avatar-prev" aria-hidden><AvatarSvg look={{ ...profile?.avatar, [slot as Slot]: part }} size={big ? 160 : 60} /></span>;
  }
  if (item.kind === "theme") return <span className={`preview cover-prev cover-bg theme-${item.id}`} aria-hidden><span className="cover-title">PASSPORT</span>
    {big && <span className="cover-name">{name}</span>}</span>;
  if (item.kind === "frame") return <span className={`preview frame-${item.id}`} aria-hidden>
    {profile?.avatar && Object.keys(profile.avatar).length ? <span className="ph framed"><AvatarSvg look={profile.avatar} size={big ? 150 : 44} /></span> : <span className="ph" />}</span>;
  if (item.kind === "map") return <span className={`preview map-skin skin-${item.id}`} aria-hidden />;
  if (item.kind === "flair") return <span className={`preview flair flair-${item.id}`} aria-hidden>{big ? name : "Aa"}</span>;
  return <span className="preview title-chip" aria-hidden>{big && <b>{name}</b>}<span>{item.name_en}</span></span>;
}

/** Cosmetics bought with earned coins (never real money): this week's set, today's picks, then everything by kind. Tap to try on. */
export default function Shop({ profile, coins, onChange, onAvatar, start = "shop" }: {
  profile: Profile | null; coins: number; onChange: () => void; onAvatar: () => void; start?: "shop" | "bag";
}) {
  const [view, setView] = useState(start);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [today, setToday] = useState<ShopToday | null>(null);
  const [trying, setTrying] = useState<ShopItem | null>(null);
  const [msg, setMsg] = useState("");
  const [, tick] = useState(0);
  const load = () => {
    getShop().then(setItems).catch(() => setMsg("Couldn't load the shop."));
    getShopToday().then(setToday).catch(() => undefined);
  };
  useEffect(load, []);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const plus = !!profile?.plusUntil;
  const level = levelFor(profile?.xp ?? 0);
  const free = (i: ShopItem) => i.price === 0 && i.level_req == null;   // the defaults everyone has (Classic cover, plain name...)
  const owns = (i: ShopItem) => i.level_req != null ? level >= i.level_req : free(i) || (plus && i.plus) || !!profile?.owned.includes(key(i));
  const wearing = (i: ShopItem) => {
    if (i.kind === "avatar") { const [slot, part] = i.id.split(":"); return profile?.avatar?.[slot as Slot] === part; }
    return (profile?.look[i.kind] ?? (free(i) ? i.id : null)) === i.id;
  };
  const byKey = new Map(items.map((i) => [key(i), i]));
  const canBuy = (i: ShopItem) => owns(i) || (!i.plus_only && i.level_req == null && coins >= i.price);

  const act = async (i: ShopItem) => {
    setMsg("");
    try {
      if (!owns(i)) await buyItem(i.kind, i.id);
      if (i.kind === "avatar") { const [slot, part] = i.id.split(":"); await setAvatar({ ...profile?.avatar, [slot]: part }); }
      else await equip(i.kind, i.id);
      onChange(); setTrying(null);
    } catch (e) { setMsg(ERR[errCode(e)] ?? "Couldn't do that. Try again."); }
  };
  const getSet = async (s: ShopSet) => {
    setMsg("");
    try { await buySet(s.id); onChange(); load(); setMsg(`${s.name_en} set is yours. Tap an item to wear it.`); }
    catch (e) { setMsg(ERR[errCode(e)] ?? "Couldn't buy the set. Try again."); }
  };

  // the bag: kinds where you own something beyond the free default (which stays listed, to switch back), wearing first
  const bag = KINDS.map(({ kind, title }) => ({ kind, title, list: items.filter((i) => i.kind === kind && owns(i))
    .sort((a, b) => Number(wearing(b)) - Number(wearing(a)) || a.price - b.price) }))
    .filter((k) => k.list.some((i) => !free(i)));
  const bagCount = bag.reduce((n, k) => n + k.list.filter((i) => !free(i)).length, 0);

  const tile = (i: ShopItem) => {   // a plain function, not a component: a component made here would remount every render
    const on = wearing(i), own = owns(i), r = rarityOf(i);
    return (
      <li key={key(i)} className={`${on ? "on " : ""}${r ? `r-${r}` : ""}`}>
        <button type="button" className="tile-try" onClick={() => setTrying(i)} aria-label={`Try on ${i.name_en}`}>
          <Preview item={i} profile={profile} />
          <b>{i.name_en}</b><span className="fine">{i.name_th}</span>
        </button>
        <span className="tile-foot">
          {on ? <span className="chip on"><Check size={13} aria-hidden /> On</span> : own ? <span className="chip">Owned</span>
            : i.plus_only ? <span className="chip plus-chip">Plus</span>
            : i.level_req != null ? <span className="chip level-chip"><Lock size={12} aria-hidden /> Level {i.level_req}</span>
            : <span className={`coin-price num${canBuy(i) ? "" : " short"}`}><Coins size={13} aria-hidden /> {i.price.toLocaleString()}</span>}
          {r && <span className={`rarity r-${r}`}>{r}</span>}
        </span>
        {inVault(i) && !own && coins < i.price && <span className="goal">
          <progress value={coins} max={i.price} aria-label={`Saved toward ${i.name_en}`} />
          <span className="fine num">{(i.price - coins).toLocaleString()} coins to go</span></span>}
        {i.plus && !i.plus_only && !own && <span className="chip">Free with Plus</span>}
      </li>
    );
  };
  const sets = today?.sets ?? [];
  const featured = sets[0];
  const picks = (today?.picks ?? []).map((p) => byKey.get(key(p))).filter((x): x is ShopItem => !!x);

  return (
    <div className="shop stack">
      <div className="row between">
        <span className="coin-balance num"><Coins size={18} aria-hidden /> {coins} coins</span>
      </div>
      <div className="seg shop-tabs" role="tablist" aria-label="Shop or bag">
        <button type="button" role="tab" aria-selected={view === "shop"} className={view === "shop" ? "on" : ""} onClick={() => setView("shop")}>
          <ShoppingBag size={16} aria-hidden /> Shop</button>
        <button type="button" role="tab" aria-selected={view === "bag"} className={view === "bag" ? "on" : ""} onClick={() => setView("bag")}>
          <Backpack size={16} aria-hidden /> Bag{bagCount > 0 && <span className="num"> · {bagCount}</span>}</button>
      </div>
      {msg && <p className="fine" role="status">{msg}</p>}

      {!items.length && !msg ? <><SkelBlock h={220} /><SkelTiles n={6} /></> : view === "bag" ? (bag.length ? bag.map(({ kind, title, list }) => (
        <section key={kind}>
          <div className="row between"><h4 className="eyebrow">{title}</h4>
            {kind === "avatar" && <button type="button" className="link" onClick={onAvatar}><Shirt size={14} aria-hidden /> Avatar builder</button>}</div>
          <ul className="shop-grid">{list.map(tile)}</ul>
        </section>
      )) : (
        <div className="empty glass">
          <b>Your bag is empty</b>
          <p className="fine">Covers, frames, flair, titles and avatar items you buy or win from Siam Si land here. Tap one to wear it.</p>
          <button type="button" className="btn" onClick={() => setView("shop")}>Go to the shop</button>
        </div>
      )) : <>
      {featured && <SetCard s={featured} hero byKey={byKey} profile={profile} coins={coins} onBuy={getSet} onTry={setTrying} />}

      <section className="vault" aria-labelledby="vault-h">
        <div className="vault-head"><Vault size={20} aria-hidden /><h4 id="vault-h">The Vault</h4>
          <span className="fine">The rarest of all. Saved up for, never in Siam Si.</span></div>
        {VAULT.map(({ r, title }) => {
          const list = items.filter((i) => rarityOf(i) === r);
          return list.length > 0 && <div key={r} className={`vault-row v-${r}`}>
            <div className="row between"><span className={`rarity r-${r}`}>{title}</span>
              <span className="coin-price num"><Coins size={14} aria-hidden /> {list[0].price.toLocaleString()} each</span></div>
            <ul className="shop-grid">{list.map(tile)}</ul>
          </div>;
        })}
      </section>

      <section>
        <div className="row between"><h4 className="eyebrow">Plus shelf</h4>{plus && <span className="fine">Yours with Plus</span>}</div>
        <ul className="shop-grid today">{items.filter((i) => i.plus_only).map(tile)}</ul>
      </section>

      {picks.length > 0 && <section>
        <div className="row between"><h4 className="eyebrow">Today's picks</h4>
          {today && <span className="fine"><Clock size={13} aria-hidden /> New picks in {left(today.ends)}</span>}</div>
        <ul className="shop-grid today">{picks.map(tile)}</ul>
      </section>}

      <section>
        <div className="row between"><h4 className="eyebrow">Level rewards</h4><span className="fine">Never sold: reach the level</span></div>
        <ul className="shop-grid today">{items.filter((i) => i.level_req != null).sort((a, b) => a.level_req! - b.level_req!).map(tile)}</ul>
      </section>

      {sets.length > 1 && <section>
        <h4 className="eyebrow">More sets</h4>
        <div className="set-list">{sets.slice(1).map((s) => <SetCard key={s.id} s={s} byKey={byKey} profile={profile} coins={coins} onBuy={getSet} onTry={setTrying} />)}</div>
      </section>}

      {KINDS.map(({ kind, title }) => (
        <section key={kind}>
          <div className="row between"><h4 className="eyebrow">{title}</h4>
            {kind === "avatar" && <button type="button" className="link" onClick={onAvatar}><Shirt size={14} aria-hidden /> Avatar builder</button>}</div>
          <ul className="shop-grid">
            {items.filter((i) => i.kind === kind && !i.plus_only && i.level_req == null && !inVault(i) && (!i.gacha_only || owns(i))).map(tile)}
          </ul>
        </section>
      ))}
      </>}

      {trying && <TryOn item={trying} profile={profile} msg={msg} wearing={wearing(trying)} owns={owns(trying)} canBuy={canBuy(trying)} coins={coins}
        onAct={() => act(trying)} onClose={() => setTrying(null)} />}
    </div>
  );
}

/** Try an item on before buying: big preview, then Wear or Buy. */
function TryOn({ item, profile, msg, wearing, owns, canBuy, coins, onAct, onClose }: {
  item: ShopItem; profile: Profile | null; msg: string; wearing: boolean; owns: boolean; canBuy: boolean; coins: number; onAct: () => void; onClose: () => void;
}) {
  const box = useDialog(onClose);
  const r = rarityOf(item);
  return (
    <div className="sheet-backdrop try-backdrop" role="dialog" aria-modal="true" aria-label={`Try on ${item.name_en}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal try-on${r ? ` r-${r}` : ""}`} ref={box} tabIndex={-1}>
        <header className="modal-head">
          <span><span className="eyebrow">{KIND_NAME[item.kind]}{r ? ` · ${r}` : ""}</span>
            <h2>{item.name_en}</h2><span className="fine">{item.name_th}</span></span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="try-stage"><Preview item={item} profile={profile} big /></div>
        {item.gacha_only && <p className="fine">Siam Si only: won from a fortune stick, never sold.</p>}
        {item.plus_only && !owns && <p className="fine">On the Plus shelf: yours while you have Plus, never sold.</p>}
        {item.level_req != null && <p className="fine">A level reward: yours from level {item.level_req} on, never sold.</p>}
        {msg && <p className="fine" role="status">{msg}</p>}
        {wearing ? <button type="button" className="btn" disabled><Check size={16} aria-hidden /> Wearing it</button>
          : owns ? <button type="button" className="btn" onClick={onAct}>Wear it</button>
          : item.plus_only ? <button type="button" className="btn" disabled>Comes with Plus</button>
          : item.level_req != null ? <button type="button" className="btn" disabled><Lock size={16} aria-hidden /> Reach level {item.level_req}</button>
          : <button type="button" className="btn gold" disabled={!canBuy} onClick={onAct}><Coins size={16} aria-hidden /> Buy for {item.price.toLocaleString()} and wear</button>}
        {!owns && !canBuy && !item.plus_only && item.level_req == null && <p className="fine">{(item.price - coins).toLocaleString()} more coins to go.</p>}
      </div>
    </div>
  );
}

/** A themed set: its items, the full price struck out, and what it costs you (missing items, 25% off). */
function SetCard({ s, hero = false, byKey, profile, coins, onBuy, onTry }: {
  s: ShopSet; hero?: boolean; byKey: Map<string, ShopItem>; profile: Profile | null; coins: number; onBuy: (s: ShopSet) => void; onTry: (i: ShopItem) => void;
}) {
  const list = s.items.map((k) => byKey.get(k)).filter((x): x is ShopItem => !!x);
  const owned = s.price === 0;
  return (
    <article className={`set-card set-${s.id}${hero ? " hero" : ""}`}>
      <div className="set-head">
        {hero && <span className="eyebrow">This week's set</span>}
        <h3>{s.name_en} <span lang="th">{s.name_th}</span></h3>
        <p className="fine">{s.blurb_en}</p>
      </div>
      <ul className="set-items">{list.map((i) => <li key={key(i)}><button type="button" onClick={() => onTry(i)} aria-label={`Try on ${i.name_en}`}>
        <Preview item={i} profile={profile} /><span>{i.name_en}</span></button></li>)}</ul>
      <div className="row between set-buy">
        {owned ? <span className="chip on"><Check size={13} aria-hidden /> All yours</span> : <span className="num">
          {s.price < s.full && <s className="fine">{s.full}</s>} <b><Coins size={15} aria-hidden /> {s.price}</b>
          {s.price > s.full * 0.7 && <span className="fine"> · save {s.full - s.price}</span>}</span>}
        {!owned && <button type="button" className="btn gold small" disabled={coins < s.price} onClick={() => onBuy(s)}>Get the set</button>}
      </div>
    </article>
  );
}
