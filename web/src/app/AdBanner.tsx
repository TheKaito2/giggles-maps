import { useEffect, useRef, useState } from "react";
import { Ban, Sparkles, Store } from "lucide-react";
import { openSite } from "../lib/native";

// v5: the banner everyone sees except members and Plus. Google AdSense fills it once VITE_ADSENSE_CLIENT and VITE_ADSENSE_SLOT are
// set; until then it shows our own ads. Never on the map (directions, the detour planner, check-in): only on the other tabs.
const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;
const SLOT = import.meta.env.VITE_ADSENSE_SLOT as string | undefined;
const HOUSE = [
  { icon: <Ban size={20} aria-hidden />, title: "Remove ads forever", sub: "Membership · ฿349 once, 3 months of Plus free", act: "upgrade" },
  { icon: <Sparkles size={20} aria-hidden />, title: "Try Giggles Plus", sub: "No ads and +20 coins a day · ฿59/month", act: "upgrade" },
  { icon: <Store size={20} aria-hidden />, title: "Own a shop or café?", sub: "Become a Giggles partner and take bookings", act: "partner" },
] as const;

let loaded = false;
function loadAdSense() {
  if (loaded || !CLIENT) return;
  loaded = true;
  const s = document.createElement("script");
  s.async = true; s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
  document.head.append(s);
}

/** `page` changes when the tab changes: a new ad (or the next house ad) each time. */
export default function AdBanner({ page, onRemove }: { page: string; onRemove: () => void }) {
  const [n, setN] = useState(() => Math.floor(Math.random() * HOUSE.length));
  useEffect(() => { setN((x) => x + 1); }, [page]);
  const slot = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!CLIENT || !SLOT || !slot.current) return;
    loadAdSense();
    try { ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ||= []).push({}); }
    catch (e) { console.error("adsense", e); }
  }, [page]);
  const ad = HOUSE[n % HOUSE.length];
  return (
    <aside className="ad-banner" aria-label="Advertisement">
      <span className="ad-label">Ad</span>
      {CLIENT && SLOT
        ? <ins key={page} ref={slot} className="adsbygoogle ad-slot" data-ad-client={CLIENT} data-ad-slot={SLOT} data-ad-format="horizontal" data-full-width-responsive="true" />
        : <button type="button" className="ad-house" onClick={() => ad.act === "partner" ? openSite("/shop/") : onRemove()}>
            <span className="ad-icon">{ad.icon}</span>
            <span className="person-main"><b>{ad.title}</b><span className="fine">{ad.sub}</span></span>
          </button>}
      <button type="button" className="link ad-remove" onClick={onRemove}>Remove ads</button>
    </aside>
  );
}
