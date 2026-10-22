import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/app.css";
import "../styles/shop.css";
import Shop from "./Shop";

createRoot(document.getElementById("root")!).render(<Shop />);
