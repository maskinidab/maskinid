import { describe, expect, it } from "vitest";
import { machineData, registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const usage = (b: any, metric: string) => b.usage.find((u: any) => u.metric === metric);

describe("billing: plans and prices (step 23)", () => {
  it("anyone can read public plans and the price list; the public-sector plan is not listed", async () => {
    await tx(async (t) => {
      await t.as("anon");
      const r = await t.rpc<any>("list_plans", {});
      const keys = r.plans.map((p: any) => p.key);
      expect(keys).toEqual(expect.arrayContaining(["free", "dealer", "financier", "insurer", "marketplace", "enterprise"]));
      expect(keys).not.toContain("public_sector");
      expect(r.price_items).toMatchObject({ check: 4900, register_extract: 9900 });
      expect(r.vat_rate).toBe(0.25);
      expect(r.plans.find((p: any) => p.key === "financier").unit_prices.check).toBe(1500);
    });
  });

  it("billing tables are closed to direct access", async () => {
    await tx(async (t) => {
      await t.as("financier_a");
      for (const table of ["plans", "price_items", "subscriptions", "usage_records", "invoices", "billing_events"]) {
        expect(await t.q(`select * from public.${table}`)).toEqual([]);
      }
    });
  });
});

describe("billing: usage metering and overview (step 23)", () => {
  it("checks, API calls and label orders are metered per org; only org admins see billing", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("financier_a");
      await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      await t.as("service");
      await t.q(`insert into public.api_requests (org_id, endpoint, method, status_code) values ($1, '/machines', 'GET', 200), ($1, '/machines', 'GET', 500), ($1, '/x', 'GET', 429)`,
        [ORGS.financier_a]);
      await t.as("owner_a");
      await t.rpc("order_labels", { p_org_id: ORGS.owner_a, p_quantity: 25 });

      await t.as("financier_a");
      const b = await t.rpc<any>("get_billing", { p_org_id: ORGS.financier_a });
      expect(b.plan.key).toBe("free");
      expect(usage(b, "check")).toMatchObject({ used: 2, included: 3, billable: 0 });
      expect(usage(b, "api_call").used).toBe(1);
      await t.as("owner_a");
      const o = await t.rpc<any>("get_billing", { p_org_id: ORGS.owner_a });
      expect(usage(o, "label_qr")).toMatchObject({ used: 25, billable: 25, unit_price_ore: 2000, amount_ore: 50000 });
      expect(o.estimate).toMatchObject({ subtotal_ore: 50000, vat_ore: 12500, total_ore: 62500 });
      expect(o.available_plans.map((p: any) => p.key)).not.toContain("financier");

      expect((await t.rpcError("get_billing", { p_org_id: ORGS.financier_a })).code).toBe("FORBIDDEN");
      await t.as("owner_a_readonly");
      expect((await t.rpcError("get_billing", { p_org_id: ORGS.owner_a })).code).toBe("FORBIDDEN");
    });
  });

  it("authorities are on the public-sector plan and never billed", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("authority");
      await t.rpc("perform_check", { p_org_id: ORGS.authority, p_query: { reg: m.reg_number } });
      const b = await t.rpc<any>("get_billing", { p_org_id: ORGS.authority });
      expect(b.plan.key).toBe("public_sector");
      expect(b.estimate.total_ore).toBe(0);
    });
  });
});

