import { Component, type ReactNode } from "react";
import { RotateCcw, WifiOff } from "lucide-react";

/** A screen that fails to load or crashes shows this card instead of taking the whole app down to a white page. The usual
 *  cause is a code chunk that can't be fetched: offline before that screen was ever opened, or an old copy of the app still
 *  open after a new version went live (its chunk names are gone). Back online, it reloads by itself. */
/** `page`: a whole screen (centred card). `onClose`: a pop-up (Shop, check-in…): the card shows as a pop-up too, with a
 *  Close that shuts whatever failed (in the app's grid it pushed the tab bar to mid-screen and couldn't be dismissed). */
export default class Boundary extends Component<{ children: ReactNode; page?: boolean; onClose?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("screen failed", error); }
  componentDidMount() { addEventListener("online", this.retry); }
  componentWillUnmount() { removeEventListener("online", this.retry); }
  retry = () => { if (this.state.failed) location.reload(); };
  render() {
    if (!this.state.failed) return this.props.children;
    const offline = !navigator.onLine, { onClose } = this.props;
    // Close shuts the pop-up first (its parent stops rendering what failed), then this card resets for the next one
    const close = onClose && (() => { onClose(); this.setState({ failed: false }); });
    const card = (
      <div className={`boundary${this.props.page ? " boundary-page" : ""}${close ? " modal" : ""}`} role="alert">
        {offline ? <WifiOff size={28} aria-hidden /> : <RotateCcw size={28} aria-hidden />}
        <b>{offline ? "You're offline" : "This part didn't load"}</b>
        <p className="fine">{offline ? "This screen needs a connection the first time you open it. It comes back by itself once you're online."
          : "A newer version of Giggles Maps may be out. Reload to get it."}</p>
        <div className="row tight">
          <button type="button" className="btn small" onClick={() => location.reload()}><RotateCcw size={15} aria-hidden /> Reload</button>
          {close && <button type="button" className="btn ghost small" onClick={close}>Close</button>}
        </div>
      </div>
    );
    return close ? <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>{card}</div> : card;
  }
}
