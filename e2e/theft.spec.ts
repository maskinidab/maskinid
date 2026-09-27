import { expect, test } from "@playwright/test";
import { login, logout, service, signDemo, sql } from "./helpers";

// SPEC §16.16: owner flags stolen → public page red → a scan notifies the owner → a listing with the same serial ⇒ alert.
test("stöld: flagga, röd publik sida, skanning notifierar ägaren, annons ger larm", async ({ page }) => {
  const base = await login(page, "berg@demo.se");
  const [m] = await sql<{ id: string; reg_number: string; serial: string }>(page, `select m.id, m.reg_number, i.value serial from public.machines m
    join public.machine_identifiers i on i.machine_id = m.id and i.type = 'serial'
    join public.organizations o on o.id = m.owner_org_id where o.slug = 'bergs-schakt-entreprenad-ab' and m.status = 'active'
      and not exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier'))
    order by m.reg_number desc limit 1`);
  await page.goto(`${base}/machines/${m.id}`);
  await page.getByRole("button", { name: "Anmäl stöld" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Polisanmälans nummer").fill("5000-K1234-26");
  await dialog.getByRole("button", { name: "Signera och anmäl stöld" }).click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect.poll(async () => (await sql<{ status: string }>(page, "select status from public.machines where id = $1", [m.id]))[0].status).toBe("stolen");

  await logout(page);
  await page.goto(`/r/${m.reg_number}`);
  await expect(page.getByText("ANMÄLD STULEN").first()).toBeVisible();
  await expect.poll(async () => (await sql<{ n: number }>(page, `select count(*)::int n from public.notifications n join public.organizations o on o.id = n.org_id
    where n.type = 'machine.stolen_scanned' and o.slug = 'bergs-schakt-entreprenad-ab' and n.data ->> 'machine_id' = $1`, [m.id]))[0].n).toBeGreaterThan(0);
  expect((await sql<{ n: number }>(page, "select count(*)::int n from public.access_log where machine_id = $1 and viewer_type = 'public'", [m.id]))[0].n).toBeGreaterThan(0);

  // The market ingest (apps/ingest) reports a listing with the same serial.
  // A partner feed (enabled by the operator under Admin → Marknad; all sources start disabled in the demo).
  await sql(page, "update public.market_sources set enabled = true where key = 'partner-feed'");
  const run = await service<{ run_id: string }>(page, "start_market_run", { p_source_key: "partner-feed" });
  await service(page, "ingest_observations", { p_run_id: run.run_id, p_complete: false, p_observations: [{
    external_id: `e2e-${Date.now()}`, url: "https://example.se/annons/e2e", make: "Volvo", model: "EC220E", year: "2019", price_amount: "450000",
    price_currency: "SEK", price_vat_included: "false", seller_type: "private", serial: m.serial, serial_source: "listing_text", serial_confidence: "0.98",
  }] });
  await expect.poll(async () => (await sql<{ n: number }>(page,
    "select count(*)::int n from public.market_alerts where type = 'stolen_machine_listed' and machine_id = $1", [m.id]))[0].n).toBe(1);
});
