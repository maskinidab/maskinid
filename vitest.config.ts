import { defineConfig } from "vitest/config";

// Unit tests for all workspaces. Database tests have their own config (supabase/tests/vitest.config.ts).
export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", root: "packages/shared", include: ["src/**/*.test.ts"], environment: "node" } },
      { test: { name: "ingest", root: "apps/ingest", include: ["src/**/*.test.ts"], environment: "node" } },
      "apps/web/vite.config.ts",
    ],
  },
});
