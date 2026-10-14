import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * The public site (maskinid.se) is a second build of the app's own source with only the public routes (ADR 0035).
 * No service worker, no in-browser database, no signed-in shell: sign-in and everything behind it live on the app.
 */
const web = fileURLToPath(new URL("../web/src", import.meta.url));
const noLocalBackend = fileURLToPath(new URL("./src/no-local-backend.ts", import.meta.url));

/** The app's backend selector imports the in-browser database statically; the site never uses it, so swap it out. */
function withoutLocalBackend(): Plugin {
  return {
    name: "maskinid-site-without-local-backend",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./local" && importer && /lib[\\/]backend[\\/]index\.ts$/.test(importer)) return noLocalBackend;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [withoutLocalBackend(), react()],
  resolve: { alias: { "@web": web } },
  envDir: "../..",
  define: {
    __DEMO_DB_VERSION__: JSON.stringify("none"),
    // Always the site, whatever the environment says.
    "import.meta.env.VITE_SURFACE": JSON.stringify("site"),
  },
  server: { port: 5174, fs: { allow: ["../.."] } },
  build: { sourcemap: true, outDir: "dist", emptyOutDir: true },
});
