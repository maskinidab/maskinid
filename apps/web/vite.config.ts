import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
// @ts-expect-error – plain ESM helper
import { demoDbVersion } from "./scripts/demo-db.mjs";

// `--mode demo` builds a self-contained demo (hash routing, in-browser database). See scripts/build-demo.mjs.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "MaskinID",
        short_name: "MaskinID",
        description: "Registret för tunga arbetsmaskiner",
        lang: "sv",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#000000",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [{ name: "Skanna", short_name: "Skanna", url: "/scan" }],
      },
      workbox: {
        // App shell offline; the demo database and wasm are large and cached at runtime instead.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["**/demo-db/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/, /^\/embed/],
        runtimeCaching: [
          { urlPattern: /\/demo-db\//, handler: "CacheFirst", options: { cacheName: "demo-db" } },
          { urlPattern: /\.(wasm|data)$/, handler: "CacheFirst", options: { cacheName: "pglite" } },
        ],
      },
    }),
  ],
  base: mode === "demo" ? "./" : "/",
  envDir: "../..",
  define: { __DEMO_DB_VERSION__: JSON.stringify(demoDbVersion()) },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  build: mode === "demo" ? { outDir: "dist-demo", emptyOutDir: true } : { sourcemap: true },
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
}));
