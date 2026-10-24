import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// three pages: landing (static), traveller web app, shop dashboard.
// `--mode app` builds only the traveller app into dist-app/ for the iOS shell (Capacitor serves its index.html).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    outDir: mode === "app" ? "dist-app" : "dist",
    rollupOptions: {
      input: mode === "app" ? { app: resolve(__dirname, "app/index.html") } : {
        landing: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app/index.html"),
        shop: resolve(__dirname, "shop/index.html"),
      } as Record<string, string>,
    },
  },
}));
