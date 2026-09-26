import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tx } from "./helpers.ts";

// Same rule as packages/shared isValidOrgNumber (Luhn over the 10 digits), inlined to keep this project self-contained.
function isValidOrgNumber(n: string): boolean {
  const d = n.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const sum = [...d].reduce((s, ch, i) => {
    const v = Number(ch) * (i % 2 === 0 ? 2 : 1);
    return s + (v > 9 ? v - 9 : v);
  }, 0);
  return sum % 10 === 0;
}

describe("demo seed", () => {
  it("uses valid, unique organisation numbers so demo lookups work in the UI", () => {
    const sql = readFileSync(new URL("../seed/00_orgs.sql", import.meta.url), "utf8");
    const numbers = [...sql.matchAll(/seed\.company\('(\d{6}-\d{4})'/g)].map((m) => m[1]!);
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.filter((n) => !isValidOrgNumber(n))).toEqual([]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("matches the demo data set in SPEC §17", async () => {
    await tx(async (t) => {
      await t.as(null);
      const n = async (sql: string) => Number(await t.val(sql));
      const demo = "(select id from public.organizations where slug not like 'test-%')";
      expect(await n(`select count(*) from public.machines where owner_org_id in ${demo} or registered_by_org_id in ${demo}`)).toBe(60);
      const status = Object.fromEntries((await t.q<any>(`select status, count(*)::int n from public.machines m where m.registered_by_org_id in ${demo} group by 1`)).map((r) => [r.status, r.n]));
      expect(status).toMatchObject({ draft: 5, stolen: 2, blocked: 1, scrapped: 3 });
      expect(await n("select count(*) from public.machines where stock_status = 'stock'")).toBe(6);
      expect(await n(`select count(*) from public.encumbrances where status = 'active' and type in ('leasing', 'ownership_reservation') and holder_org_id in ${demo}`)).toBe(8);
      expect(await n(`select count(*) from public.rentals where status = 'active' and lessor_org_id in ${demo}`)).toBe(2);
      expect(await n(`select count(*) from public.transfers where status = 'awaiting_buyer' and from_org_id in ${demo}`)).toBe(1);
      expect(await n("select count(*) from public.conflicts where type = 'duplicate_identifier' and status = 'open'")).toBeGreaterThanOrEqual(1);
      expect(await n("select count(*) from public.market_observations")).toBe(150);
      expect(await n("select count(*) from public.market_alerts where type = 'stolen_machine_listed'")).toBe(1);
      expect(await n("select count(*) from public.market_alerts where type = 'duplicate_serial_in_market'")).toBe(1);
      expect(await n(`select count(*) from public.label_batches where assigned_org_id in ${demo} or assigned_org_id is null`)).toBeGreaterThanOrEqual(3);
      expect(await n("select count(*) from public.labels where status = 'bound'")).toBe(55);
      expect(await n("select count(*) from public.events")).toBeGreaterThanOrEqual(400);
      expect(await n("select count(*) from public.event_anchors where published_at is not null")).toBe(30);
      expect(await t.val("select (app.verify_chain() ->> 'ok')::boolean")).toBe(true);
      expect(await n("select count(distinct approx_location ->> 'city') from public.access_log where via = 'scan'")).toBeGreaterThanOrEqual(5);
      expect(await n("select count(*) from public.machines m join public.organizations o on o.id = m.owner_org_id where o.slug = 'bergs-schakt-entreprenad-ab' and m.status <> 'draft'")).toBe(12);
      expect(await n("select count(*) from public.projects p join public.organizations o on o.id = p.org_id where o.slug = 'bergs-schakt-entreprenad-ab'")).toBe(2);
      expect(await n("select count(*) from public.memberships m join public.organizations o on o.id = m.org_id where o.slug = 'nordmaskin-ab' and m.status = 'active'")).toBe(3);
      expect(await t.val("select is_sole_trader and org_number is null from public.organizations where slug = 'lena-gravmaskin'")).toBe(true);
    });
  });
});
