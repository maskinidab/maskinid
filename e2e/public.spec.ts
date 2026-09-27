import { expect, test } from "@playwright/test";
import { login, logout, sql } from "./helpers";

// Point 20 (SPEC §20.8): the public stolen list and a tip about a stolen machine – the owner is told at once, the
// operator sees the tip in the queue, and the tipster's contact details stay with the operator.
test("publik stöldlista och tips om stulen maskin", async ({ page }) => {
  await page.goto("/stolen");
  await expect(page.getByRole("heading", { name: "Stulna maskiner", level: 1 })).toBeVisible();
  const first = page.locator("ul.stold-lista > li").first();
  await expect(first).toBeVisible();
  const reg = (await sql<{ reg_number: string }>(page, "select reg_number from public.machines where status = 'stolen' order by reg_number limit 1"))[0]!.reg_number;
  // The list shows no owner and no position.
  const listText = await page.locator("ul.stold-lista").innerText();
  expect(listText).not.toMatch(/AB\b|Ägare/);

  await page.goto("/tips");
  await page.getByLabel(/Registreringsnummer eller serienummer/).fill(reg);
  await page.getByLabel("Beskriv vad du har sett").fill("Maskinen står bakom en lagerlokal vid hamnen sedan i går.");
  await page.getByLabel("Ort").fill("Norrköping");
  await page.getByLabel(/Telefon eller e-post/).fill("tipsare@example.se");
  await page.getByRole("button", { name: "Skicka tipset" }).click();
  await expect(page.getByText("Tack för tipset")).toBeVisible();
  const [tip] = await sql<{ id: string; machine_id: string | null }>(page, "select id, machine_id from public.tips order by created_at desc limit 1");
  expect(tip!.machine_id).not.toBeNull();
  const [n] = await sql<{ owner: number; contact_leaked: number }>(page, `select
      (select count(*)::int from public.notifications where type = 'tip.stolen_machine' and data ->> 'machine_id' = $1) owner,
      (select count(*)::int from public.notifications where type = 'tip.stolen_machine' and data::text like '%tipsare@example.se%') contact_leaked`,
    [tip!.machine_id]);
  expect(n!.owner).toBeGreaterThan(0);
  expect(n!.contact_leaked).toBe(0);

  const admin = await login(page, "admin@demo.se");
  await page.goto(`${admin}/admin/tips`);
  await expect(page.getByText("Maskinen står bakom en lagerlokal").first()).toBeVisible();
  await expect(page.getByText(/tipsare@example.se/).first()).toBeVisible();
  await logout(page);
});

// Point 23 (SPEC §20.12): public statistics never show groups of 1–4 machines; the environment data downloads as CSV.
test("publik statistik utan små celler", async ({ page }) => {
  await page.goto("/statistics");
  await expect(page.getByRole("heading", { name: "Statistik", level: 1 })).toBeVisible();
  await expect(page.getByText(/visas som "<5"/)).toBeVisible();
  const stats = await page.evaluate(async () => (window as unknown as { __maskinidTest: { rpcAs(r: string, f: string, a: unknown): Promise<unknown> } })
    .__maskinidTest.rpcAs("anon", "public_statistics", {})) as Record<string, unknown>;
  expect(stats.suppressed).toBe(true);
  const cells = ["by_category", "by_level", "by_emission_stage", "by_fuel", "by_county", "by_age"]
    .flatMap((k) => stats[k] as { n: number | null }[]);
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells) expect(c.n === null || c.n >= 5).toBe(true);
  for (const r of stats.environment as { n: number }[]) expect(r.n).toBeGreaterThanOrEqual(5);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Ladda ner|CSV/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^maskinid-miljostatistik-\d{4}-\d{2}-\d{2}\.csv$/);
});

// Point 26 (SPEC §21): /status shows the register, the latest anchor and the scheduled jobs; failing jobs are shown.
test("driftstatus visar jobb och kontrollvärde", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Driftstatus" })).toBeVisible();
  await expect(page.getByText("Alla system fungerar")).toBeVisible();
  await expect(page.getByText(/Alla \d+ körs utan fel/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Senaste kontrollvärde" })).toBeVisible();

  await sql(page, "update public.jobs set consecutive_failures = 3, last_error = 'e2e' where name = 'cleanup'");
  await page.reload();
  await expect(page.getByText("Vissa bakgrundsjobb har fel")).toBeVisible();
  await expect(page.getByText(/1 av \d+ har fel/)).toBeVisible();

  const admin = await login(page, "admin@demo.se");
  await page.goto(`${admin}/admin/jobs`);
  await expect(page.getByText("cleanup").first()).toBeVisible();
  await expect(page.getByText("e2e").first()).toBeVisible();
});
