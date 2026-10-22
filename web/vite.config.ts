import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// three pages: landing (static), traveller web app, shop dashboard
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app/index.html"),
        shop: resolve(__dirname, "shop/index.html"),
      },
    },
  },
});
