import { expect, test } from "@playwright/test";
import { asUser, login, logout, signDemo, sql } from "./helpers";

// SPEC §16.15: check → receipt with number → register encumbrance → another lender is blocked; holder and owner notified.
test("finansiär: kontroll med kvitto, förbehåll, andra finansiären blockeras", async ({ page }) => {
  let base = await login(page, "bank@demo.se");
  const [m] = await sql<{ id: string; reg_number: string }>(page, `select m.id, m.reg_number from public.machines m join public.organizations o on o.id = m.owner_org_id
    where o.slug = 'bergs-schakt-entreprenad-ab' and m.status = 'active'
      and not exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status in ('active', 'pending'))
      and not exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier'))
    order by m.reg_number limit 1`);

  await page.goto(`${base}/check`);
  await page.locator("main input.is-id").fill(m.reg_number);
  await page.locator("main form button[type=submit]").click();
  const receipt = page.locator(".kvitto");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText(/K-\d{4}-\d{6}/);
  const download = page.waitForEvent("download");
  await page.getByText("Ladda ner kvitto (PDF)").click();
  expect((await download).suggestedFilename()).toMatch(/^kontrollkvitto-K-/);

  await page.getByRole("button", { name: "Registrera förbehåll" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("input[type=date]").nth(0).fill(new Date().toISOString().slice(0, 10));
  await dialog.locator("input[type=date]").nth(1).fill("2030-09-01");
  await dialog.locator("button[type=submit]").click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const [enc] = await sql<{ status: string; holder: string }>(page, `select e.status, o.slug holder from public.encumbrances e join public.organizations o on o.id = e.holder_org_id
    where e.machine_id = $1 and e.type in ('leasing', 'ownership_reservation') order by e.created_at desc limit 1`, [m.id]);
  expect(enc).toMatchObject({ holder: "demo-bank-finans" });
  expect(["active", "pending"]).toContain(enc.status);
  await sql(page, "update public.encumbrances set status = 'active' where machine_id = $1 and status = 'pending'", [m.id]);

  await logout(page);
  base = await login(page, "finans@demo.se");
  await page.goto(`${base}/encumbrances/new?q=${m.reg_number}`);
  await page.locator("main form button[type=submit]").first().click();
  await expect(page.locator("main .mid-fel")).toContainText("Demo Bank Finans");
  // The same attempt through the API/RPC: blocked with a conflict and notifications to both lenders.
  const org = (await sql<{ id: string }>(page, "select id from public.organizations where slug = 'nordisk-maskinfinans'"))[0].id;
  const params = { type: "leasing", contract_ref: "NMF-1", start_date: new Date().toISOString().slice(0, 10), end_date: "2030-01-01" };
  const s = await asUser<{ id: string }>(page, "start_signature", { p_org_id: org, p_action: "register_encumbrance", p_subject_id: m.id, p_params: params });
  await asUser(page, "complete_mock_signature", { p_signature_id: s.id });
  const r = await asUser<{ ok: boolean; error: string }>(page, "register_encumbrance", { p_org_id: org, p_machine_id: m.id, p_type: "leasing",
    p_contract_ref: "NMF-1", p_start_date: params.start_date, p_end_date: params.end_date, p_signature_id: s.id });
  expect(r).toMatchObject({ ok: false, error: "ACTIVE_ENCUMBRANCE_EXISTS" });
  const notified = await sql<{ slug: string }>(page, `select distinct o.slug from public.notifications n join public.organizations o on o.id = n.org_id
    where n.type like 'encumbrance.conflict%' and n.created_at > now() - interval '5 minutes'`);
  // SPEC §16.4: the holder and the owner are notified; the lender who tried gets the error naming the holder.
  expect(notified.map((x) => x.slug)).toEqual(expect.arrayContaining(["demo-bank-finans", "bergs-schakt-entreprenad-ab"]));
  expect(JSON.stringify(r)).toContain("Demo Bank Finans");
});
