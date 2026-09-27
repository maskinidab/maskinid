import { expect, test, type Download } from "@playwright/test";
import { asUser, login, logout, sql } from "./helpers";

async function bytes(d: Download): Promise<Buffer> {
  const chunks = await (await d.createReadStream()).toArray();
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

const BERGS = "556701-2009";
const orgId = async (page: import("@playwright/test").Page, orgNumber: string) =>
  (await sql<{ id: string }>(page, "select id from public.organizations where org_number = $1", [orgNumber]))[0]!.id;

// Point 21 (SPEC §20.8, §20.11): a support ticket and the operator's answer; "Visa som organisation" is read-only,
// time-limited, logged and announced to the organisation's admins.
test("support och Visa som organisation", async ({ page }) => {
  const berg = await login(page, "berg@demo.se");
  await page.goto(`${berg}/support`);
  await page.getByLabel("Kategori").selectOption({ label: "Maskin och uppgifter" });
  await page.getByLabel("Ämne").fill("Fel årsmodell i registret");
  await page.getByLabel("Meddelande").fill("Årsmodellen ska vara 2019, inte 2018.");
  await page.getByRole("button", { name: "Skicka" }).click();
  await expect(page.getByText("Fel årsmodell i registret").first()).toBeVisible();
  const [ticket] = await sql<{ id: string; status: string }>(page, "select id, status from public.support_tickets where subject = $1", ["Fel årsmodell i registret"]);
  expect(ticket!.status).toBe("open");

  await logout(page);
  const admin = await login(page, "admin@demo.se");
  await page.goto(`${admin}/admin/support-tickets?ticket=${ticket!.id}`);
  await page.getByLabel("Svara").fill("Vi har rättat årsmodellen.");
  await page.getByRole("button", { name: "Skicka" }).click();
  await expect.poll(async () => (await sql<{ status: string }>(page, "select status from public.support_tickets where id = $1", [ticket!.id]))[0]!.status)
    .toBe("waiting_customer");

  const bergs = await orgId(page, BERGS);
  await page.goto(`${admin}/admin/organizations/${bergs}`);
  await page.getByRole("button", { name: "Visa som organisation" }).click();
  await page.getByRole("dialog").getByLabel("Skäl").fill("Supportärende om årsmodell");
  await page.getByRole("dialog").getByRole("button", { name: "Visa som organisation" }).click();
  await page.waitForURL(/\/o\/bergs-schakt[^/]*\/dashboard/);
  await expect(page.getByText(/Du ser Bergs Schakt & Entreprenad AB som organisationen ser det/)).toBeVisible();
  // Read-only: a write as the viewing operator is refused and the support form is hidden.
  await page.goto(`/o/${new URL(page.url()).pathname.split("/")[2]}/support`);
  await expect(page.getByRole("heading", { name: "Nytt ärende" })).toHaveCount(0);
  const refused = await asUser(page, "create_support_ticket", { p_org_id: bergs, p_category: "other", p_subject: "Test", p_body: "Test" })
    .then(() => null, (e: Error) => e.message);
  expect(refused).toMatch(/skrivskyddad|VIEW_AS_READ_ONLY/);
  const [log] = await sql<{ n: number; notified: number }>(page, `select (select count(*)::int from public.view_as_sessions where org_id = $1) n,
    (select count(*)::int from public.notifications where org_id = $1 and type = 'support.viewed_as') notified`, [bergs]);
  expect(log!.n).toBe(1);
  expect(log!.notified).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Avsluta visning" }).click();
  await expect(page.getByText(/Du ser Bergs Schakt/)).toHaveCount(0);
});

// Point 22 (SPEC §20.9): prices excl. VAT with VAT separate, a demo payment of an open invoice, invoice PDF, plan change.
test("betalning: faktura betalas i demoläge, PDF, planbyte", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  await page.goto(`${base}/settings?tab=billing`);
  await expect(page.getByText(/Moms 25 %/)).toBeVisible();
  // Seed invoice numbers depend on insert order; take Nordmaskin's open invoice from the register.
  const [{ number }] = await sql<{ number: string }>(page, `select i.number from public.invoices i join public.organizations o on o.id = i.org_id
    where o.name = 'Nordmaskin AB' and i.status = 'open' order by i.period desc limit 1`);
  const row = page.getByRole("row").filter({ hasText: number });
  await expect(row).toContainText("Obetald");
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "PDF" }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe(`${number}.pdf`);
  expect((await bytes(pdf)).subarray(0, 5).toString()).toBe("%PDF-");
  await row.getByRole("button", { name: "Betala (demo)" }).click();
  await expect(row).toContainText("Betald");
  expect((await sql<{ status: string }>(page, "select status from public.invoices where number = $1", [number]))[0]!.status).toBe("paid");

  // Plan change: down to the free plan and back to the dealer plan through the (mock) checkout.
  const plan = async () => (await sql<{ plan_key: string }>(page, `select s.plan_key from public.subscriptions s
    join public.organizations o on o.id = s.org_id where o.name = 'Nordmaskin AB'`))[0]?.plan_key;
  await page.getByRole("button", { name: "Byt till denna" }).click();
  await expect.poll(plan).toBe("free");
  await page.getByRole("button", { name: "Välj och betala" }).first().click();
  await expect(page.getByText(/^Ni har nu /)).toBeVisible();
  await expect.poll(plan).toBe("dealer");
});

// Points 23–24 (SPEC §20.12–20.14): the organisation's data export and a sandbox API key.
test("dataexport och sandlådenyckel", async ({ page }) => {
  const base = await login(page, "berg@demo.se");
  await page.goto(`${base}/settings?tab=data`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportera (JSON)" }).click();
  const file = await download;
  const data = JSON.parse((await bytes(file)).toString("utf8"));
  expect(Array.isArray(data.machines)).toBe(true);
  expect(data.machines.length).toBeGreaterThan(0);
  expect(JSON.stringify(data)).not.toMatch(/personal_number|password|credential_enc/);
  await expect(page.getByText(/Exporten är klar/)).toBeVisible();

  await page.goto(`${base}/settings?tab=api`);
  await page.getByLabel("Namn").fill("Sandlåda e2e");
  await page.locator("main fieldset input[type=checkbox]").first().check();
  await page.getByLabel("Testnyckel (sandlåda)").check();
  await page.getByRole("button", { name: "Skapa nyckel" }).click();
  await expect(page.getByText("Ny API-nyckel")).toBeVisible();
  expect((await sql<{ sandbox: boolean }>(page, "select sandbox from public.api_keys where name = 'Sandlåda e2e'"))[0]!.sandbox).toBe(true);

  await logout(page);
  await page.goto("/api-docs");
  await expect(page.getByRole("heading", { name: "Sandlåda" })).toBeVisible();
});