describe("billing: plans, checkout and provider events (step 23)", () => {
  it("free plans switch directly, paid plans require checkout; wrong org type is rejected", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      expect((await t.rpcError("choose_plan", { p_org_id: ORGS.dealer, p_plan_key: "dealer" })).code).toBe("PAYMENT_REQUIRED");
      expect((await t.rpcError("choose_plan", { p_org_id: ORGS.dealer, p_plan_key: "financier" })).code).toBe("VALIDATION");
      expect((await t.rpcError("choose_plan", { p_org_id: ORGS.dealer, p_plan_key: "public_sector" })).code).toBe("VALIDATION");
      await t.rpc("choose_plan", { p_org_id: ORGS.dealer, p_plan_key: "free" });
      const ctx = await t.rpc<any>("billing_checkout_context", { p_org_id: ORGS.dealer, p_plan_key: "dealer" });
      expect(ctx).toMatchObject({ org_id: ORGS.dealer, plan: { key: "dealer", monthly_fee_ore: 99000 } });
      expect(await t.val("select count(*)::int from public.events where type = 'billing.plan_changed' and org_id = $1", [ORGS.dealer])).toBe(1);
      expect(await t.val("select payload::text from public.events where type = 'billing.plan_changed' and org_id = $1", [ORGS.dealer])).not.toMatch(/ore/);
    });
  });

  it("a checkout webhook activates the plan once (idempotent) and a cancelled subscription falls back to free", async () => {
    await tx(async (t) => {
      await t.as("service");
      const ev = { data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_1", metadata: { org_id: ORGS.dealer, plan: "dealer" } } } };
      await t.rpc("billing_record_event", { p_provider: "stripe", p_event_id: "evt_1", p_type: "checkout.session.completed", p_payload: ev });
      expect((await t.rpc<any>("billing_record_event", { p_provider: "stripe", p_event_id: "evt_1", p_type: "checkout.session.completed", p_payload: ev })).duplicate).toBe(true);
      await t.as("dealer");
      let b = await t.rpc<any>("get_billing", { p_org_id: ORGS.dealer });
      expect(b.plan.key).toBe("dealer");
      expect(b.subscription).toMatchObject({ status: "active", provider: "stripe", has_payment_method: true });
      expect(await t.val("select count(*)::int from public.notifications where type = 'billing.plan_changed' and org_id = $1", [ORGS.dealer])).toBeGreaterThan(0);

      await t.as("service");
      await t.rpc("billing_record_event", { p_provider: "stripe", p_event_id: "evt_2", p_type: "customer.subscription.deleted", p_payload: { data: { object: { id: "sub_1", status: "canceled" } } } });
      await t.as("dealer");
      b = await t.rpc<any>("get_billing", { p_org_id: ORGS.dealer });
      expect(b.plan.key).toBe("free");
    });
  });

  it("service-only functions are not callable by users", async () => {
    await tx(async (t) => {
      await t.as("operator");
      for (const [fn, args] of [
        ["billing_apply_subscription", { p_org_id: ORGS.dealer, p_plan_key: "dealer", p_status: "active", p_provider: "mock", p_customer_id: null, p_subscription_id: null, p_period_end: null }],
        ["close_billing_period", { p_period: "2026-01-01" }],
        ["billing_record_event", { p_provider: "stripe", p_event_id: "x", p_type: "x", p_payload: {} }],
      ] as const) {
        expect((await t.rpcError(fn, args)).code).toMatch(/FORBIDDEN|42501|permission/i);
      }
    });
  });
});

