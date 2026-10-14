import { expect, test } from "@playwright/test";
import { login, logout, signDemo, sql } from "./helpers";

/**
 * Rikard's search and consent points (ADR 0032): an enskild firma can look a serial up and see that the machine
 * is financed, and the full history is something the owner grants.
 */
test("enskild firma: söker serienummer, ser Belånad, begär historik, ägaren godkänner", async ({ page }) => {
  const base = await login(page, "lena@demo.se");

  // The bank-financed JCB belongs to Bergs Schakt, so Lena has no relation to it at all.
  await page.goto(`${base}/dashboard`);
  await page.getByRole("button", { name: /Sök regnr eller serienummer/ }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("textbox", { name: "Sök regnr eller serienummer" }).fill("JCB3CX04278");
  await dialog.getByRole("button", { name: "Sök" }).click();

  // Base information and the financing answer, without the lender's name.
  await expect(dialog.getByText("JCB")).toBeVisible();
  await expect(dialog.getByText("Belånad")).toBeVisible();
  await expect(dialog.getByText("Demo Bank Finans")).toHaveCount(0);

  // Asking the owner is the way to the history.
  await dialog.getByRole("button", { name: "Begär full historik" }).click();
  const ask = page.locator("dialog[open]").last();
  await ask.getByLabel("Varför behöver ni åtkomst?").fill("Vi överväger att köpa maskinen");
  await ask.getByRole("button", { name: "Skicka" }).click();
  await expect(page.getByText("Förfrågan är skickad", { exact: false })).toBeVisible();

  const [req] = await sql<{ status: string; requested_by: string; machine_id: string | null }>(page, `
    select status, requested_by, machine_id from public.mandates order by created_at desc limit 1`);
  expect(req).toMatchObject({ status: "requested", requested_by: "agent" });
  expect(req.machine_id).toBeTruthy();

  // The request does not vanish: searching again shows it waiting, and Fullmakter lists it without naming the
  // owner, since the lookup withholds who owns the machine until the owner says yes.
  await page.goto(`${base}/dashboard`);
  await page.getByRole("button", { name: /Sök regnr eller serienummer/ }).click();
  const again = page.locator("dialog[open]");
  await again.getByRole("textbox", { name: "Sök regnr eller serienummer" }).fill("JCB3CX04278");
  await again.getByRole("button", { name: "Sök" }).click();
  await expect(again.getByText("väntar på ägarens godkännande", { exact: false })).toBeVisible();
  await expect(again.getByRole("button", { name: "Dra tillbaka" })).toBeVisible();
  await expect(again.getByRole("button", { name: "Begär full historik" })).toHaveCount(0);
  await page.goto(`${base}/mandates`);
  await expect(page.getByRole("cell", { name: "Från maskinens ägare" })).toBeVisible();
  await expect(page.getByText("Bergs Schakt", { exact: false })).toHaveCount(0);

  // The owner finds it in the inbox and approves it with Demo-BankID.
  await logout(page);
  const owner = await login(page, "berg@demo.se");
  await page.goto(`${owner}/inbox`);
  await expect(page.getByText("Begäran om åtkomst att godkänna")).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "Begäran om åtkomst" }).getByRole("button", { name: "Hantera" }).click();
  const decide = page.locator("dialog[open]");
  await expect(decide.getByText("Lena Grävmaskin", { exact: false })).toBeVisible();
  await decide.getByRole("button", { name: "Godkänn åtkomst" }).click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Now the history is there, and still no financing amounts: that contract is not the owner's to share.
  await logout(page);
  const lena = await login(page, "lena@demo.se");
  const machineId = req.machine_id!;
  await page.goto(`${lena}/machines/${machineId}?tab=history`);
  await expect(page.locator(".tidslinje li").first()).toBeVisible();
  await expect(page.getByText("Finansieringsbelopp")).toHaveCount(0);

  // The owner can take it back. Fullmakter lists it as an active power of attorney to Lena.
  await logout(page);
  await login(page, "berg@demo.se");
  await page.goto(`${owner}/mandates`);
  await expect(page.getByText("Lena Grävmaskin", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Återkalla" }).first()).toBeVisible();

  // That the revocation itself closes the history again is covered at the RPC level in
  // supabase/tests/29_lookup_and_consent.test.ts; here it is enough that the owner has the control on screen.
});

/**
 * Round 13: a lender sees only what it finances, asks a company for insight into its whole fleet, the company
 * approves with Demo-BankID, and the fleet is then listed under Maskiner → Delade med oss (ADR 0032).
 */
test("långivare: begär insyn i maskinflottan, företaget godkänner, flottan listas", async ({ page }) => {
  const bank = await login(page, "bank@demo.se");
  await page.goto(`${bank}/portfolio`);
  await page.getByRole("button", { name: "Begär insyn i maskinflottan" }).click();
  const ask = page.locator("dialog[open]");
  await ask.getByLabel("Företagets organisationsnummer").fill("556701-2009");
  await ask.getByRole("button", { name: "Skicka" }).click();
  await expect(ask.getByText("Förfrågan är skickad till företaget")).toBeVisible();

  await logout(page);
  const owner = await login(page, "berg@demo.se");
  await page.goto(`${owner}/inbox`);
  await page.getByRole("listitem").filter({ hasText: "Begäran om åtkomst" }).getByRole("button", { name: "Hantera" }).click();
  const decide = page.locator("dialog[open]");
  await expect(decide.getByText("hela er maskinflotta", { exact: false })).toBeVisible();
  await decide.getByRole("button", { name: "Godkänn åtkomst" }).click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await logout(page);
  await login(page, "bank@demo.se");
  await page.goto(`${bank}/mandates`);
  await page.getByRole("link", { name: /visa maskinerna/ }).first().click();
  await expect(page).toHaveURL(/scope=shared/);
  const [{ n }] = await sql<{ n: number }>(page, `select count(*)::int n from public.machines m join public.organizations o on o.id = m.owner_org_id
    where o.slug = 'bergs-schakt-entreprenad-ab' and m.status <> 'draft'`);
  await expect(page.locator("main table tbody tr")).toHaveCount(n);
});
