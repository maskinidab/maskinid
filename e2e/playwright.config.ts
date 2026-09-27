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
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: 0,
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
    cwd: "..",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 480_000,
  },
});