describe("billing: monthly invoices (step 23)", () => {
  it("closing a period invoices fee + usage above the plan with 25 % VAT, once; paid via provider event", async () => {
    await tx(async (t) => {
      await t.as("service");
      await t.rpc("billing_apply_subscription", { p_org_id: ORGS.financier_a, p_plan_key: "financier", p_status: "active", p_provider: "stripe",
        p_customer_id: "cus_fa", p_subscription_id: "sub_fa", p_period_end: null });
      await t.q("update public.subscriptions set started_at = '2026-07-15' where org_id = $1", [ORGS.financier_a]);
      // 520 checks in August: 500 included, 20 × 15 kr billable.
      await t.q(`insert into public.usage_records (org_id, metric, quantity, period, ref) select $1, 'check', 1, '2026-08-01', 'test-check-' || g from generate_series(1, 520) g`,
        [ORGS.financier_a]);
      const r = await t.rpc<any>("close_billing_period", { p_period: "2026-08-01" });
      expect(r.created).toBeGreaterThanOrEqual(1);
      expect((await t.rpc<any>("close_billing_period", { p_period: "2026-08-01" })).created).toBe(0);
      expect((await t.rpcError("close_billing_period", { p_period: "2099-01-01" })).code).toBe("VALIDATION");

      await t.as("financier_a");
      const b = await t.rpc<any>("get_billing", { p_org_id: ORGS.financier_a });
      const inv = b.invoices.find((i: any) => i.period === "2026-08-01");
      expect(inv).toMatchObject({ subtotal_ore: 490000 + 20 * 1500, vat_ore: 130000, total_ore: 650000, status: "open", provider: "stripe" });
      const full = await t.rpc<any>("get_invoice", { p_org_id: ORGS.financier_a, p_invoice_id: inv.id });
      expect(full.lines).toEqual([
        expect.objectContaining({ kind: "plan", item: "financier", amount_ore: 490000 }),
        expect.objectContaining({ kind: "usage", item: "check", used: 520, included: 500, quantity: 20, amount_ore: 30000 }),
      ]);
      await t.as("financier_b");
      expect((await t.rpcError("get_invoice", { p_org_id: ORGS.financier_b, p_invoice_id: inv.id })).code).toBe("NOT_FOUND");

      await t.as("service");
      expect((await t.rpc<any[]>("billing_pending_invoices", {})).map((x) => x.id)).toContain(inv.id);
      await t.rpc("billing_set_invoice_provider", { p_invoice_id: inv.id, p_provider_invoice_id: "in_1", p_url: "https://invoice.stripe.com/i/test" });
      await t.rpc("billing_record_event", { p_provider: "stripe", p_event_id: "evt_paid", p_type: "invoice.paid", p_payload: { data: { object: { id: "in_1" } } } });
      expect(await t.val("select status from public.invoices where id = $1", [inv.id])).toBe("paid");
      expect(await t.val("select count(*)::int from public.email_outbox where template = 'invoice'")).toBeGreaterThanOrEqual(1);
    });
  });

  it("demo mock payment and operator price changes are restricted", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("order_labels", { p_org_id: ORGS.owner_a, p_quantity: 10 });
      await t.as("service");
      await t.q("update public.usage_records set period = '2026-08-01' where org_id = $1", [ORGS.owner_a]);
      await t.rpc("close_billing_period", { p_period: "2026-08-01" });
      const id = await t.val<string>("select id from public.invoices where org_id = $1 and period = '2026-08-01'", [ORGS.owner_a]);
      expect(await t.val("select total_ore from public.invoices where id = $1", [id])).toBe("25000");
      await t.as("owner_b");
      expect((await t.rpcError("billing_mock_pay", { p_org_id: ORGS.owner_b, p_invoice_id: id })).code).toBe("NOT_FOUND");
      await t.as("owner_a");
      await t.rpc("billing_mock_pay", { p_org_id: ORGS.owner_a, p_invoice_id: id });

      await t.as("verifier");
      expect((await t.rpcError("admin_set_price", { p_key: "check", p_unit_price_ore: 100 })).code).toBe("FORBIDDEN");
      expect((await t.rpc<any>("admin_billing_overview", {})).invoices.length).toBeGreaterThan(0);
      await t.as("operator");
      await t.rpc("admin_set_price", { p_key: "check", p_unit_price_ore: 5900 });
      expect((await t.rpcError("admin_set_price", { p_key: "check", p_unit_price_ore: -1 })).code).toBe("VALIDATION");
      expect((await t.rpcError("admin_set_plan", { p_key: "dealer", p_monthly_fee_ore: 1, p_included: { bogus: 1 }, p_unit_prices: {}, p_active: true })).code).toBe("VALIDATION");
      await t.rpc("admin_set_plan", { p_key: "dealer", p_monthly_fee_ore: 109000, p_included: { check: 60 }, p_unit_prices: { check: 2900 }, p_active: true });
      await t.as("anon");
      const r = await t.rpc<any>("list_plans", {});
      expect(r.price_items.check).toBe(5900);
      expect(r.plans.find((p: any) => p.key === "dealer")).toMatchObject({ monthly_fee_ore: 109000, included: { check: 60 } });
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action like 'billing.%'")).toBeGreaterThanOrEqual(2);
    });
  });
});
