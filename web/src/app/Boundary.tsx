import { Component, type ReactNode } from "react";
import { RotateCcw, WifiOff } from "lucide-react";

/** A screen that fails to load or crashes shows this card instead of taking the whole app down to a white page. The usual
 *  cause is a code chunk that can't be fetched: offline before that screen was ever opened, or an old copy of the app still
 *  open after a new version went live (its chunk names are gone). Back online, it reloads by itself. */
export default class Boundary extends Component<{ children: ReactNode; page?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("screen failed", error); }
  componentDidMount() { addEventListener("online", this.retry); }
  componentWillUnmount() { removeEventListener("online", this.retry); }
  retry = () => { if (this.state.failed) location.reload(); };
  render() {
    if (!this.state.failed) return this.props.children;
    const offline = !navigator.onLine;
    return (
      <div className={`boundary${this.props.page ? " page" : ""}`} role="alert">
        {offline ? <WifiOff size={28} aria-hidden /> : <RotateCcw size={28} aria-hidden />}
        <b>{offline ? "You're offline" : "This part didn't load"}</b>
        <p className="fine">{offline ? "This screen needs a connection the first time you open it. It comes back by itself once you're online."
          : "A newer version of Giggles Maps may be out. Reload to get it."}</p>
        <button type="button" className="btn small" onClick={() => location.reload()}><RotateCcw size={15} aria-hidden /> Reload</button>
      </div>
    );
  }
}
