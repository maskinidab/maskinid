import { defineConfig } from "vitest/config";

// RLS and RPC tests against a local database (see supabase/scripts/local-db.mjs).
// DB_RESET=0 skips the reset when iterating on tests only.
export default defineConfig({
  test: {
    name: "db",
    root: new URL(".", import.meta.url).pathname,
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    globalSetup: ["./global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
