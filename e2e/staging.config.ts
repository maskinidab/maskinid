import { defineConfig, devices } from "@playwright/test";

/**
 * The test-guide walkthrough against the deployed staging app (e2e/staging/*.staging.ts). Separate from the main
 * suite, which runs on the in-browser database: this one writes to the shared staging project, so it is run by
 * hand (`npm run test:staging`), never in CI.
 */
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./staging",
  testMatch: /.*\.staging\.ts/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: "../test-results/staging",
  reporter: [["list"]],
  use: {
    baseURL: process.env.STAGING_URL ?? "https://maskinid-git-staging-maskinid.vercel.app",
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: { executablePath },
  },
});
