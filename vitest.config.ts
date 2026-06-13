import { defineConfig } from "vitest/config";

// Dedicated test config so the Vite app config (root: src/web) doesn't hijack
// the test root. Server/CLI tests live under src/ and run in Node.
export default defineConfig({
  test: {
    root: ".",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/web/**", "node_modules/**", "dist/**"],
  },
});
