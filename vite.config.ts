import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(dir, "src/web"),
  plugins: [react()],
  server: {
    proxy: {
      // `vite dev` (optional) proxies API calls to a running `spear serve`.
      "/api": "http://127.0.0.1:4317",
    },
  },
  build: {
    outDir: path.join(dir, "dist/web"),
    emptyOutDir: true,
  },
});
