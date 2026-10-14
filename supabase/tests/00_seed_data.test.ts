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
      // 60 from SPEC §17 plus the four financing-round scenarios (unconnected lender, two payoffs, one export).
      expect(await n(`select count(*) from public.machines where owner_org_id in ${demo} or registered_by_org_id in ${demo}`)).toBe(64);
      const status = Object.fromEntries((await t.q<any>(`select status, count(*)::int n from public.machines m where m.registered_by_org_id in ${demo} group by 1`)).map((r) => [r.status, r.n]));
      expect(status).toMatchObject({ draft: 5, stolen: 2, blocked: 1, scrapped: 3, exported: 1 });
      expect(await n("select count(*) from public.machines where stock_status = 'stock'")).toBe(7);
      expect(await n(`select count(*) from public.encumbrances where status = 'active' and type in ('leasing', 'ownership_reservation') and holder_org_id in ${demo}`)).toBe(11);
      expect(await n(`select count(*) from public.rentals where status = 'active' and lessor_org_id in ${demo}`)).toBe(2);
      expect(await n(`select count(*) from public.transfers where status = 'awaiting_buyer' and from_org_id in ${demo}`)).toBe(1);
      expect(await n("select count(*) from public.conflicts where type = 'duplicate_identifier' and status = 'open'")).toBeGreaterThanOrEqual(1);
      expect(await n("select count(*) from public.market_observations")).toBe(150);
      expect(await n("select count(*) from public.market_alerts where type = 'stolen_machine_listed'")).toBe(1);
      expect(await n("select count(*) from public.market_alerts where type = 'duplicate_serial_in_market'")).toBe(1);
      expect(await n(`select count(*) from public.label_batches where assigned_org_id in ${demo} or assigned_org_id is null`)).toBeGreaterThanOrEqual(3);
      // 55 from SPEC §17 plus one bound on purpose to the exported machine: scanning its QR after the export is
      // the whole point of keeping the label (ADR 0026), so it must not depend on the label budget.
      expect(await n("select count(*) from public.labels where status = 'bound'")).toBe(56);
      expect(await n(`select count(*) from public.machines m where m.status = 'exported'
        and m.export_country = 'NO'
        and exists (select 1 from public.labels l where l.machine_id = m.id and l.status = 'bound')
        and exists (select 1 from public.machine_identifiers i where i.machine_id = m.id and i.type = 'serial' and i.unique_active)`)).toBe(1);
      // A lender that does not use MaskinID yet: an unclaimed placeholder holding a reported financing.
      expect(await n(`select count(*) from public.organizations o where 'financier' = any (o.types)
        and not exists (select 1 from public.memberships m where m.org_id = o.id and m.status = 'active')`)).toBe(1);
      expect(await n(`select count(*) from public.encumbrances e join public.organizations o on o.id = e.holder_org_id
        where e.status = 'pending' and not exists (select 1 from public.memberships m where m.org_id = o.id and m.status = 'active')`)).toBe(1);
      // Two payoff conversations: one the lender has answered, one still waiting on them.
      expect(Object.fromEntries((await t.q<any>("select status, count(*)::int n from public.payoff_requests group by 1")).map((r) => [r.status, r.n])))
        .toEqual({ requested: 1, quoted: 1 });
      // The register stores no amounts, so the payoff table must never grow one (CLAUDE.md rule 5).
      expect(await n(`select count(*) from information_schema.columns where table_name = 'payoff_requests'
        and column_name ~ 'amount|belopp|sum|price|debt|residual'`)).toBe(0);
      expect(await n("select count(*) from public.events")).toBeGreaterThanOrEqual(400);
      expect(await n("select count(*) from public.event_anchors where published_at is not null")).toBe(30);
      expect(await t.val("select (app.verify_chain() ->> 'ok')::boolean")).toBe(true);
      expect(await n("select count(distinct approx_location ->> 'city') from public.access_log where via = 'scan'")).toBeGreaterThanOrEqual(5);
      expect(await n("select count(*) from public.machines m join public.organizations o on o.id = m.owner_org_id where o.slug = 'bergs-schakt-entreprenad-ab' and m.status <> 'draft'")).toBe(12);
      expect(await n("select count(*) from public.projects p join public.organizations o on o.id = p.org_id where o.slug = 'bergs-schakt-entreprenad-ab'")).toBe(2);
      expect(await n("select count(*) from public.memberships m join public.organizations o on o.id = m.org_id where o.slug = 'nordmaskin-ab' and m.status = 'active'")).toBe(3);
      expect(await t.val("select is_sole_trader and org_number is null from public.organizations where slug = 'lena-gravmaskin'")).toBe(true);
      // Nordic Finance: a fifth lender with its own account, so the demo can register financing against it and
      // the bank then confirms it from its own inbox (Rikard's request).
      expect(await t.q(`select o.status::text, o.settings -> 'financing_defaults' ->> 'contract_ref_prefix' as prefix,
          (select count(*)::int from public.memberships m where m.org_id = o.id and m.status = 'active') as members,
          (select count(*)::int from public.encumbrances e where e.holder_org_id = o.id and e.status = 'active') as active
        from public.organizations o where o.slug = 'nordic-finance-demo' and 'financier' = any (o.types)`))
        .toEqual([{ status: "approved", prefix: "NF-", members: 1, active: 1 }]);
      // ...and that lease carries the full terms, so the financing calculator has something to show.
      expect(await t.q(`select e.financing_amount::float8 as amount, e.amortization_months as months, e.total_credit_amount::float8 as credit
        from public.encumbrances e join public.organizations o on o.id = e.holder_org_id
        where o.slug = 'nordic-finance-demo' and e.status = 'active'`))
        .toEqual([{ amount: 1850000, months: 60, credit: 1500000 }]);
      expect((await t.rpc<any[]>("public_stolen_list", {})).length).toBe(2);
      expect(await n("select count(*) from public.tips where machine_id is not null")).toBe(1);
      expect(await n("select count(*) from public.support_tickets where status = 'waiting_customer'")).toBe(1);
      expect(await n(`select count(*) from public.subscriptions where plan_key in ('financier', 'dealer') and org_id in ${demo}`)).toBe(2);
      expect(Object.fromEntries((await t.q<any>(`select status, count(*)::int n from public.invoices where org_id in ${demo} group by 1`)).map((r) => [r.status, r.n])))
        .toEqual({ paid: 1, open: 2 });
      expect(await n(`select count(*) from public.machine_positions p join public.machines m on m.id = p.machine_id where m.owner_org_id in ${demo}`)).toBe(3);
      expect(await n("select count(*) from public.theft_sync_queue where status = 'sent'")).toBe(2);
      expect(await n("select count(*) from public.flags where type = 'stolen' and status = 'active' and external_ref like 'LT-DEMO-%'")).toBe(2);
      expect(await n(`select count(*) from public.memberships m where m.status = 'active' and m.org_id in ${demo} and app.legal_pending(m.user_id) <> '[]'::jsonb`)).toBe(0);
    });
  });
});
