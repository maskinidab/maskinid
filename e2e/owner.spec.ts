import { expect, test } from "@playwright/test";
import { login, logout, nameplatePng, PDF_FIXTURE, sql, uniqueSerial } from "./helpers";

// SPEC §16.14: photograph the nameplate (mock OCR) → register → upload invoice → verification queue → level 1 →
// share a report link → the link shows the history and stops working when it expires.
test("ägare: skylt-OCR, registrering, faktura, nivå 1, delningslänk som går ut", async ({ page }) => {
  let base = await login(page, "berg@demo.se");
  const serial = uniqueSerial("OCR");
  await page.goto(`${base}/machines/new`);
  await expect(page.getByText("Steg 1 av 4")).toBeVisible();
  await page.locator('input[type=file][capture]').first().setInputFiles({ name: "skylt.png", mimeType: "image/png",
    buffer: nameplatePng({ make: "Liebherr", model: "R 926", serial, year: 2020 }) });
  const suggestions = page.locator("[aria-live=polite]");
  await expect(suggestions.getByText(serial)).toBeVisible();
  for (let i = 0; i < 4; i++) {
    const use = suggestions.getByRole("button", { name: "Använd" }).first();
    if (await use.count()) await use.click();
  }
  await expect(page.locator("input.is-id").first()).toHaveValue(serial);
  await page.locator("main button[type=submit]").click();
  await expect(page.getByLabel("Tillverkare")).toHaveValue("Liebherr");
  await page.getByLabel("Kategori").selectOption("excavator_tracked");
  for (let i = 0; i < 3; i++) await page.locator("main button[type=submit]").click();
  await expect(page.getByText("Maskinen är registrerad")).toBeVisible();
  const [m] = await sql<{ id: string; reg_number: string; verification_level: number }>(page, `select m.id, m.reg_number, m.verification_level from public.machines m
    join public.machine_identifiers i on i.machine_id = m.id where i.value = $1`, [serial]);
  expect(m.verification_level).toBe(0);

  await page.getByRole("button", { name: "Ladda upp faktura" }).click();
  await page.locator("#doktyp").selectOption("invoice");
  await page.locator('main input[type=file]:not([capture])').first().setInputFiles({ name: "faktura.pdf", mimeType: "application/pdf", buffer: PDF_FIXTURE });
  await expect.poll(async () => (await sql<{ n: number }>(page, "select count(*)::int n from public.documents where machine_id = $1 and type = 'invoice' and status in ('clean', 'scanning')", [m.id]))[0].n).toBe(1);
  await page.goto(`${base}/machines/${m.id}`);
  await expect.poll(async () => (await sql<{ n: number }>(page, "select count(*)::int n from public.documents where machine_id = $1 and type = 'photo_nameplate' and status in ('clean', 'scanning')", [m.id]))[0].n).toBe(1);
  await page.getByRole("button", { name: "Höj verifieringsnivå" }).click();
  await expect(page.locator("dialog[open]").getByText("faktura.pdf")).toBeVisible();
  await page.locator("dialog[open]").getByRole("button", { name: "Skicka förfrågan" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const [req] = await sql<{ id: string }>(page, "select id from public.verification_requests where machine_id = $1 and status = 'open'", [m.id]);

  await logout(page);
  const admin = await login(page, "admin@demo.se");
  await page.goto(`${admin}/verify/${req.id}`);
  await page.getByRole("button", { name: "Godkänn" }).click();
  await expect.poll(async () => (await sql<{ l: number }>(page, "select verification_level l from public.machines where id = $1", [m.id]))[0].l).toBe(1);

  await logout(page);
  base = await login(page, "berg@demo.se");
  await page.goto(`${base}/machines/${m.id}`);
  await page.getByRole("button", { name: "Dela", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByText("Maskinkort, historik och om förbehåll finns").click();
  await dialog.getByRole("button", { name: "Skapa länk" }).click();
  const link = await dialog.getByLabel("Delningslänk").inputValue();
  expect(link).toContain("/s/");

  // The buyer opens the link without an account (same browser, so the same in-browser register).
  await logout(page);
  await page.goto(link);
  await expect(page.getByText(m.reg_number.slice(3)).first()).toBeVisible();
  await expect(page.locator("main")).toContainText(/registrer/i);
  await sql(page, "update public.share_links set expires_at = now() - interval '1 minute' where machine_id = $1", [m.id]);
  await page.goto(link);
  await expect(page.locator("main")).toContainText(/gått ut|ogiltig/i);
});
