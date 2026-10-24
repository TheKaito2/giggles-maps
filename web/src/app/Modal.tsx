import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "../lib/useDialog";

/** Every sheet and pop-up: drawn on <body> (so nothing on the map, the detour sheet or the tab bar can cover or clip it),
 *  closed by Escape, Back, the backdrop or its own button, with focus kept inside while open. */
export default function Modal({ label, labelledBy, className = "", backdrop = "", onClose, onSubmit, children }: {
  label?: string; labelledBy?: string; className?: string; backdrop?: string; onClose: () => void;
  onSubmit?: () => void;   // the box is a <form>: Enter submits
  children: ReactNode;
}) {
  const box = useDialog<HTMLDivElement & HTMLFormElement>(onClose);
  return createPortal(
    <div className={`sheet-backdrop ${backdrop}`} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {onSubmit
        ? <form className={`modal ${className}`} ref={box} tabIndex={-1} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{children}</form>
        : <div className={`modal ${className}`} ref={box} tabIndex={-1}>{children}</div>}
    </div>,
    document.body,
  );
}
