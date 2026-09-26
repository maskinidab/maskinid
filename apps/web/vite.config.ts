import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `--mode demo` builds a self-contained demo (hash routing, in-browser database). See scripts/build-demo.mjs.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "demo" ? "./" : "/",
  envDir: "../..",
  build: mode === "demo" ? { outDir: "dist-demo", emptyOutDir: true } : undefined,
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
