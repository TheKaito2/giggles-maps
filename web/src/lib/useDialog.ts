import { useEffect, useRef } from "react";

// Open dialogs, newest last: Escape and Back act on the top one only.
const open: { close: () => void; closedByBack: () => void }[] = [];
// history.back() calls we make ourselves (a dialog closed by its own button drops the entry it added): not a user's Back.
// Counted here, in one listener that runs before any other, so a skip is used up even when no dialog is left to see it.
let skipPop = 0;
let quiet = false;
/** This page load's id. history.state survives a reload but the open dialogs and tabs don't: entries from an earlier
 *  load are ignored, or Back would land on them and do nothing. */
export const LOAD = Date.now();
export const ours = (state: unknown) => (state as { gmLoad?: number } | null)?.gmLoad === LOAD;
// entries of dialogs that opened while one of our own Backs was still on its way: added once it lands, or it pops them
let afterBack: (() => void)[] = [];
addEventListener("popstate", () => {
  quiet = skipPop > 0;
  if (quiet) {
    skipPop--;
    if (!skipPop) { const later = afterBack; afterBack = []; later.forEach((push) => push()); }
    return;
  }
  open.at(-1)?.closedByBack();
});
export const dialogsOpen = () => open.length;
/** Whether the popstate being handled right now came from quietBack (other popstate listeners can ignore it). */
export const quietPop = () => quiet;
/** Go back one history entry without it counting as the user pressing Back. */
export function quietBack() { skipPop++; history.back(); }
// A dialog closed by its own button gives its history entry back, but only after the current tap's effects have run: when
// another dialog opens in the same tap (Layers -> Offline maps, Shop -> Avatar), it takes that entry over instead. Going
// back at once was wrong there: history.back() is async, so it landed after the new dialog's pushState and popped the
// new dialog's entry, and the next Back left the app.
let handOver = 0;   // entries given back this tap and not yet taken over (two dialogs can close in one tap)

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
    const me = { close: () => close.current(), closedByBack: () => { byBack = true; close.current(); } };
    open.push(me);
    box.current?.focus();
    let added = false;   // its history entry is in place (so closing it by its button gives one back)
    const push = () => { added = true; history.pushState({ ...history.state, gmDialog: open.length, gmLoad: LOAD }, ""); };
    if (handOver) { handOver--; added = true; history.replaceState({ ...history.state, gmDialog: open.length, gmLoad: LOAD }, ""); }
    // a lazy dialog (its code loads first) can mount after the closed one's Back was sent: wait for it to land
    else if (skipPop) afterBack.push(push);
    else push();
    const keys = (e: KeyboardEvent) => {
      if (open.at(-1) !== me) return;
      if (e.key === "Escape") { e.stopPropagation(); me.close(); return; }
      if (e.key !== "Tab" || !box.current) return;
      // keep Tab inside the dialog: wrap from the last focusable to the first and back
      const f = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")]
        .filter((el) => el.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      open.splice(open.indexOf(me), 1);
      afterBack = afterBack.filter((f) => f !== push);   // closed before its entry went in: nothing to give back
      if (!byBack && added && history.state?.gmDialog && ours(history.state)) {   // closed by its own button: drop the entry it added
        handOver++;
        queueMicrotask(() => { if (handOver) { handOver--; quietBack(); } });
      }
      back?.focus();
    };
  }, []);
  return box;
}
