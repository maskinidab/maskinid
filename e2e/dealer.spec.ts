import { expect, test, type Page } from "@playwright/test";
import { login, logout, PASSWORD, PDF_FIXTURE, signDemo, sql } from "./helpers";

/** A valid Swedish organisation number (Luhn) that is not in the demo register. */
function newOrgNumber(): string {
  const base = `55990${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const sum = [...base].reduce((s, c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); if (d > 9) d -= 9; return s + d; }, 0);
  const n = base + ((10 - (sum % 10)) % 10);
  return `${n.slice(0, 6)}-${n.slice(6)}`;
}

async function importCsv(page: Page, base: string, tag: string) {
  const header = "Serienummer;Tillverkare;Modell;Årsmodell;Kategori;Timmar";
  const rows = Array.from({ length: 20 }, (_, i) => {
    if (i === 5) return ["", "Volvo", "EC220E", "2019", "Grävmaskin", "3400"];          // no serial
    if (i === 9) return [`${tag}X${i}`, "", "EC220E", "2019", "Grävmaskin", "3400"];    // no make
    return [`${tag}X${i}`, i % 2 ? "Volvo" : "Caterpillar", i % 2 ? "EC220E" : "320", "2019", i % 3 ? "Grävmaskin" : "Hjullastare", "3400"];
  });
  await page.goto(`${base}/import`);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "lager.csv", mimeType: "text/csv",
    buffer: Buffer.from([header, ...rows.map((r) => r.join(";"))].join("\n")) });
  await expect(page.getByText("Vilken kolumn är vad")).toBeVisible();
  await page.getByRole("button", { name: "Kontrollera raderna" }).click();
  await expect(page.getByRole("heading", { name: "Kontroll rad för rad" })).toBeVisible();
  await page.locator("main").getByRole("button", { name: "Importera bara giltiga rader (18)" }).click();
  await expect(page.getByText("18 maskiner importerade")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/2 rader importerades inte/)).toBeVisible();
}

// SPEC §16.13: dealer signs up → organisation → import 20 rows (2 with errors) → 18 machines → order labels → sells a
// machine to a buyer with a lender → the buyer gets e-mail and accepts → the lender confirms → ownership certificate
// PDF with the right reg number and QR code.
test("handlare: registrering, import, märken, försäljning med finansiär, ägarbevis", async ({ page }) => {
  const email = `handlare-${Date.now()}@e2e.se`;
  const orgNumber = newOrgNumber();
  await page.goto("/signup");
  await page.getByLabel("Namn").fill("Hanna Handlare");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(PASSWORD);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 180_000 });
  await page.getByRole("button", { name: "Verifiera med Demo-BankID" }).click();
  await page.locator("#orgnr").fill(orgNumber);
  await page.getByRole("button", { name: "Slå upp" }).click();
  await page.getByRole("checkbox", { name: /Maskinhandlare/ }).check();
  await page.getByText(/Jag godkänner personuppgiftsbiträdesavtalet/).click();
  await page.getByRole("button", { name: "Lägg till organisationen" }).click();
  await page.waitForURL(/\/o\/[^/]+\/dashboard/);
  const base = new URL(page.url()).pathname.replace(/\/dashboard.*$/, "");
  const [org] = await sql<{ id: string; status: string }>(page, "select id, status from public.organizations where org_number = $1", [orgNumber]);
  expect(org.status).toBe("pending");

  // Dealers are reviewed before they can sell (SPEC §2.2).
  await logout(page);
  const admin = await login(page, "admin@demo.se");
  await page.goto(`${admin}/admin/organizations/${org.id}`);
  await page.getByRole("button", { name: "Godkänn" }).click();
  await expect.poll(async () => (await sql<{ status: string }>(page, "select status from public.organizations where id = $1", [org.id]))[0].status).toBe("approved");
  await logout(page);
  await page.goto("/login");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/o\/[^/]+\/dashboard/, { timeout: 180_000 });
  // A new user accepts the current legal documents before continuing (SPEC §20.10); the acceptance is recorded.
  const terms = page.getByRole("dialog").filter({ hasText: "Uppdaterade villkor" });
  await terms.getByRole("checkbox").check();
  await terms.getByRole("button", { name: "Godkänn och fortsätt" }).click();
  await expect(terms).toHaveCount(0);
  expect((await sql<{ n: number }>(page, `select count(*)::int n from public.legal_acceptances a join public.profiles p on p.user_id = a.user_id
    where p.email = $1`, [email]))[0].n).toBeGreaterThanOrEqual(3);

  const tag = `E2E${Date.now().toString(36).toUpperCase()}`;
  await importCsv(page, base, tag);
  const [{ n }] = await sql<{ n: number }>(page, `select count(*)::int n from public.machines m where m.registered_by_org_id = $1 and m.status <> 'draft'`, [org.id]);
  expect(n).toBe(18);

  await page.goto(`${base}/labels`);
  await page.locator("main form").getByLabel("Adress").fill("Industrivägen 1");
  await page.locator("main form").getByLabel("Ort").fill("Västerås");
  await page.locator("main form").getByRole("button", { name: /Beställ/ }).click();
  await expect(page.getByText(/beställda|beställning/i).first()).toBeVisible();
  expect((await sql<{ n: number }>(page, "select count(*)::int n from public.label_batches where ordered_by_org_id = $1", [org.id]))[0].n).toBe(1);

  const [m] = await sql<{ id: string; reg_number: string }>(page, `select m.id, m.reg_number from public.machines m join public.machine_identifiers i on i.machine_id = m.id
    where i.value = $1`, [`${tag}X0`]);
  await page.goto(`${base}/sales/new?machine=${m.id}`);
  await page.locator("main input.is-id").first().fill("556701-2009");
  await page.getByRole("button", { name: "Slå upp" }).click();
  await expect(page.getByText("Bergs Schakt").first()).toBeVisible();
  await page.locator("main input[type=file]").first().setInputFiles({ name: "faktura.pdf", mimeType: "application/pdf", buffer: PDF_FIXTURE });
  await expect(page.locator("main").getByText("faktura.pdf är uppladdad")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("combobox", { name: "Finansiär" }).selectOption({ label: "Demo Bank Finans" });
  await page.getByLabel("Slutdatum").fill(new Date(Date.now() + 3 * 365 * 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Skicka till köparen" }).click();
  if (await page.getByText("Du signerar").isVisible({ timeout: 5_000 }).catch(() => false)) await signDemo(page);
  await page.waitForURL(/transfers\//);
  const transferId = new URL(page.url()).pathname.split("/").pop()!;
  await expect.poll(async () => (await sql<{ n: number }>(page, `select count(*)::int n from public.email_outbox o join public.profiles p on p.user_id = o.user_id
    where p.email = 'berg@demo.se' and o.created_at > now() - interval '10 minutes'`))[0].n).toBeGreaterThan(0);

  await logout(page);
  const buyer = await login(page, "berg@demo.se");
  await page.goto(`${buyer}/transfers/${transferId}`);
  await page.getByRole("button", { name: "Signera och godkänn" }).click();
  await signDemo(page);
  await expect(page.getByText("Ni är nu ägare")).toBeVisible();

  await logout(page);
  const bank = await login(page, "bank@demo.se");
  await page.goto(`${bank}/machines/${m.id}`);
  await page.getByRole("tab", { name: /Förbehåll/ }).click();
  await expect(page.getByText("Väntar på bekräftelse")).toBeVisible();
  await page.getByRole("button", { name: "Bekräfta förbehållet" }).click();
  await expect.poll(async () => (await sql<{ status: string }>(page, `select status from public.encumbrances where machine_id = $1 and type in ('leasing', 'ownership_reservation')
    order by created_at desc limit 1`, [m.id]))[0]?.status).toBe("active");

  await logout(page);
  const owner = await login(page, "berg@demo.se");
  await page.goto(`${owner}/machines/${m.id}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ägarbevis (PDF)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^agarbevis-B-\d{4}-\d{6}\.pdf$/);
  const pdf = (await (await file.createReadStream()).toArray()).map((c) => Buffer.from(c)).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0));
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.includes("/Subtype /Image") || pdf.includes("/Image")).toBe(true);
  const [cert] = await sql<{ reg: string; level: number }>(page, `select result -> 'machine' ->> 'reg_number' reg, (result -> 'machine' ->> 'verification_level')::int level
    from public.report_snapshots where kind = 'ownership_certificate' order by created_at desc limit 1`);
  expect(cert.reg).toBe(m.reg_number);
  expect(cert.level).toBe(2);
});
