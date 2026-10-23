import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/app.css";
import App from "./App";
import Debug from "./Debug";

const debug = import.meta.env.DEV ? new URLSearchParams(location.search).get("debug") : null;
createRoot(document.getElementById("root")!).render(debug ? <Debug what={debug} /> : <App />);
// offline: keeps the app itself loadable with no signal (saved province maps cover the map)
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((e) => console.error("service worker", e));
