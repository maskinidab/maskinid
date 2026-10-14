import { expect, test, type Page } from "@playwright/test";
import { financingPdf, signDemo } from "../helpers";

/**
 * Test-guide rounds 8–13 against the deployed staging app and its real Supabase project, driven only through the
 * UI (there is no in-browser database to query here). Run with `npm run test:staging`.
 *
 * It changes staging data, so it is written to stay off the guide's scenario machines: round 8 finances a
 * Nordmaskin machine that no round names (R8_SERIAL), round 12 runs the payoff on one of Bergs' bank-financed
 * machines other than JCB3CX04278 (R12_SERIAL), and rounds 10 and 13 revoke the consent they create. After a run,
 * those two machines are no longer in their seeded state; reseed (docs/TESTGUIDE.md §5) before a demo.
 */
const R8_SERIAL = process.env.R8_SERIAL ?? "PONBUFFAL12915";
const R12_SERIAL = process.env.R12_SERIAL ?? "LHRR92630256";
const PASSWORD = "demo1234";

test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/o\/[^/]+\/dashboard/, { timeout: 60_000 });
  return new URL(page.url()).pathname.replace(/\/dashboard.*$/, "");
}

async function logout(page: Page): Promise<void> {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto("/");
}

/** Ctrl+K search; returns the open dialog. */
async function search(page: Page, q: string) {
  await page.getByRole("button", { name: /Sök regnr eller serienummer/ }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("textbox", { name: "Sök regnr eller serienummer" }).fill(q);
  await dialog.getByRole("button", { name: "Sök" }).click();
  return dialog;
}

/** Opens a machine the signed-in org has a relation to, by serial, and returns its id. */
async function openMachine(page: Page, serial: string): Promise<string> {
  const dialog = await search(page, serial);
  await dialog.locator(".sokresultat button.sokresultat-rad").first().click();
  await page.waitForURL(/\/machines\/[0-9a-f-]{36}/);
  return page.url().match(/machines\/([0-9a-f-]{36})/)![1];
}

test("runda 8: finanssnurran, obligatoriskt avtalsnummer, villkoren bara för ägare och långivare", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  const id = await openMachine(page, R8_SERIAL);
  await page.goto(`${base}/machines/${id}?tab=financing`);
  await page.getByRole("tabpanel", { name: "Förbehåll" }).getByRole("button", { name: "Lägg in finansiering manuellt" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("combobox", { name: "Långivare" }).selectOption({ label: "Nordic Finance (demo)" });
  await expect(dialog.getByLabel("Avtalsreferens")).toHaveValue("NF-");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog.getByText("Avtalsnummer krävs.")).toBeVisible();

  await dialog.getByLabel("Avtalsreferens").fill("NF-STAGING-8");
  await dialog.getByLabel("Finansieringsbelopp").fill("1250000");
  await dialog.getByLabel("Kontantinsats").fill("250000");
  await dialog.getByLabel("Restvärde").fill("200000");
  await dialog.getByLabel("Amorteringstid (mån)").fill("60");
  await dialog.getByLabel("Ränta (%)").fill("6.45");
  await expect(dialog.getByText(/16\s*709\s*kr/)).toBeVisible();
  await expect(dialog.getByText(/1\s*000\s*000\s*kr/)).toBeVisible();
  await dialog.locator("button[type=submit]").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByText("Belåning anmäld").first()).toBeVisible();

  // The bank confirms from its inbox and sees the same figures.
  await logout(page);
  const bank = await login(page, "nordic@demo.se");
  await page.goto(`${bank}/inbox`);
  await page.getByRole("listitem").filter({ hasText: "Förbehåll att bekräfta" }).first().getByRole("link", { name: "Hantera" }).click();
  await page.waitForURL(/tab=financing/);
  await expect(page.getByText(/1\s*250\s*000/).first()).toBeVisible();
  await page.getByRole("button", { name: "Bekräfta förbehållet" }).click();
  await expect(page.getByText("Belånad").first()).toBeVisible();

  // Another dealer sees that it is financed, but none of the figures.
  await logout(page);
  await login(page, "syd@demo.se");
  const hit = await search(page, R8_SERIAL);
  await expect(hit.getByText("Belånad")).toBeVisible();
  await expect(hit.getByText(/1\s*250\s*000/)).toHaveCount(0);
});

