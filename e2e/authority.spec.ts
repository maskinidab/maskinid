import { expect, test } from "@playwright/test";
import { login, logout, sql } from "./helpers";

// SPEC §16.17: the authority's partial search finds the machine; the owner does not see the authority's read when the
// organisation setting hides authority reads.
test("myndighet: partiell sökning hittar maskinen, ägaren ser inte läsningen", async ({ page }) => {
  const base = await login(page, "polisen@demo.se");
  const [m] = await sql<{ id: string; reg_number: string; serial: string }>(page, `select m.id, m.reg_number, i.value serial from public.machines m
    join public.machine_identifiers i on i.machine_id = m.id and i.type = 'serial'
    join public.organizations o on o.id = m.owner_org_id where o.slug = 'bergs-schakt-entreprenad-ab' and m.status = 'active' order by m.reg_number limit 1`);
  await page.goto(`${base}/search`);
  await page.locator("main form input").first().fill(m.serial.slice(2, 9));
  await page.locator("main form button[type=submit]").first().click();
  const hit = page.locator(`main :text("${m.reg_number.slice(0, 3)}")`).first();
  await expect(hit).toBeVisible();
  const reads = await sql<{ n: number }>(page, "select count(*)::int n from public.access_log where machine_id = $1 and viewer_type = 'authority'", [m.id]);
  expect(reads[0].n).toBeGreaterThan(0);

  await logout(page);
  const owner = await login(page, "berg@demo.se");
  // Default: the authority's setting show_authority_reads_to_owner is off.
  await page.goto(`${owner}/machines/${m.id}`);
  await page.getByRole("tab", { name: "Åtkomst" }).click();
  await expect(page.locator("main table, main .mid-tom, main ul").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Polisen");
});
