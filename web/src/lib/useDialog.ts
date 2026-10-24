import { useEffect, useRef } from "react";

// open dialogs, newest last: Escape closes only the top one
const open: (() => void)[] = [];

/**
 * For a modal: focus moves into it on open, Escape closes it (only the topmost when they stack), and focus goes back to
 * whatever opened it. Put the returned ref on the modal box and give the box tabIndex={-1}.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const box = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const me = () => close.current();
    open.push(me);
    box.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && open.at(-1) === me) { e.stopPropagation(); me(); } };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); open.splice(open.indexOf(me), 1); back?.focus(); };
  }, []);
  return box;
}