test("runda 9: inbytestest på någon annans maskin, och på en okänd", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  await page.goto(`${base}/tradein-check`);
  await page.getByLabel("Serienummer, PIN eller VIN").fill("JCB3CX04278");
  await page.locator("main form button[type=submit]").first().click();
  await expect(page.getByText("Belånad").first()).toBeVisible();
  await page.getByRole("button", { name: "Markera alla OK" }).click();
  const leak = page.getByRole("listitem").filter({ hasText: "Inga hydraulläckage" });
  await leak.getByRole("radio", { name: "Fel" }).click();
  await leak.getByLabel("Beskriv felet").fill("Läckage vid bomcylinder (staging-test)");
  await page.getByLabel("Timmätare").fill("1800");
  await page.getByLabel("Bedömning").fill("Staging-test, prisavdrag");
  await page.getByRole("button", { name: "Spara inbytestest" }).click();
  await expect(page.getByText("Inbytestestet är sparat med allvarliga fel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Begär inbyte" }).or(page.getByRole("link", { name: "Begär inbyte" })).first()).toBeVisible();

  await page.goto(`${base}/tradein-check`);
  await page.getByLabel("Serienummer, PIN eller VIN").fill("OKAND-123");
  await page.locator("main form button[type=submit]").first().click();
  await page.getByRole("button", { name: "Markera alla OK" }).click();
  await page.getByRole("button", { name: "Spara inbytestest" }).click();
  await expect(page.getByText("Inbytestestet är sparat", { exact: false })).toBeVisible();
});

