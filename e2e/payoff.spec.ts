import { expect, test } from "@playwright/test";
import { asUser, financingPdf, login, logout, signDemo, sql, uniqueSerial } from "./helpers";

/**
 * The payoff ("lösen") round trip, which is the flow the product owner reported as missing.
 *
 * A dealer takes in a machine the bank owns through leasing. Starting the trade-in sends the payoff question to
 * the lender *immediately* — it used to wait until the owner had approved the ownership transfer, so the bank
 * heard nothing and the dealer saw only "Väntar på långivaren". The lender answers with a payoff statement, the
 * dealer uploads proof of settlement, and the lender approves: the block is released in that one signed step.
 */
test("lösen: inbyte av bankägd maskin, offert, lösenbevis och godkännande", async ({ page }) => {
  // ---- The dealer finds the machine by serial number (not by label) ----
  let base = await login(page, "nordmaskin@demo.se");
  const [m] = await sql<{ id: string; reg_number: string; serial: string; holder: string; holder_slug: string }>(page, `
    select m.id, m.reg_number, i.value serial, ho.name holder, ho.slug holder_slug
    from public.machines m
    join public.encumbrances e on e.machine_id = m.id and e.status = 'active' and e.type in ('leasing', 'ownership_reservation')
    join public.organizations ho on ho.id = e.holder_org_id
    join public.machine_identifiers i on i.machine_id = m.id and i.type = 'serial'
    join public.organizations o on o.id = m.owner_org_id
    where m.status = 'active' and o.slug <> 'nordmaskin-ab'
      and exists (select 1 from public.memberships me where me.org_id = ho.id and me.status = 'active')
      and not exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier'))
      and not exists (select 1 from public.payoff_requests p where p.encumbrance_id = e.id and p.status in ('requested', 'quoted', 'settlement_submitted'))
    order by m.reg_number limit 1`);
  expect(m, "a financed machine owned by someone else").toBeTruthy();

  await page.goto(`${base}/trade-in`);
  await page.getByText("Lägg in serienummer manuellt").click();
  await page.getByLabel("Serienummer, PIN eller VIN").fill(m.serial);
  await page.locator("main form button[type=submit]").click();
  await expect(page.locator("main").getByText(m.reg_number.replace(/^(...)/, "$1-"))).toBeVisible();
  // The dealer sees who holds the financing before committing to anything.
  await expect(page.getByText(m.holder, { exact: false }).first()).toBeVisible();

  // ---- Starting the trade-in asks the lender for the payoff straight away ----
  await page.getByRole("button", { name: "Begär inbyte" }).click();
  await expect(page.getByText("Förfrågan skickad", { exact: false })).toBeVisible();
  const [po] = await sql<{ status: string; purpose: string }>(page, `
    select p.status, p.purpose from public.payoff_requests p where p.machine_id = $1 order by p.created_at desc limit 1`, [m.id]);
  expect(po.purpose).toBe("trade_in");
  expect(po.status).toBe("requested");
  // The owner has not approved the transfer yet — the lender was told anyway.
  const [tr] = await sql<{ status: string }>(page, `select status from public.transfers where machine_id = $1 order by created_at desc limit 1`, [m.id]);
  expect(tr.status).toBe("draft");

  // ---- The lender has a real work item, not just a bell notification ----
  await logout(page);
  const lenderEmail = await sql<{ email: string }>(page, `
    select p.email from public.profiles p join public.memberships me on me.user_id = p.user_id and me.status = 'active'
    join public.organizations o on o.id = me.org_id where o.slug = $1 limit 1`, [m.holder_slug]).then((r) => r[0].email);
  base = await login(page, lenderEmail);
  await page.goto(`${base}/inbox`);
  await expect(page.getByText("Lösen att besvara")).toBeVisible();
  await page.getByRole("link", { name: "Hantera" }).first().click();
  await page.waitForURL(/tab=financing/);

  // Answer with a payoff statement. The amount lives in the document, never in the register.
  await page.getByRole("button", { name: "Skicka lösenbesked" }).click();
  const quote = page.locator("dialog[open]");
  await expect(quote.getByText("Handlaren ser beloppet i dokumentet", { exact: false })).toBeVisible();
  await quote.locator("input[type=file]").first().setInputFiles({
    name: "losenbesked.pdf", mimeType: "application/pdf", buffer: financingPdf({ document_kind: "payoff_statement", contract_ref: "LOSEN-E2E-1" }),
  });
  await expect(quote.getByText("losenbesked.pdf", { exact: false })).toBeVisible();
  await quote.getByLabel("Referens").fill("LOSEN-E2E-1");
  await quote.getByLabel("Giltigt t.o.m.").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await quote.locator("button[type=submit]").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // ---- The dealer sees the quote and uploads proof of settlement ----
  await logout(page);
  base = await login(page, "nordmaskin@demo.se");
  await page.goto(`${base}/trade-in`);
  await page.getByText("Lägg in serienummer manuellt").click();
  await page.getByLabel("Serienummer, PIN eller VIN").fill(m.serial);
  await page.locator("main form button[type=submit]").click();
  await expect(page.getByText("Lösenbesked mottaget")).toBeVisible();
  await expect(page.getByRole("button", { name: "Öppna lösenbesked" })).toBeVisible();

  // Rikard's defect: the button was there but opening it said "du har inte behörighet". The dealer uploads
  // nothing and owns nothing here — it is a party to the payoff, and that is what grants the read (ADR 0030).
  // Through the dealer's own RPC rather than the sql() helper: sql() runs as the database owner and would prove
  // nothing about the permission, which is the whole point here.
  const orgId = new URL(page.url()).pathname.split("/")[2]!;
  const mine = await asUser<{ id: string; quote_document_id: string | null; machine_id: string }[]>(
    page, "list_payoff_requests", { p_org_id: await sql<{ id: string }>(page, "select id from public.organizations where slug = $1", [orgId]).then((r) => r[0].id) });
  const quoteDocId = mine.find((p) => p.machine_id === m.id)?.quote_document_id;
  expect(quoteDocId, "the lender's payoff statement is on the dealer's own request").toBeTruthy();
  const opened = await asUser<{ filename: string }>(page, "authorize_document_download", { p_document_id: quoteDocId! });
  expect(opened.filename).toBe("losenbesked.pdf");
  // Clicking it shows no error either.
  await page.getByRole("button", { name: "Öppna lösenbesked" }).click();
  await expect(page.locator("main").getByText("behörighet", { exact: false })).toHaveCount(0);

  // Still on the trade-in page: a dealer who is only a party to the transfer has no financing tab on the
  // machine page, so the proof of settlement is uploaded where the deal is being made.
  await page.getByRole("button", { name: "Ladda upp lösenbevis" }).click();
  const settle = page.locator("dialog[open]");
  await settle.locator("input[type=file]").first().setInputFiles({
    name: "losenbevis.pdf", mimeType: "application/pdf", buffer: financingPdf({ document_kind: "payoff_statement" }),
  });
  await expect(settle.getByText("losenbevis.pdf", { exact: false })).toBeVisible();
  await settle.locator("button[type=submit]").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Uploading proof must NOT release the block by itself.
  const [mid] = await sql<{ has_active: boolean; payoff: string }>(page, `
    select exists (select 1 from public.encumbrances e where e.machine_id = $1 and e.status = 'active') has_active,
      (select p.status::text from public.payoff_requests p where p.machine_id = $1 order by p.created_at desc limit 1) payoff
    from public.machines m where m.id = $1`, [m.id]);
  expect(mid.has_active).toBe(true);
  expect(mid.payoff).toBe("settlement_submitted");

  // ---- Only the lender can release, and it happens in one signed step ----
  await logout(page);
  base = await login(page, lenderEmail);
  await page.goto(`${base}/machines/${m.id}?tab=financing`);
  await page.getByRole("button", { name: "Godkänn lösen och släpp spärren" }).click();
  await page.locator("dialog[open] button[type=submit]").click();
  await signDemo(page);
  // Rikard's second defect: releasing ends the lender's own relation to the machine, so the page behind the
  // dialog became unreadable and showed "ingen behörighet". A confirmation now, not an error (ADR 0030).
  await expect(page.locator("dialog[open]").getByText("Spärren släppt", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("behörighet", { exact: false })).toHaveCount(0);
  await page.locator("dialog[open]").getByRole("link", { name: "Portfölj" }).click();
  await expect(page).toHaveURL(/portfolio/);

  const [done] = await sql<{ enc: string; payoff: string; reminders_open: number }>(page, `
    select (select e.status::text from public.encumbrances e where e.machine_id = $1 order by e.created_at desc limit 1) enc,
      (select p.status::text from public.payoff_requests p where p.machine_id = $1 order by p.created_at desc limit 1) payoff,
      (select count(*)::int from public.reminders r join public.encumbrances e on e.id = r.source_id
        where e.machine_id = $1 and r.status <> 'done') reminders_open`, [m.id]);
  expect(done.enc).toBe("released");
  expect(done.payoff).toBe("settled");
  expect(done.reminders_open).toBe(0);
});


/**
 * "Bifoga dokument": a dealer uploads a bank order naming a bank that does not use MaskinID, the document is
 * read, and the financing is registered against that bank anyway. The machine says "Belåning anmäld" at once,
 * and the bank finds its machines waiting the day it signs up.
 *
 * The machine is created through the RPC rather than by driving the registration wizard — dealer.spec.ts already
 * covers the wizard, and this test is about the financing step.
 */
test("finansiering: bifoga bankbeställning för en bank utanför MaskinID", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  const [org] = await sql<{ id: string }>(page, "select id from public.organizations where slug = 'nordmaskin-ab'");
  const serial = uniqueSerial("PAY");
  const machine = await asUser<{ id: string; reg_number: string }>(page, "register_machine", {
    p_org_id: org.id,
    p_data: { make: "Volvo", model: "L120H", year: 2021, category: "wheel_loader", identifiers: [{ type: "serial", value: serial }] },
  });

  // A bank with a valid organisation number that nothing in the seed uses.
  const unconnected = "559100-2000";
  await page.goto(`${base}/machines/${machine.id}?tab=financing`);
  await page.getByRole("tabpanel", { name: "Förbehåll" }).getByRole("button", { name: "Bifoga dokument" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("input[type=file]").first().setInputFiles({
    name: "bankbestallning.pdf", mimeType: "application/pdf",
    buffer: financingPdf({
      document_kind: "bank_order", financier_name: "Okänd Bank AB", financier_org_number: unconnected,
      encumbrance_type: "leasing", contract_ref: "OB-2026-1", start_date: new Date().toISOString().slice(0, 10),
      end_date: "2031-12-31", serial,
    }),
  });

  // The reading pre-fills the agreement details and resolves the bank, which is not a MaskinID customer.
  await expect(dialog.getByText("använder inte MaskinID än", { exact: false })).toBeVisible({ timeout: 120_000 });
  await expect(dialog.getByRole("textbox", { name: "Avtalsreferens" })).toHaveValue("OB-2026-1");
  await dialog.locator("button[type=submit]").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Visible as reported immediately, and registered against an unclaimed placeholder with the document attached.
  await expect(page.locator("main").getByText("Belåning anmäld").first()).toBeVisible();
  const [state] = await sql<{ status: string; members: number; docs: number }>(page, `
    select e.status::text,
      (select count(*)::int from public.memberships me where me.org_id = o.id and me.status = 'active') members,
      coalesce(array_length(e.document_ids, 1), 0) docs
    from public.encumbrances e join public.organizations o on o.id = e.holder_org_id
    where e.machine_id = $1`, [machine.id]);
  expect(state.status).toBe("pending");
  expect(state.members).toBe(0);
  expect(state.docs).toBe(1);

  // A financing check is the lender's legal answer and must still say NO: reported is not confirmed (SPEC §6.6).
  const [view] = await sql<{ has_active: boolean; has_pending: boolean }>(page, `
    select exists (select 1 from public.encumbrances e where e.machine_id = $1 and e.status = 'active') has_active,
           exists (select 1 from public.encumbrances e where e.machine_id = $1 and e.status = 'pending') has_pending`, [machine.id]);
  expect(view.has_active).toBe(false);
  expect(view.has_pending).toBe(true);
});
