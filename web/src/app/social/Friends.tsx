import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { ApiError } from "../../lib/supabase";
import { addFriend, answerFriend, type Card, getSocial, type Profile, SITE, type Social } from "../../lib/api";
import Avatar from "./Avatar";
import QrLink from "./QrLink";
import { SkelRows } from "../Skeleton";

const ADD_TEXT: Record<string, string> = {
  code_not_found: "No one has that code. Check it and try again.",
  own_code: "That's your own code.",
  nickname_required: "Pick a name first, so they know who's asking.",
};

export function Person({ c, children, onOpen }: { c: Card; children?: React.ReactNode; onOpen?: () => void }) {
  const body = (<>
    <Avatar name={c.nickname} colour={c.colour} avatar={c.avatar} size={44} />
    <span className="person-main">
      <b className={`flair flair-${c.look.flair ?? "none"}`}>{c.nickname}</b>
      <span className="fine">{c.title ? `${c.title} · ` : ""}Lv {c.level} · {c.stamps} stamps · {c.provinces}/77</span>
    </span>
  </>);
  return (
    <li className="person">
      {onOpen ? <button type="button" className="person-open" onClick={onOpen}>{body}</button> : body}
      {children}
    </li>
  );
}

/** Friends on the Profile tab: my code + QR (LINE-style), add by code, requests, and the list (tap to open a profile). */
export default function FriendsSection({ profile, onOpen }: { profile: Profile | null; onOpen: (id: string) => void }) {
  const [social, setSocial] = useState<Social | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [showQr, setShowQr] = useState(false);
  const load = () => getSocial().then(setSocial).catch(() => setMsg("Couldn't load friends. Check your connection."));
  useEffect(() => { load(); }, [profile?.nickname]);

  const add = async () => {
    setMsg("");
    try { setMsg((await addFriend(code)) === "friends" ? "You're friends now." : "Request sent. They'll see it next time they open the app."); setCode(""); load(); }
    catch (e) { setMsg(ADD_TEXT[e instanceof ApiError ? e.code : ""] ?? "Couldn't add that code. Try again."); }
  };

  return (
    <section className="stack friends" id="friends" aria-label="Friends">
      <div className="row between"><h3>Friends</h3><span className="fine">Your code <b className="num">{profile?.friendCode}</b></span></div>
      <div className="row">
        <form className="row add-friend grow" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="text-in code-in" value={code} maxLength={8} placeholder="Friend code" aria-label="Friend code" autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
          <button className="btn" type="submit" disabled={code.length !== 8}><UserPlus size={16} aria-hidden /> Add</button>
        </form>
        <button type="button" className="btn soft" onClick={() => setShowQr((s) => !s)}>{showQr ? "Hide my QR" : "My QR"}</button>
      </div>
      {showQr && profile?.friendCode && <div className="me-card glass">
        <QrLink url={`${SITE}/app/?friend=${profile.friendCode}`} label="Your friend QR code" />
        <p className="fine center">Friends scan this with their phone camera. Friends can see your passport and photos you haven't hidden.</p>
      </div>}
      {msg && <p className="fine" role="status">{msg}</p>}

      {!!social?.incoming.length && <><h4 className="eyebrow">Wants to be friends</h4><ul className="people">
        {social.incoming.map((c) => <Person key={c.id} c={c}>
          <span className="row">
            <button type="button" className="btn small" onClick={() => answerFriend(c.id, true).then(load)}>Accept</button>
            <button type="button" className="link" onClick={() => answerFriend(c.id, false).then(load)}>Decline</button>
          </span>
        </Person>)}
      </ul></>}

      {!social ? <SkelRows n={2} /> : social.friends.length ? <ul className="people">
        {social.friends.map((c) => <Person key={c.id} c={c} onOpen={() => onOpen(c.id)} />)}
      </ul> : <p className="fine">No friends yet. Share your code or scan theirs, then see each other's stamps in the feed.</p>}

      {!!social?.outgoing.length && <><h4 className="eyebrow">Waiting for them</h4><ul className="people">
        {social.outgoing.map((c) => <Person key={c.id} c={c}><span className="fine">Sent</span></Person>)}
      </ul></>}
    </section>
  );
}
