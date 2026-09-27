import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite (SPEC §16 points 13–17, interpreted points 18–26 – step 27). Runs the web app with the local
 * in-browser database (PGlite, demo seed), so it needs no backend: each test gets a fresh browser context and thus a
 * fresh copy of the demo register. CHROMIUM_PATH points at a preinstalled Chromium when browsers are not downloaded.
 */
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  // dealer.spec.ts walks a whole dealer flow in one test (registration, import, labels, sale with financier,
  // ownership certificate) and lands right on 300s, so it times out on a loaded two-core runner. Give it room.
  timeout: 600_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // One worker. Every test boots a full Postgres (WASM) in the browser, and two of those on a two-core runner
  // thrash: the suite failed a different test on each run and took 17-23 min. Serially it passes in 5.
  workers: 1,
  // These tests drive a real database in the browser, so a slow runner can push a whole test past its budget.
  // Retry on CI rather than let a timing blip turn the pipeline red; a test that fails every attempt is a real bug.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "../playwright-report" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev",
    // Pin the data source: the suite needs the in-browser demo register, and a developer .env pointing
    // VITE_DATA_SOURCE at a Supabase project would otherwise make every test fail at login.
    env: { VITE_DATA_SOURCE: "local", VITE_DEMO_MODE: "true" },
    cwd: "..",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 480_000,
  },
});
