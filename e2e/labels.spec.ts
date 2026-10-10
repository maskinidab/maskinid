import { expect, test } from "@playwright/test";
import { login, logout, sql, uniqueSerial } from "./helpers";

/**
 * The QR märke, end to end (ADR 0028).
 *
 * Seeded label codes come from a CSPRNG, so every code has to be read out of the database rather than
 * hardcoded. Useful seed facts (supabase/seed/10_machines.sql:88-93): batch 1 is 100 labels assigned to
 * nordmaskin-ab, batch 2 is 50 unassigned ones that any org may bind, batch 3 is 50 for entreprenadcenter-syd.
 */

test("märken: organisationen ser QR-koden och kan skriva ut ett ark", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  const [l] = await sql<{ serial: string }>(page, `
    select right(l.code, 6) serial from public.labels l
    join public.organizations o on o.id = l.assigned_org_id
    where o.slug = 'nordmaskin-ab' and l.machine_id is null and l.status = 'assigned'
    order by l.code limit 1`);
  expect(l, "an unused label assigned to the dealer").toBeTruthy();

  await page.goto(`${base}/labels`);
  const row = page.locator("main tbody tr").filter({ hasText: l.serial }).first();
  await row.getByRole("button", { name: "Visa QR" }).click();
  const dialog = page.locator("dialog[open]");
  // A real QR, and the six characters that are printed on the sticker so you can match it by hand.
  await expect(dialog.getByRole("img", { name: new RegExp(l.serial) })).toBeVisible();
  await expect(dialog.getByText(l.serial, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Stäng" }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Skriv ut ark (PDF)" }).click();
  expect((await download).suggestedFilename()).toBe("marken.pdf");
});

test("märken: maskinsidan visar märkets QR men aldrig hela koden", async ({ page }) => {
  const base = await login(page, "berg@demo.se");
  const [m] = await sql<{ id: string; code: string; serial: string }>(page, `
    select m.id, l.code, right(l.code, 6) serial from public.machines m
    join public.labels l on l.machine_id = m.id and l.status = 'bound' and l.role = 'primary'
    join public.organizations o on o.id = m.owner_org_id
    where o.slug = 'bergs-schakt-entreprenad-ab' and m.status = 'active'
    order by m.reg_number limit 1`);
  expect(m, "one of our machines with a bound label").toBeTruthy();

  await page.goto(`${base}/machines/${m.id}`);
  const main = page.locator("main");
  await expect(main.getByRole("img", { name: new RegExp(m.serial) })).toBeVisible();
  // The full 22-character code is the bearer secret inside the QR URL and must not be on screen as text.
  await expect(main).not.toContainText(m.code);
  await expect(main.getByText(m.serial, { exact: false }).first()).toBeVisible();
});

/**
 * The demo: put a fresh märke on a machine, scan it, and register the machine. Scanning an unused märke used
 * to dead-end on "finns inte i registret" because the register could not tell a fresh label from a code that
 * is not ours.
 */
test("märken: skanna ett oanvänt märke och registrera maskinen", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  const [l] = await sql<{ code: string; serial: string }>(page, `
    select code, right(code, 6) serial from public.labels
    where machine_id is null and assigned_org_id is null and status = 'printed' order by code limit 1`);
  expect(l, "an unassigned, unused label").toBeTruthy();

  // This is what the phone camera lands on.
  await page.goto(`/m/${l.code}`);
  await expect(page.getByText("Märket är inte kopplat till någon maskin än")).toBeVisible();
  await expect(page.getByText(`Märke ${l.serial}`)).toBeVisible();
  await page.getByRole("link", { name: /Registrera i/ }).click();
  await page.waitForURL(new RegExp(`/machines/new\\?.*code=${l.code}`));

  // The märke follows into the wizard and is shown as attached, with its QR.
  await expect(page.getByText(`Märke ${l.serial} kopplas till maskinen`)).toBeVisible();
  const serial = uniqueSerial("QR");
  await page.getByRole("textbox", { name: "Serienummer" }).fill(serial);
  await page.locator("main button[type=submit]").click();
  await page.getByLabel("Tillverkare").fill("Volvo");
  await page.getByLabel("Modell", { exact: true }).fill("EC220E");
  await page.getByLabel("Kategori").selectOption("excavator_tracked");
  await page.locator("main button[type=submit]").click();
  await page.locator("main button[type=submit]").click();
  await expect(page.getByText("Märket är ledigt.")).toBeVisible();
  await page.locator("main button[type=submit]").click();

  await expect(page.getByText("Maskinen är registrerad")).toBeVisible({ timeout: 60_000 });
  // No "the label could not be attached" notice, and the register agrees.
  await expect(page.getByText("märket kunde inte kopplas", { exact: false })).toHaveCount(0);
  const [bound] = await sql<{ status: string; reg_number: string }>(page, `
    select l.status, m.reg_number from public.labels l join public.machines m on m.id = l.machine_id
    where l.code = $1`, [l.code]);
  expect(bound.status).toBe("bound");

  // Scanning the same märke now opens the machine.
  await page.goto(`/m/${l.code}`);
  await expect(page.locator("main, .publik-maskin").getByText(bound.reg_number.replace(/^(...)/, "$1-"))).toBeVisible();
  void base;
});

/**
 * The same scan while signed out. This crosses three separate URL whitelists (EmailEntry, LoginPage and
 * OnboardingPage), so it is the test most likely to catch a regression in the round trip.
 */
test("märken: ett skannat märke följer med genom inloggningen", async ({ page }) => {
  await login(page, "nordmaskin@demo.se");
  const [l] = await sql<{ code: string }>(page, `
    select code from public.labels
    where machine_id is null and assigned_org_id is null and status = 'printed' order by code desc limit 1`);
  expect(l).toBeTruthy();
  await logout(page);

  await page.goto(`/m/${l.code}`);
  await expect(page.getByText("Märket är inte kopplat till någon maskin än")).toBeVisible();
  await page.getByRole("link", { name: "Registrera maskinen" }).click();
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel("E-postadress").fill("nordmaskin@demo.se");
  await page.getByLabel("Lösenord").fill("demo1234");
  await page.locator('form button[type="submit"]').click();
  // Lands in the wizard with the code byte-identical, not on the dashboard.
  await page.waitForURL(new RegExp(`/o/[^/]+/machines/new\\?code=${l.code}$`), { timeout: 180_000 });
});
