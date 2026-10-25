import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Info as InfoIcon } from "lucide-react";

/** An (i) button that holds the explaining, so screens stay short. Tap to open; tap elsewhere or Escape closes it. */
export default function Info({ label, children, align = "start" }: { label: string; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  // keep the bubble on screen: nudge it back in when it would run past either edge
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    el.style.translate = "";
    // layout sizes, not getBoundingClientRect: the pop-in animation is still scaling the bubble down at this point
    const left = box.current!.getBoundingClientRect().left + el.offsetLeft, right = left + el.offsetWidth, pad = 12;
    const dx = right > innerWidth - pad ? innerWidth - pad - right : left < pad ? pad - left : 0;
    if (dx) el.style.translate = `${dx}px 0`;
    // and open upward when there's no room below inside its scrolling panel (it hid behind the trip's Start bar)
    const anchor = box.current!.getBoundingClientRect();
    const floor = Math.min(innerHeight, (box.current!.closest(".sheet-body, .modal, .page-view")?.getBoundingClientRect().bottom ?? innerHeight)) - pad;
    el.classList.toggle("up", anchor.bottom + 6 + el.offsetHeight > floor && anchor.top - 6 - el.offsetHeight > pad);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const out = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); box.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <span className="info" ref={box}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><InfoIcon size={16} aria-hidden /></button>
      {open && <span id={id} ref={pop} role="note" className={`info-pop ${align}`}>{children}</span>}
    </span>
  );
}