test("runda 10: enskild firma söker, ber om historiken, ägaren godkänner och återkallar", async ({ page }) => {
  const lena = await login(page, "lena@demo.se");
  // Rerun-safe: withdraw any request an earlier, interrupted run left open.
  await page.goto(`${lena}/mandates`);
  // Lena has rows from earlier runs; wait for the list itself before counting what is still open.
  await page.locator("main table tbody tr").first().waitFor().catch(() => {});
  const open = page.getByRole("button", { name: "Dra tillbaka" });
  while (await open.count()) { await open.first().click(); await page.waitForTimeout(1500); }
  await page.goto(`${lena}/dashboard`);
  let hit = await search(page, "JCB3CX04278");
  await expect(hit.getByText("Belånad")).toBeVisible();
  await expect(hit.getByText("Demo Bank Finans")).toHaveCount(0);
  await hit.getByRole("button", { name: "Begär full historik" }).click();
  const ask = page.locator("dialog[open]").last();
  await ask.getByLabel("Varför behöver ni åtkomst?").fill("Staging-test");
  await ask.getByRole("button", { name: "Skicka" }).click();
  await expect(page.getByText("Förfrågan är skickad till maskinens ägare")).toBeVisible();

  // It does not vanish, and it does not name the owner.
  await page.goto(`${lena}/dashboard`);
  hit = await search(page, "JCB3CX04278");
  await expect(hit.getByText("väntar på ägarens godkännande", { exact: false })).toBeVisible();
  await page.goto(`${lena}/mandates`);
  const newest = page.locator("main table tbody tr").first();
  await expect(newest.getByRole("cell", { name: "Från maskinens ägare" })).toBeVisible();
  await expect(newest.getByText("Bergs Schakt", { exact: false })).toHaveCount(0);

  await logout(page);
  const berg = await login(page, "berg@demo.se");
  await page.goto(`${berg}/inbox`);
  await page.getByRole("listitem").filter({ hasText: "Lena Grävmaskin" }).getByRole("button", { name: "Hantera" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Godkänn åtkomst" }).click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await logout(page);
  await login(page, "lena@demo.se");
  await page.goto(`${lena}/mandates`);
  const granted = page.locator("main table tbody tr").first();
  await expect(granted.getByRole("cell", { name: /Bergs Schakt/ })).toBeVisible();
  await granted.getByRole("link").first().click();
  await page.waitForURL(/\/machines\/[0-9a-f-]{36}/);
  await page.goto(`${page.url().split("?")[0]}?tab=history`);
  await expect(page.locator(".tidslinje li").first()).toBeVisible();
  await expect(page.getByText("Finansieringsbelopp")).toHaveCount(0);

  // Berg takes it back.
  await logout(page);
  await login(page, "berg@demo.se");
  await page.goto(`${berg}/mandates`);
  const lenaRow = page.getByRole("row").filter({ hasText: "Lena Grävmaskin" }).first();
  await lenaRow.getByRole("button", { name: "Återkalla" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Lena Grävmaskin" }).first().getByText("Återkallad")).toBeVisible();
});

test("runda 11: handlarvyn och modulerna", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  const menu = page.getByRole("navigation", { name: "Huvudmeny" });
  await expect(menu.getByRole("link", { name: "Inbytestest" })).toBeVisible();
  for (const gone of ["Daglig kontroll", "Uthyrning", "Bränsle & klimat", "Förare"]) {
    await expect(menu.getByRole("link", { name: gone }), gone).toHaveCount(0);
  }
  await page.goto(`${base}/rentals`);
  await expect(page.getByText("Uthyrning är inte aktiverad för er organisation")).toBeVisible();
  await page.goto(`${base}/settings?tab=modules`);
  await expect(page.getByRole("listitem").filter({ hasText: "Uthyrning" }).getByRole("switch")).toBeVisible();

  await logout(page);
  await login(page, "berg@demo.se");
  for (const kept of ["Daglig kontroll", "Uthyrning", "Bränsle & klimat", "Förare"]) {
    await expect(menu.getByRole("link", { name: kept }), kept).toBeVisible();
  }
});

test("runda 12: lösenbeskedet öppnas för handlaren, och banken får en bekräftelse", async ({ page }) => {
  let base = await login(page, "nordmaskin@demo.se");
  await page.goto(`${base}/trade-in`);
  await page.getByText("Lägg in serienummer manuellt").click();
  await page.getByLabel("Serienummer, PIN eller VIN").fill(R12_SERIAL);
  await page.locator("main form button[type=submit]").click();
  await expect(page.getByText("Demo Bank Finans", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Begär inbyte" }).click();
  await expect(page.getByText("Förfrågan skickad", { exact: false })).toBeVisible();

  await logout(page);
  base = await login(page, "bank@demo.se");
  await page.goto(`${base}/inbox`);
  await page.getByRole("listitem").filter({ hasText: "Lösen att besvara" }).first().getByRole("link", { name: "Hantera" }).click();
  await page.waitForURL(/tab=financing/);
  const machineUrl = page.url().split("?")[0];
  await page.getByRole("button", { name: "Skicka lösenbesked" }).click();
  const quote = page.locator("dialog[open]");
  await quote.locator("input[type=file]").first().setInputFiles({
    name: "losenbesked.pdf", mimeType: "application/pdf", buffer: financingPdf({ document_kind: "payoff_statement", contract_ref: "LOSEN-STAGING-12" }),
  });
  await expect(quote.getByText("losenbesked.pdf", { exact: false })).toBeVisible();
  await quote.getByLabel("Referens").fill("LOSEN-STAGING-12");
  await quote.getByLabel("Giltigt t.o.m.").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await quote.locator("button[type=submit]").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await logout(page);
  base = await login(page, "nordmaskin@demo.se");
  await page.goto(`${base}/trade-in`);
  await page.getByText("Lägg in serienummer manuellt").click();
  await page.getByLabel("Serienummer, PIN eller VIN").fill(R12_SERIAL);
  await page.locator("main form button[type=submit]").click();
  await expect(page.getByText("Lösenbesked mottaget")).toBeVisible();
  // The reported defect: opening it said "ingen behörighet".
  const popup = page.waitForEvent("popup", { timeout: 15_000 }).catch(() => null);
  await page.getByRole("button", { name: "Öppna lösenbesked" }).click();
  await popup;
  await expect(page.locator("main").getByText("behörighet", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Ladda upp lösenbevis" }).click();
  const settle = page.locator("dialog[open]");
  await settle.locator("input[type=file]").first().setInputFiles({
    name: "losenbevis.pdf", mimeType: "application/pdf", buffer: financingPdf({ document_kind: "payoff_statement" }),
  });
  await expect(settle.getByText("losenbevis.pdf", { exact: false })).toBeVisible();
  await settle.locator("button[type=submit]").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // The second defect: releasing made the page behind the dialog a permission error.
  await logout(page);
  await login(page, "bank@demo.se");
  await page.goto(`${machineUrl}?tab=financing`);
  await page.getByRole("button", { name: "Godkänn lösen och släpp spärren" }).click();
  await page.locator("dialog[open] button[type=submit]").click();
  await signDemo(page);
  await expect(page.locator("dialog[open]").getByText("Spärren släppt", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("behörighet", { exact: false })).toHaveCount(0);
  await page.locator("dialog[open]").getByRole("link", { name: "Portfölj" }).click();
  await expect(page).toHaveURL(/portfolio/);
});

test("runda 13: bankens insyn i en maskinflotta, och priserna", async ({ page }) => {
  const bank = await login(page, "bank@demo.se");
  await page.goto(`${bank}/portfolio`);
  await page.getByRole("button", { name: "Begär insyn i maskinflottan" }).click();
  const ask = page.locator("dialog[open]");
  await ask.getByLabel("Företagets organisationsnummer").fill("556701-2009");
  await ask.getByRole("button", { name: "Skicka" }).click();
  await expect(ask.getByText("Förfrågan är skickad till företaget")).toBeVisible();

  await logout(page);
  const berg = await login(page, "berg@demo.se");
  await page.goto(`${berg}/inbox`);
  await page.getByRole("listitem").filter({ hasText: "Demo Bank Finans" }).filter({ hasText: "Begäran om åtkomst" })
    .getByRole("button", { name: "Hantera" }).click();
  await expect(page.locator("dialog[open]").getByText("hela er maskinflotta", { exact: false })).toBeVisible();
  await page.locator("dialog[open]").getByRole("button", { name: "Godkänn åtkomst" }).click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await logout(page);
  await login(page, "bank@demo.se");
  await page.goto(`${bank}/machines?scope=shared`);
  await expect(page.getByRole("tab", { name: "Delade med oss" })).toBeVisible();
  // Bergs Schakt has a dozen machines; the bank finances only a few of them.
  await expect(page.locator("main table tbody tr").nth(9)).toBeVisible();

  // Berg takes it back, and the list empties.
  await logout(page);
  await login(page, "berg@demo.se");
  await page.goto(`${berg}/mandates`);
  await page.getByRole("row").filter({ hasText: "Demo Bank Finans" }).first().getByRole("button", { name: "Återkalla" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Demo Bank Finans" }).first().getByText("Återkallad")).toBeVisible();

  // Prices are off: no link anywhere for a visitor, /pricing goes home, no Betalning tab.
  await logout(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Priser/ })).toHaveCount(0);
  await page.goto("/pricing");
  await expect(page).toHaveURL(/\/$/);
  const dealer = await login(page, "nordmaskin@demo.se");
  await page.goto(`${dealer}/settings`);
  await expect(page.getByRole("tab", { name: "Betalning" })).toHaveCount(0);
});
