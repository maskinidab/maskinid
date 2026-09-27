import { expect, test } from "@playwright/test";
import { login, logout, signDemo, sql } from "./helpers";

// Point 19 (SPEC §20.5): the owner gives a dealer a consignment for one machine, signed with BankID; the dealer
// accepts and the machine shows in the dealer's stock while the owner stays the registered owner.
test("kommission: ägaren ger handlaren uppdrag att sälja, handlaren accepterar", async ({ page }) => {
  const berg = await login(page, "berg@demo.se");
  const [m] = await sql<{ id: string; reg_number: string }>(page, `select m.id, m.reg_number from public.machines m
    join public.organizations o on o.id = m.owner_org_id where o.org_number = '556701-2009' and m.status = 'active'
      and not exists (select 1 from public.flags f where f.machine_id = m.id and f.status = 'active')
      and not exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status in ('active', 'pending'))
    order by m.reg_number desc limit 1`);
  await page.goto(`${berg}/machines/${m!.id}`);
  await page.getByRole("button", { name: "Fullmakt / kommission" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Kommission/ }).check();
  await dialog.getByLabel("Ombud", { exact: true }).selectOption({ label: "Nordmaskin AB" });
  await dialog.getByRole("checkbox", { name: /Sälja/ }).check();
  await dialog.getByLabel("Giltig till").fill(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  await dialog.getByRole("button", { name: "Signera med BankID" }).click();
  await signDemo(page);
  await expect(dialog).toHaveCount(0);
  const [mandate] = await sql<{ id: string; status: string; kind: string }>(page, "select id, status, kind from public.mandates where machine_id = $1 order by created_at desc limit 1", [m!.id]);
  expect(mandate).toMatchObject({ status: "pending", kind: "consignment" });

  await logout(page);
  const dealer = await login(page, "nordmaskin@demo.se");
  await page.goto(`${dealer}/mandates`);
  await page.getByRole("row").filter({ hasText: "Bergs Schakt" }).getByRole("button", { name: "Acceptera" }).first().click();
  await expect.poll(async () => (await sql<{ status: string }>(page, "select status from public.mandates where id = $1", [mandate!.id]))[0]!.status).toBe("active");
  await page.goto(`${dealer}/stock`);
  await page.getByRole("tab", { name: /Kommission/ }).click();
  await expect(page.locator("main")).toContainText(new RegExp(`${m!.reg_number.slice(0, 3)}\\W?${m!.reg_number.slice(3)}`));
  await expect(page.locator("main")).toContainText("Bergs Schakt");
  // The owner is still the registered owner; the mandate is an event in the machine's history.
  const [after] = await sql<{ owner: string; events: number }>(page, `select o.org_number owner,
    (select count(*)::int from public.events e where e.machine_id = m.id and e.type like 'mandate.%') events
    from public.machines m join public.organizations o on o.id = m.owner_org_id where m.id = $1`, [m!.id]);
  expect(after).toMatchObject({ owner: "556701-2009" });
  expect(after!.events).toBeGreaterThan(0);
});
