// Sideways scrollers (chip rows, photo strips, plan cards...) hide their scrollbar, which is fine with a touchscreen or a
// trackpad but leaves a mouse stuck. With a mouse, hovering one shows ‹ › buttons at its edges, and the wheel scrolls it
// sideways. One pair of buttons for the whole app, placed over whichever row the pointer is on.
const ROWS = ".chips-scroll, .builder-tabs, .friend-row, .explore-chips, .photo-strip, .product-strip, .plan-cards, .share-kinds, .shop-grid.today, .champ-row";

export function installHScroll() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  let row: HTMLElement | null = null;
  let hide = 0;
  const arrow = (dir: -1 | 1) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = `hscroll-arrow ${dir < 0 ? "prev" : "next"}`; b.tabIndex = -1;   // keyboard users tab through the items instead
    b.setAttribute("aria-hidden", "true"); b.textContent = dir < 0 ? "‹" : "›";
    b.addEventListener("click", () => row?.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: "smooth" }));
    document.body.append(b);
    return b;
  };
  const prev = arrow(-1), next = arrow(1);

  const place = () => {
    const r = row?.getBoundingClientRect();
    const show = !!row && !!r && r.width > 0 && row.scrollWidth > row.clientWidth + 1;
    for (const [b, x, on] of [[prev, r ? r.left : 0, show && row!.scrollLeft > 1], [next, r ? r.right : 0, show && row!.scrollLeft < row!.scrollWidth - row!.clientWidth - 1]] as const) {
      b.classList.toggle("on", on);
      if (r && on) { b.style.top = `${r.top + r.height / 2}px`; b.style.left = `${x}px`; }
    }
  };
  const leave = () => { clearTimeout(hide); hide = window.setTimeout(() => { row = null; place(); }, 150); };

  document.addEventListener("pointerover", (e) => {
    const t = e.target as Element;
    if (t === prev || t === next) { clearTimeout(hide); return; }
    const found = t.closest<HTMLElement>(ROWS);
    if (found) { clearTimeout(hide); row = found; place(); }
    else if (row) leave();
  });
  document.documentElement.addEventListener("pointerleave", leave);   // pointer left the window
  document.addEventListener("scroll", () => row && place(), true);
  addEventListener("resize", () => row && place());
  // a plain mouse wheel (no sideways movement) over a row scrolls it sideways, until it reaches its end
  document.addEventListener("wheel", (e) => {
    const r = (e.target as Element).closest?.<HTMLElement>(ROWS);
    if (!r || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || r.scrollWidth <= r.clientWidth) return;
    const room = e.deltaY > 0 ? r.scrollWidth - r.clientWidth - r.scrollLeft : r.scrollLeft;
    if (room < 1) return;
    e.preventDefault();
    r.scrollLeft += e.deltaY;
  }, { passive: false });
}
