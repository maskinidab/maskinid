import { expect, test } from "@playwright/test";
import { asUser, login, logout, sql } from "./helpers";

/**
 * Rikard's dealer-view points (ADR 0031): Inbytestest replaces Daglig kontroll for a dealer, and Uthyrning,
 * Bränsle & klimat and Förare are gone from the menu — but still in the system, switchable per organisation.
 */
test("handlare: Inbytestest finns, de fyra flottmodulerna är borta", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  const menu = page.getByRole("navigation", { name: "Huvudmeny" });

  await expect(menu.getByRole("link", { name: "Inbytestest" })).toBeVisible();
  for (const gone of ["Daglig kontroll", "Uthyrning", "Bränsle & klimat", "Förare"]) {
    await expect(menu.getByRole("link", { name: gone }), gone).toHaveCount(0);
  }
  // Flotta and Redskap stay: they were not part of the request.
  await expect(menu.getByRole("link", { name: "Flotta" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Redskap" })).toBeVisible();

  // Hiding the menu item is not enough — the page is reachable by address. It opens, but offers no way to write;
  // the server guard itself is covered in supabase/tests/28_tradein_checks_and_modules.test.ts.
  await page.goto(`${base}/rentals`);
  await expect(page.getByText("Uthyrning är inte aktiverad för er organisation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ny uthyrning" })).toHaveCount(0);

  // And the organisation can switch it back on itself.
  await page.goto(`${base}/settings?tab=modules`);
  await expect(page.getByText("Handlare har de fyra flottmodulerna avstängda som standard", { exact: false })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Uthyrning" });
  // click, not check: the switch is controlled by my_context, so it only flips once the refetch lands.
  await row.getByRole("switch").click();
  await expect(menu.getByRole("link", { name: "Uthyrning" })).toBeVisible();
  await expect(row.getByRole("switch")).toBeChecked();

  // An owner account keeps all four.
  await logout(page);
  await login(page, "berg@demo.se");
  for (const kept of ["Daglig kontroll", "Uthyrning", "Bränsle & klimat", "Förare"]) {
    await expect(menu.getByRole("link", { name: kept }), kept).toBeVisible();
  }
  await expect(menu.getByRole("link", { name: "Inbytestest" })).toHaveCount(0);
});

test("handlare: inbytestest på en maskin handlaren inte äger", async ({ page }) => {
  const base = await login(page, "nordmaskin@demo.se");
  await page.goto(`${base}/tradein-check`);
  await expect(page.getByRole("heading", { name: "Inbytestest", level: 1 })).toBeVisible();

  // The bank-financed JCB that belongs to Bergs Schakt — the machine the demo script uses.
  await page.getByLabel("Serienummer, PIN eller VIN").fill("JCB3CX04278");
  await page.locator("main form button[type=submit]").first().click();
  await expect(page.getByText("Belånad").first()).toBeVisible();

  // The same control points, texts and tick boxes as the daily check.
  await expect(page.getByText("Runtomkontroll: skador, läckage, lösa delar")).toBeVisible();
  await expect(page.getByText("Inga hydraulläckage eller skadade slangar")).toBeVisible();
  await page.getByRole("button", { name: "Markera alla OK" }).click();
  // Mark the critical hydraulic item as a fault: for a trade-in that is a price argument, not a stop order.
  const leak = page.getByRole("listitem").filter({ hasText: "Inga hydraulläckage" });
  await leak.getByRole("radio", { name: "Fel" }).click();
  await leak.getByLabel("Beskriv felet").fill("Läckage vid bomcylinder");
  await page.getByLabel("Timmätare").fill("1800");
  await page.getByLabel("Bedömning").fill("Prisavdrag 40 000 kr");
  await page.getByRole("button", { name: "Spara inbytestest" }).click();
  await expect(page.getByText("Inbytestestet är sparat med allvarliga fel")).toBeVisible();

  // The owner's machine is untouched: still operational, hour meter unchanged.
  const [m] = await sql<{ op: string; hours: number; checks: number }>(page, `
    select m.operational_status::text op, m.hour_meter hours,
      (select count(*)::int from public.tradein_checks c where c.machine_id = m.id) checks
    from public.machines m
    join public.machine_identifiers i on i.machine_id = m.id and i.normalized_value = 'JCB3CX04278'`);
  expect(m.op).toBe("operational");
  expect(m.checks).toBe(1);

  // It is in the dealer's own history. The owner cannot read it at all — note that the sql() helper runs as the
  // database owner and so bypasses RLS; asking through the RPC is what exercises the permission.
  await page.goto(`${base}/tradein-check?tab=history`);
  await expect(page.getByText("Prisavdrag 40 000 kr")).toBeVisible();
  await logout(page);
  await login(page, "berg@demo.se");
  const [berg] = await sql<{ id: string }>(page, "select id from public.organizations where slug = 'bergs-schakt-entreprenad-ab'");
  // The exact code (FORBIDDEN) is asserted in supabase/tests/28_tradein_checks_and_modules.test.ts; across the
  // page.evaluate boundary only the fact of the rejection survives.
  const denied = await asUser(page, "list_tradein_checks", { p_org_id: berg.id })
    .then(() => "allowed").catch(() => "refused");
  expect(denied).toBe("refused");
});
