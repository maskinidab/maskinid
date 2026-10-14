import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, login, logout, sql } from "./helpers";

/**
 * The closed pilot (ADR 0034): anyone can apply, nobody can use the register until an operator has approved them,
 * a rejection says why, and lenders need two-factor sign-in once demo mode is off.
 */
function newOrgNumber(): string {
  const base = `55991${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const sum = [...base].reduce((s, c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); if (d > 9) d -= 9; return s + d; }, 0);
  const n = base + ((10 - (sum % 10)) % 10);
  return `${n.slice(0, 6)}-${n.slice(6)}`;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
}

test("pilot: ansökan väntar på granskning, avslås med skäl och godkänns sedan", async ({ page }) => {
  await page.goto("/");
  await sql(page, "update public.app_config set value = 'true' where key = 'REQUIRE_ORG_APPROVAL'");
  const email = `pilot-${Date.now()}@e2e.se`;
  const orgNumber = newOrgNumber();

  // Sign up and apply – as a plain owner, which used to be approved straight away.
  await page.goto("/signup");
  await page.getByLabel("Namn").fill("Pia Pilot");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(PASSWORD);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 180_000 });
  await page.getByRole("button", { name: "Verifiera med Demo-BankID" }).click();
  await page.locator("#orgnr").fill(orgNumber);
  await page.getByRole("button", { name: "Slå upp" }).click();
  await page.getByRole("checkbox", { name: /Maskinägare/ }).check();
  await page.getByText(/Jag godkänner personuppgiftsbiträdesavtalet/).click();
  await page.getByRole("button", { name: "Lägg till organisationen" }).click();

  // Not an app full of errors: a waiting screen.
  await expect(page.getByRole("heading", { name: "Ansökan är skickad" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("MaskinID granskar ansökan")).toBeVisible();
  const [org] = await sql<{ id: string; status: string }>(page, "select id, status from public.organizations where org_number = $1", [orgNumber]);
  expect(org.status).toBe("pending");
  // The applicant is told it arrived, and the operators that there is something to review – both by e-mail.
  const mails = await sql<{ to_email: string; type: string }>(page, `select to_email, data ->> 'type' as type from public.email_outbox
    where template = 'notification' and data ->> 'type' in ('org.received', 'org.pending_approval') and created_at > now() - interval '5 minutes'`);
  expect(mails).toEqual(expect.arrayContaining([{ to_email: email, type: "org.received" }, expect.objectContaining({ type: "org.pending_approval" })]));

  // The operator finds the person under Konton, and rejects the application with a reason.
  await logout(page);
  const admin = await login(page, "admin@demo.se");
  await page.goto(`${admin}/admin/users`);
  await page.getByLabel("Sök på namn eller e-post").fill(email);
  await page.locator("main form").getByRole("button", { name: "Sök" }).click();
  await expect(page.getByRole("link", { name: "Pia Pilot" })).toBeVisible();
  await page.goto(`${admin}/admin/organizations/${org.id}`);
  await page.getByRole("button", { name: "Avslå ansökan" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Skäl").fill("Organisationsnumret hör till ett annat bolag");
  await dialog.getByRole("button", { name: "Avslå ansökan" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await logout(page);
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Ansökan har inte godkänts" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Organisationsnumret hör till ett annat bolag", { exact: false })).toBeVisible();

  // Approved after all: the account opens.
  await logout(page);
  await login(page, "admin@demo.se");
  await page.goto(`${admin}/admin/organizations/${org.id}`);
  await page.getByRole("button", { name: "Återaktivera" }).click();
  await expect.poll(async () => (await sql<{ status: string }>(page, "select status from public.organizations where id = $1", [org.id]))[0].status).toBe("approved");
  await logout(page);
  await signIn(page, email);
  await page.waitForURL(/\/o\/[^/]+\/dashboard/, { timeout: 60_000 });
  const terms = page.getByRole("dialog").filter({ hasText: "Uppdaterade villkor" });
  if (await terms.count()) {
    await terms.getByRole("checkbox").check();
    await terms.getByRole("button", { name: "Godkänn och fortsätt" }).click();
  }
  await expect(page.getByRole("heading", { name: "Ansökan har inte godkänts" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Huvudmeny" })).toBeVisible();
});

test("pilot: en långivare måste slå på tvåstegsverifiering när demoläget är av", async ({ page }) => {
  await page.goto("/");
  await sql(page, "update public.app_config set value = 'false' where key = 'DEMO_MODE'");
  await sql(page, "update public.app_config set value = 'true' where key = 'MOCK_IDENTITY'");
  await signIn(page, "bank@demo.se");
  await expect(page.getByRole("heading", { name: "Aktivera tvåstegsverifiering" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Aktivera/ }).first()).toBeVisible();
  // An owner account is not asked.
  await logout(page);
  await signIn(page, "berg@demo.se");
  await page.waitForURL(/\/o\/[^/]+\/dashboard/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Aktivera tvåstegsverifiering" })).toHaveCount(0);
});
