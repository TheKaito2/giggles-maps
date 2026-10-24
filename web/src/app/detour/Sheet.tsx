import { type ReactNode, useEffect, useRef, useState } from "react";

export type Snap = "peek" | "half" | "full";
// share of the space above the tab bar the sheet takes at each snap (phones only; desktop shows a fixed panel)
const SNAP: Record<Snap, number> = { peek: 0.3, half: 0.55, full: 0.92 };

/**
 * Apple/Google-Maps-style bottom sheet on phones: drag the handle (or header) between peek, half and full; the body
 * scrolls inside. On wide screens it's the fixed left panel. `snap` changes from outside move it (e.g. results -> half).
 */
export default function Sheet({ snap, setSnap, head, children, foot, label, page }: {
  snap: Snap; setSnap: (s: Snap) => void; head?: ReactNode; children: ReactNode; foot?: ReactNode; label: string; page?: string;
}) {
  // a new step (where to → time options → results) starts at its top, not wherever the last one was scrolled to
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo(0, 0); }, [page]);
  const box = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<number | null>(null);   // height in px while dragging
  const start = useRef<{ y: number; h: number } | null>(null);
  const space = () => box.current?.parentElement?.clientHeight ?? innerHeight;

  // the map pads its view by the sheet height (route fits above it)
  useEffect(() => {
    document.documentElement.style.setProperty("--sheet-h", `${Math.round((drag ?? SNAP[snap] * space()))}px`);
  });

  const down = (e: React.PointerEvent) => {
    if (!e.isPrimary || e.button !== 0 || matchMedia("(min-width: 960px)").matches || (e.target as HTMLElement).closest("button:not(.sheet-handle), input, select, a")) return;
    start.current = { y: e.clientY, h: box.current!.getBoundingClientRect().height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag(Math.max(80, Math.min(space() * SNAP.full, start.current.h + start.current.y - e.clientY)));
  };
  const up = (e: React.PointerEvent) => {
    if (!start.current) return;
    if (e.type === "pointercancel") { start.current = null; setDrag(null); return; }   // the browser took the gesture: stay put
    const moved = start.current.y - e.clientY, h = drag ?? start.current.h, share = h / space();
    start.current = null; setDrag(null);
    if (Math.abs(moved) < 6) { setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "half"); return; }   // a tap toggles
    // nearest snap, nudged in the direction of the flick
    const order: Snap[] = ["peek", "half", "full"];
    const nearest = order.reduce((a, b) => Math.abs(SNAP[b] - share) < Math.abs(SNAP[a] - share) ? b : a);
    const i = order.indexOf(nearest);
    setSnap(Math.abs(moved) > 40 && nearest === snap ? order[Math.max(0, Math.min(2, i + (moved > 0 ? 1 : -1)))] : nearest);
  };

  return (
    <section ref={box} className={`sheet glass snap-${snap}${drag != null ? " dragging" : ""}`} aria-label={label}
      style={drag != null ? { height: drag } : undefined}>
      <div className="sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button type="button" className="sheet-handle" aria-label={snap === "full" ? "Shrink the panel" : "Expand the panel"}
          onClick={(e) => { if (e.detail === 0) setSnap(snap === "full" ? "half" : "full"); }} />
        {/* the handle's onClick is for the keyboard (detail 0); pointer taps and drags go through up() */}
        {head}
      </div>
      <div className="sheet-body" ref={body}>{children}</div>
      {foot && <div className="sheet-foot">{foot}</div>}
    </section>
  );
}
