import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, sql } from "./helpers";

/** WCAG 2.1 AA via axe-core; serious and critical violations fail the suite (step 27). */
async function audit(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(bad, `${name}\n${report}`).toEqual([]);
}

const PUBLIC = ["/", "/how", "/security", "/pricing", "/statistics", "/stolen", "/tips", "/help", "/contact", "/status", "/api-docs", "/login", "/signup"];

for (const path of PUBLIC) {
  test(`a11y ${path}`, async ({ page }) => {
    await page.goto(path);
    await audit(page, path);
  });
}

test("a11y publikt maskinkort och stulen maskin", async ({ page }) => {
  await page.goto("/");
  const [ok] = await sql<{ reg_number: string }>(page, "select reg_number from public.machines where status = 'active' order by reg_number limit 1");
  const [stolen] = await sql<{ reg_number: string }>(page, "select reg_number from public.machines where status = 'stolen' order by reg_number limit 1");
  for (const reg of [ok!.reg_number, stolen!.reg_number]) {
    await page.goto(`/r/${reg}`);
    await audit(page, `/r/${reg}`);
  }
});

test("a11y inloggad: översikt, maskinlista, maskinsida, inkorg", async ({ page }) => {
  const base = await login(page, "berg@demo.se");
  const [m] = await sql<{ id: string }>(page, `select m.id from public.machines m join public.organizations o on o.id = m.owner_org_id
    where o.org_number = '556701-2009' and m.status = 'active' order by m.reg_number limit 1`);
  for (const p of ["dashboard", "machines", `machines/${m!.id}`, "inbox", "daily-check", "settings"]) {
    await page.goto(`${base}/${p}`);
    await audit(page, p);
  }
});
