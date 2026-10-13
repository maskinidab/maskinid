import { expect, test } from "@playwright/test";
import { asUser, financingPdf, login, logout, signDemo, sql } from "./helpers";

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
  // The agreement number is mandatory (ADR 0029), so submitting without one is refused before any signature.
  await dialog.locator("button[type=submit]").click();
  await expect(dialog.getByText("Avtalsnummer krävs.")).toBeVisible();
  await expect(page.locator('dialog[open]').filter({ hasText: "Du signerar" })).toHaveCount(0);
  await dialog.getByLabel("Avtalsreferens").fill("DBF-2026-5501");
  // The finance calculator: the monthly cost is worked out from the terms, not typed in.
  await dialog.getByLabel("Finansieringsbelopp").fill("1250000");
  await dialog.getByLabel("Kontantinsats").fill("250000");
  await dialog.getByLabel("Restvärde").fill("200000");
  await dialog.getByLabel("Amorteringstid (mån)").fill("60");
  await dialog.getByLabel("Ränta (%)").fill("6.45");
  // Shown rounded to whole kronor like every other amount in the profile; stored to the öre.
  await expect(dialog.getByText(/16\s*709\s*kr/)).toBeVisible();
  await expect(dialog.getByText(/1\s*000\s*000\s*kr/)).toBeVisible();
  await dialog.locator("button[type=submit]").click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const [enc] = await sql<{ status: string; holder: string }>(page, `select e.status, o.slug holder from public.encumbrances e join public.organizations o on o.id = e.holder_org_id
    where e.machine_id = $1 and e.type in ('leasing', 'ownership_reservation') order by e.created_at desc limit 1`, [m.id]);
  expect(enc).toMatchObject({ holder: "demo-bank-finans" });
  expect(["active", "pending"]).toContain(enc.status);
  // Stored terms, with the monthly cost computed by app.annuity_monthly rather than taken from the browser.
  const [stored] = await sql<{ contract_ref: string; financing_amount: string; monthly_cost: string; total_credit_amount: string; terms_overridden: boolean }>(
    page,
    `select contract_ref, financing_amount, monthly_cost, total_credit_amount, terms_overridden from public.encumbrances
     where machine_id = $1 order by created_at desc limit 1`, [m.id]);
  expect(stored.contract_ref).toBe("DBF-2026-5501");
  expect(Number(stored.financing_amount)).toBe(1_250_000);
  expect(Number(stored.total_credit_amount)).toBe(1_000_000);
  expect(Number(stored.monthly_cost)).toBeCloseTo(16_709.19, 2);
  expect(stored.terms_overridden).toBe(false);
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

/**
 * The bank's own way in: upload the finance agreement, let MaskinID read it, check the fields and sign.
 * Until now only the dealer and the owner could attach a document; the lender had a bare form.
 */
test("finansiär: laddar upp finansavtalet, läser av det och signerar", async ({ page }) => {
  const base = await login(page, "dnb@demo.se");
  const [m] = await sql<{ id: string; reg_number: string }>(page, `
    select m.id, m.reg_number from public.machines m join public.organizations o on o.id = m.owner_org_id
    where o.slug = 'bergs-schakt-entreprenad-ab' and m.status = 'active'
      and not exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status in ('active', 'pending'))
      and not exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier'))
    order by m.reg_number desc limit 1`);
  expect(m, "a clean machine to finance").toBeTruthy();

  await page.goto(`${base}/check`);
  await page.locator("main input.is-id").fill(m.reg_number);
  await page.locator("main form button[type=submit]").click();
  await expect(page.locator(".kvitto")).toBeVisible();
  await page.getByRole("button", { name: "Registrera förbehåll" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("input[type=file]").first().setInputFiles({
    name: "leasingavtal.pdf", mimeType: "application/pdf",
    buffer: financingPdf({ document_kind: "leasing_agreement", encumbrance_type: "leasing", contract_ref: "DNB-E2E-7", end_date: "2031-06-30" }),
  });
  // The reading fills in the agreement, so the bank only checks and signs.
  await expect(dialog.getByRole("textbox", { name: "Avtalsreferens" })).toHaveValue("DNB-E2E-7", { timeout: 120_000 });
  await dialog.locator("button[type=submit]").click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Active at once - this is the lender's own declaration - with the agreement attached to it.
  const [enc] = await sql<{ status: string; holder: string; docs: number }>(page, `
    select e.status, o.slug holder, coalesce(array_length(e.document_ids, 1), 0) docs
    from public.encumbrances e join public.organizations o on o.id = e.holder_org_id
    where e.machine_id = $1 order by e.created_at desc limit 1`, [m.id]);
  expect(enc.status).toBe("active");
  expect(enc.holder).toBe("dnb-finans-demo");
  expect(enc.docs).toBe(1);
});
