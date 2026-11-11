import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/app.css";
import "../styles/shop.css";
import { installI18n } from "../lib/i18n";
import Shop from "./Shop";

// Thai (the default here) loads its dictionary before the first render, so the page never flashes English first
void installI18n().catch((e) => console.error("thai", e))
  .finally(() => createRoot(document.getElementById("root")!).render(<Shop />));
