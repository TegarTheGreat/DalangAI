import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * App UI (browser). Server API berjalan terpisah (src/server, via
 * `dalang studio`); saat dev, semua path non-app diproksikan ke sana.
 * `assetsDir: "app"` — path `/assets/*` sudah dipakai aset milik plan proyek.
 */

const API = `http://localhost:${process.env.DALANG_STUDIO_PORT ?? 4646}`;

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist",
    assetsDir: "app",
  },
  server: {
    proxy: {
      "/api": API,
      "/fonts": API,
      "/assets": API,
      "/.dalang": API,
    },
  },
});
