import { expect, test } from "@playwright/test";
import { login, sql } from "./helpers";

// SPEC §10 / §16: on a phone the app has a bottom navigation with Skanna in the middle, no horizontal scrolling, and
// a scanned or typed code opens the public machine card.
test("mobil: bottennavigering, Skanna och maskinkort utan sidoscroll", async ({ page }) => {
  await login(page, "berg@demo.se");
  const nav = page.locator("nav.bottennav");
  await expect(nav).toBeVisible();
  await expect(page.locator("aside.app-sida")).toBeHidden();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await nav.getByRole("button", { name: "Mer" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Maskiner" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  const [m] = await sql<{ reg_number: string }>(page, "select reg_number from public.machines where status = 'active' order by reg_number limit 1");
  await nav.getByRole("button", { name: "Skanna" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Skriv regnr eller märkeskod").fill(m!.reg_number);
  await dialog.getByRole("button", { name: "Öppna" }).click();
  await page.waitForURL(new RegExp(`/r/${m!.reg_number}`, "i"));
  await expect(page.locator("main")).toContainText(new RegExp(`${m!.reg_number.slice(0, 3)}\\W?${m!.reg_number.slice(3)}`));
  expect(await overflow()).toBeLessThanOrEqual(0);
});
