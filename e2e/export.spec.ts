import { expect, test } from "@playwright/test";
import { login, signDemo, sql } from "./helpers";

/**
 * Export keeps the machine's identity (ADR 0026).
 *
 * This is the reported defect: exporting a machine made its QR code and the history behind its serial number
 * look deleted. Now export is an event in the machine's life — the label stays bound, the serial stays claimed,
 * and the public card says where the machine went.
 */
test("export: QR-koden och serienumret lever vidare, och maskinen kan återinföras", async ({ page }) => {
  const base = await login(page, "berg@demo.se");

  // A machine of ours with a bound label and no financing in the way.
  const [m] = await sql<{ id: string; reg_number: string; code: string; serial: string }>(page, `
    select m.id, m.reg_number, l.code, i.value serial
    from public.machines m
    join public.labels l on l.machine_id = m.id and l.status = 'bound' and l.role = 'primary'
    join public.machine_identifiers i on i.machine_id = m.id and i.type = 'serial'
    join public.organizations o on o.id = m.owner_org_id
    where o.slug = 'bergs-schakt-entreprenad-ab' and m.status = 'active'
      and not exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status in ('active', 'pending'))
      and not exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier'))
      and not exists (select 1 from public.flags f where f.machine_id = m.id and f.status = 'active')
    order by m.reg_number limit 1`);
  expect(m, "a clean machine with a bound label").toBeTruthy();

  await page.goto(`${base}/machines/${m.id}`);
  await page.getByRole("button", { name: "Avregistrera" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("select").first().selectOption("exported");
  // Choosing export reveals the destination country and explains that the label stays on the machine.
  await expect(dialog.getByText("Märket sitter kvar på maskinen")).toBeVisible();
  await dialog.getByLabel("Till vilket land?").fill("NO");
  await dialog.getByLabel("Tullreferens").fill("TULL-E2E-1");
  await dialog.locator("button[type=submit]").click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // The register kept the identity: label bound, serial still claimed, its own event, country recorded.
  const [after] = await sql<{ status: string; export_country: string; label_status: string; serial_claimed: boolean; exported_events: number }>(page, `
    select m.status, m.export_country,
      (select l.status from public.labels l where l.machine_id = m.id and l.role = 'primary') label_status,
      (select bool_and(i.unique_active) from public.machine_identifiers i where i.machine_id = m.id and i.type = 'serial') serial_claimed,
      (select count(*)::int from public.events e where e.machine_id = m.id and e.type = 'machine.exported') exported_events
    from public.machines m where m.id = $1`, [m.id]);
  expect(after.status).toBe("exported");
  expect(after.export_country).toBe("NO");
  expect(after.label_status).toBe("bound");
  expect(after.serial_claimed).toBe(true);
  expect(after.exported_events).toBe(1);

  // Scanning the QR still works, and says where the machine went.
  await page.goto(`/m/${m.code}`);
  await expect(page.getByText("EXPORTERAD", { exact: true })).toBeVisible();
  await expect(page.getByText("Exporterad till NO", { exact: true })).toBeVisible();
  // The "label replaced" notice must NOT appear: the label is deliberately still on the machine.
  await expect(page.getByText("Märket är utbytt")).toHaveCount(0);

  // Looking the serial up finds the machine again — this is what used to answer "finns inte".
  await page.goto(`${base}/machines/new`);
  // Target the textbox by role: the id-type radios are also labelled "Serienummer" and "PIN".
  await page.getByRole("textbox", { name: "Serienummer" }).fill(m.serial);
  await expect(page.getByText(/finns redan/i)).toBeVisible();

  // Re-import brings it back, and the export stays in the history.
  await page.goto(`${base}/machines/${m.id}`);
  await page.getByRole("button", { name: "Återinför maskinen" }).click();
  await page.locator("dialog[open] button[type=submit]").click();
  await signDemo(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const [back] = await sql<{ status: string; export_country: string; reimported: number }>(page, `
    select m.status, m.export_country,
      (select count(*)::int from public.events e where e.machine_id = m.id and e.type = 'machine.reimported') reimported
    from public.machines m where m.id = $1`, [m.id]);
  expect(back.status).toBe("active");
  expect(back.export_country).toBe("NO");
  expect(back.reimported).toBe(1);
});

/** The seeded exported machine is scannable from the start, so a demo can show it without any setup. */
test("export: den seedade exporterade maskinen går att skanna", async ({ page }) => {
  await login(page, "syd@demo.se");
  const [m] = await sql<{ code: string; export_country: string }>(page, `
    select l.code, m.export_country from public.machines m
    join public.labels l on l.machine_id = m.id and l.status = 'bound'
    where m.status = 'exported' limit 1`);
  expect(m, "the seed contains an exported machine with a bound label").toBeTruthy();
  await page.goto(`/m/${m.code}`);
  await expect(page.getByText("EXPORTERAD", { exact: true })).toBeVisible();
  await expect(page.getByText(`Exporterad till ${m.export_country}`, { exact: true })).toBeVisible();
});
