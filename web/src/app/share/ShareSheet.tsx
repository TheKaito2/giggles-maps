import { useEffect, useRef, useState } from "react";
import { useDialog } from "../../lib/useDialog";
import { Download, Lock, Share2, X } from "lucide-react";
import { type Card, DESIGNS, type Design, drawCard } from "./cards";
import Info from "../Info";

export interface CardOption { id: string; label: string; card: Card }

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
const save = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/** Share one of a few cards (story, sticker, progress, milestone...) in one of the designs: preview, Share, or Save. */
export default function ShareSheet({ options, hasPlus, onClose }: { options: CardOption[]; hasPlus: boolean; onClose: () => void }) {
  const [pick, setPick] = useState(options[0]?.id);
  const [design, setDesign] = useState<Design>("classic");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const option = options.find((o) => o.id === pick) ?? options[0];
  const locked = DESIGNS[design].plus && !hasPlus;
  const box = useDialog(onClose);
  const shown = useRef("");   // the preview's object URL, revoked when replaced or closed

  useEffect(() => {
    let live = true;
    setBlob(null); setMsg("");
    drawCard(option.card, locked ? "classic" : design).then(toBlob).then((b) => {
      if (!live) return;
      if (!b) { setMsg("Couldn't draw this card."); return; }
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = URL.createObjectURL(b);
      setBlob(b); setUrl(shown.current);
    }).catch(() => live && setMsg("Couldn't draw this card. Try another design."));
    return () => { live = false; };
  }, [option.id, design, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current); }, []);

  const name = `giggles-${option.id}.png`;
  const share = async () => {
    if (!blob) return;
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] }).catch(() => { /* closed the share sheet */ });
    else save(blob, name);
  };
  const sticker = option.card.kind === "sticker";

  return (
    <div className="sheet-backdrop share-backdrop" role="dialog" aria-modal="true" aria-label="Share" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal share-sheet" ref={box} tabIndex={-1}>
        <header className="modal-head"><h2>Share</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        {options.length > 1 && (
          <div className="seg share-kinds" role="tablist" aria-label="Card">
            {options.map((o) => <button key={o.id} type="button" role="tab" aria-selected={o.id === option.id} className={o.id === option.id ? "on" : ""}
              onClick={() => setPick(o.id)}>{o.label}</button>)}
          </div>
        )}
        <div className={`share-preview${sticker ? " sticker" : ""}`}>
          {url && blob ? <img src={url} alt={`${option.label} card`} /> : <div className="ph" aria-label="Drawing the card" />}
        </div>
        {sticker && <p className="fine">Clear sticker <Info label="How to use the sticker">In Instagram Stories, add your photo, then paste or pick
          this sticker from your photos.</Info></p>}
        {option.card.kind !== "sticker" && (
          <div className="design-swatches" role="radiogroup" aria-label="Design">
            {(Object.keys(DESIGNS) as Design[]).map((k) => {
              const d = DESIGNS[k];
              return <button key={k} type="button" role="radio" aria-checked={design === k} className={design === k ? "on" : ""}
                style={{ background: `linear-gradient(135deg, ${d.bg[0]}, ${d.bg[1]})`, color: d.accent }} onClick={() => setDesign(k)}
                aria-label={`${d.name}${d.plus && !hasPlus ? ", Plus" : ""}`} title={d.name}>
                {d.plus && !hasPlus ? <Lock size={14} aria-hidden /> : "Aa"}</button>;
            })}
          </div>
        )}
        {locked && <p className="fine">That design comes with Giggles Plus; the preview shows Classic.</p>}
        {msg && <p className="fine" role="alert">{msg}</p>}
        <div className="row">
          <button type="button" className="btn grow" onClick={share} disabled={!blob}><Share2 size={16} aria-hidden /> Share</button>
          <button type="button" className="btn soft" onClick={() => blob && save(blob, name)} disabled={!blob}><Download size={16} aria-hidden /> Save</button>
        </div>
      </div>
    </div>
  );
}
