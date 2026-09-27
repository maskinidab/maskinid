import { expect, test } from "@playwright/test";
import { login, sql } from "./helpers";

/** A Bergs machine without active flags or open transfers. */
async function bergMachine(page: import("@playwright/test").Page) {
  const [m] = await sql<{ id: string; reg_number: string }>(page, `select m.id, m.reg_number from public.machines m
    join public.organizations o on o.id = m.owner_org_id where o.org_number = '556701-2009' and m.status = 'active'
      and not exists (select 1 from public.flags f where f.machine_id = m.id and f.status = 'active') order by m.reg_number limit 1`);
  return m!;
}

// Point 18 (SPEC §20.3): the operator's daily check – a failed critical item puts the machine out of service, a clean
// check brings it back; both are events in the machine's history.
test("daglig kontroll: kritiskt fel ställer maskinen ur drift, ny kontroll utan anmärkning återställer", async ({ page }) => {
  const base = await login(page, "berg@demo.se");
  const m = await bergMachine(page);
  await page.goto(`${base}/daily-check?machine=${m.id}`);
  await page.getByRole("button", { name: "Markera alla OK" }).click();
  const critical = page.locator("ol.checklista > li").filter({ hasText: "kritisk" }).first();
  await critical.getByRole("radio", { name: /Fel/ }).click();
  await critical.getByRole("textbox").fill("Läckage i hydraulslang");
  await page.getByRole("button", { name: "Spara kontrollen" }).click();
  await expect(page.getByText("Kritiskt fel – maskinen är ur drift")).toBeVisible();
  expect((await sql<{ s: string }>(page, "select operational_status s from public.machines where id = $1", [m.id]))[0]!.s).toBe("out_of_service");

  await page.goto(`${base}/daily-check?machine=${m.id}`);
  await page.getByRole("button", { name: "Markera alla OK" }).click();
  await page.getByRole("button", { name: "Spara kontrollen" }).click();
  await expect(page.getByText("Kontrollen är sparad – inga anmärkningar")).toBeVisible();
  expect((await sql<{ s: string }>(page, "select operational_status s from public.machines where id = $1", [m.id]))[0]!.s).toBe("operational");
  const types = (await sql<{ type: string }>(page, "select type from public.events where machine_id = $1 order by seq", [m.id])).map((e) => e.type);
  expect(types.filter((x) => x === "machine.operational_status_changed")).toHaveLength(2);
});

// Point 25 (SPEC §7.8): a telematics connection (demo provider) reports hours and position for the org's own machines.
test("telematik: demokoppling uppdaterar timmätare och position", async ({ page }) => {
  const base = await login(page, "berg@demo.se");
  const state = async () => (await sql<{ hours: number; last: string | null }>(page, `select
      (select count(*)::int from public.events e join public.organizations o on o.id = e.org_id
        where e.type = 'machine.hours_reported' and e.payload ->> 'source' = 'telematics' and o.org_number = '556701-2009') hours,
      (select max(p.reported_at)::text from public.machine_positions p join public.machines m on m.id = p.machine_id
        join public.organizations o on o.id = m.owner_org_id where o.org_number = '556701-2009') last`))[0]!;
  const before = await state();
  await page.goto(`${base}/settings?tab=integrations`);
  await page.locator("main").getByRole("button", { name: "Koppla in telematik" }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "System" }).selectOption({ label: "Demotelematik" });
  await dialog.getByLabel("Namn").fill("Demotelematik E2E");
  await dialog.getByRole("button", { name: "Koppla in" }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator("main li, main article, main tr").filter({ hasText: "Demotelematik E2E" }).first();
  await expect(row).toContainText(/\d+ matchade/, { timeout: 60_000 });
  await expect.poll(async () => (await state()).hours).toBeGreaterThan(before.hours);
  expect((await state()).last! > (before.last ?? "")).toBe(true);
  // Positions of other organisations' machines are never collected.
  expect((await sql<{ n: number }>(page, `select count(*)::int n from public.machine_positions p join public.machines m on m.id = p.machine_id
    join public.organizations o on o.id = m.owner_org_id where o.org_number <> '556701-2009'`))[0]!.n).toBe(0);
});
