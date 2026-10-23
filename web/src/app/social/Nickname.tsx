import { useState } from "react";
import { ApiError } from "../../lib/supabase";
import { COLOURS, setMe } from "../../lib/api";
import Avatar from "./Avatar";

/** First-use sheet: pick the name and colour friends, trip-mates and the leaderboard see. */
export default function Nickname({ current, colour: initialColour, onDone, onLater }: {
  current: string | null; colour: string; onDone: () => void; onLater: () => void;
}) {
  const [name, setName] = useState(current ?? "");
  const [colour, setColour] = useState(initialColour);
  const [msg, setMsg] = useState("");
  const save = async () => {
    setMsg("");
    try { await setMe({ nickname: name, colour }); onDone(); }
    catch (e) { setMsg(e instanceof ApiError && e.code === "bad_nickname" ? "Use 2 to 20 letters or numbers." : "Couldn't save. Try again."); }
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="nick-title">
      <form className="modal" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <header className="modal-head">
          <h2 id="nick-title">{current ? "Your name and colour" : "Pick a traveller name"}</h2>
          <button type="button" className="icon-btn" onClick={onLater} aria-label="Close">✕</button>
        </header>
        <p className="fine">Friends, trip-mates and the leaderboard see this name and colour. Never your email.</p>
        <div className="row nick-preview">
          <Avatar name={name || "?"} colour={colour} size={48} />
          <input className="text-in" value={name} maxLength={20} placeholder="e.g. Kai" aria-label="Nickname" autoFocus
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="swatches" role="radiogroup" aria-label="Avatar colour">
          {COLOURS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={c}
              className={`swatch c-${c}${colour === c ? " on" : ""}`} onClick={() => setColour(c)} />
          ))}
        </div>
        {msg && <p className="error" role="alert">{msg}</p>}
        <div className="row">
          <button className="btn" type="submit" disabled={name.trim().length < 2}>Save</button>
          {!current && <button className="btn ghost" type="button" onClick={onLater}>Later</button>}
        </div>
      </form>
    </div>
  );
}
