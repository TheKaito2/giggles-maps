import { useEffect, useRef } from "react";

// open dialogs, newest last: Escape and Back close only the top one
const open: (() => void)[] = [];
let skipPop = 0;   // history.back() calls we make ourselves (a dialog closed by its own button): not a user's Back
export const dialogsOpen = () => open.length;
/** Go back one history entry without it counting as the user pressing Back. */
export function quietBack() { skipPop++; history.back(); }

/**
 * For a modal: focus moves into it on open and stays inside while you Tab, Escape closes it, the phone's or browser's Back
 * closes it (instead of leaving the app), and focus goes back to whatever opened it. Only the topmost of stacked dialogs
 * reacts. Put the returned ref on the modal box and give the box tabIndex={-1}.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const box = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    let byBack = false;
    const me = () => close.current();
    open.push(me);
    box.current?.focus();
    history.pushState({ ...history.state, gmDialog: open.length }, "");
    const keys = (e: KeyboardEvent) => {
      if (open.at(-1) !== me) return;
      if (e.key === "Escape") { e.stopPropagation(); me(); return; }
      if (e.key !== "Tab" || !box.current) return;
      // keep Tab inside the dialog: wrap from the last focusable to the first and back
      const f = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")]
        .filter((el) => el.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const pop = () => {
      if (skipPop > 0) { skipPop--; return; }
      if (open.at(-1) === me) { byBack = true; me(); }
    };
    document.addEventListener("keydown", keys);
    addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("keydown", keys);
      removeEventListener("popstate", pop);
      open.splice(open.indexOf(me), 1);
      if (!byBack && history.state?.gmDialog) quietBack();   // closed by its own button: drop the entry it added
      back?.focus();
    };
  }, []);
  return box;
}
