import { Fragment } from "react";

/** A number with its unit, the number big and bold, the unit small: "+20 min", "1 h 15 min", "15:15". The figure is what you read. */
export default function Figure({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/([+-]?\d+(?::\d+)?)/).filter(Boolean);
  return (
    <span className={`figure ${className}`}>
      {parts.map((p, i) => /\d/.test(p) ? <b key={i} className="num">{p}</b> : <Fragment key={i}><small>{p.trim()}</small>{" "}</Fragment>)}
    </span>
  );
}
