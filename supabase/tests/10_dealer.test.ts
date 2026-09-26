import { describe, expect, it } from "vitest";
import { machineData, registerAs, sign } from "./factories.ts";
import { ORGS, tx, type Tx } from "./helpers.ts";

async function invoice(t: Tx, machineId: string) {
  await t.as("dealer");
  const up = await t.rpc("create_document_upload", { p_org_id: ORGS.dealer, p_machine_id: machineId, p_type: "invoice", p_filename: "faktura.pdf",
    p_mime: "application/pdf", p_size_bytes: 1000, p_sha256: "a".repeat(64), p_visibility: "owner" });
  await t.as(null);
  await t.q("update public.documents set status = 'clean' where id = $1", [up.id]);
  await t.as("dealer");
  return up.id as string;
}

describe("dealer (SPEC §6.3, §7.2)", () => {
  it("new sale from stock: invoice required, buyer accepts, machine becomes level 2 new_sale with first sale recorded", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "dealer");
      expect((await t.q<any>("select stock_status from public.machines where id = $1", [m.id]))[0].stock_status).toBe("stock");
      expect((await t.rpcError("sell_machine", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_buyer: { org_id: ORGS.owner_a }, p_new_sale: true })).detail)
        .toMatchObject({ reason: "invoice_required" });
      const doc = await invoice(t, m.id);
      const r = await t.rpc("sell_machine", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_buyer: { org_id: ORGS.owner_a }, p_new_sale: true, p_document_ids: [doc] });
      expect(r.transfer).toMatchObject({ status: "awaiting_buyer", is_new_sale: true });
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "accept_transfer", r.transfer.id);
      await t.rpc("accept_transfer", { p_org_id: ORGS.owner_a, p_transfer_id: r.transfer.id, p_signature_id: sig });
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v).toMatchObject({ verification_level: 2, verification_method: "new_sale", first_sale_date: expect.any(String), verified_by: "Test Dealer AB" });
      await t.as("dealer");
      const sales = await t.rpc<any[]>("list_sales", { p_org_id: ORGS.dealer });
      expect(sales[0]).toMatchObject({ status: "completed", is_new_sale: true });
      const customers = await t.rpc<any[]>("list_customers", { p_org_id: ORGS.dealer });
      expect(customers.find((c) => c.name === "Test Owner A AB")).toMatchObject({ machines_sold: 1 });
      // A machine that has changed hands can never be a "new sale" again.
      await t.as("owner_a");
      expect((await t.rpcError("sell_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_buyer: { org_id: ORGS.owner_b }, p_new_sale: true })).code).toBe("FORBIDDEN");
    });
  });

  it("stock status only for the dealer's own machines", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "dealer");
      await t.rpc("set_stock_status", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_status: "demo" });
      const other = await registerAs(t, "owner_a");
      await t.as("dealer");
      expect((await t.rpcError("set_stock_status", { p_org_id: ORGS.dealer, p_machine_id: other.id, p_status: "stock" })).code).toBe("NOT_FOUND");
      await t.as("owner_a");
      expect((await t.rpcError("set_stock_status", { p_org_id: ORGS.owner_a, p_machine_id: other.id, p_status: "stock" })).code).toBe("FORBIDDEN");
    });
  });

  it("ad card is public only while in dealer stock; leads go to the dealer only, with consent and rate limit", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "dealer", machineData());
      const own = await registerAs(t, "owner_a");
      await t.as("anon");
      const ad = await t.rpc("public_ad_card", { p_reg: m.reg_number });
      expect(ad).toMatchObject({ found: true, dealer: { name: "Test Dealer AB" } });
      expect(Object.keys(ad.card)).not.toContain("owner");
      expect((await t.rpc("public_ad_card", { p_reg: own.reg_number })).found).toBe(false);
      await t.as("service");
      expect((await t.rpcError("submit_lead", { p_reg: m.reg_number, p_name: "Kalle", p_contact: "kalle@example.se", p_message: "Pris?", p_consent: false, p_ip_hash: "ip1" })).code).toBe("VALIDATION");
      await t.rpc("submit_lead", { p_reg: m.reg_number, p_name: "Kalle", p_contact: "kalle@example.se", p_message: "Pris?", p_consent: true, p_ip_hash: "ip1" });
      await t.as("dealer");
      const leads = await t.rpc<any[]>("list_leads", { p_org_id: ORGS.dealer });
      expect(leads[0]).toMatchObject({ name: "Kalle", status: "new", reg_number: m.reg_number });
      await t.rpc("update_lead", { p_org_id: ORGS.dealer, p_lead_id: leads[0].id, p_status: "contacted" });
      await t.as("owner_a");
      expect(await t.q("select id from public.leads")).toHaveLength(0);
      await t.as("service");
      for (let i = 0; i < 4; i++) await t.rpc("submit_lead", { p_reg: m.reg_number, p_name: "X", p_contact: "x@example.se", p_message: null, p_consent: true, p_ip_hash: "ip2" });
      await t.rpc("submit_lead", { p_reg: m.reg_number, p_name: "X", p_contact: "x@example.se", p_message: null, p_consent: true, p_ip_hash: "ip2" });
      expect((await t.rpcError("submit_lead", { p_reg: m.reg_number, p_name: "X", p_contact: "x@example.se", p_message: null, p_consent: true, p_ip_hash: "ip2" })).code).toBe("RATE_LIMITED");
    });
  });

  it("trade-in lookup shows the dealer financing yes/no and holder; only dealers", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("dealer");
      const r = await t.rpc("trade_in_lookup", { p_org_id: ORGS.dealer, p_reg: m.reg_number });
      expect(r).toMatchObject({ financing: { has_active: false }, is_owner: false });
      expect(r.history.map((h: any) => h.type)).toContain("machine.registered");
      await t.as("financier_a");
      expect((await t.rpcError("trade_in_lookup", { p_org_id: ORGS.financier_a, p_reg: m.reg_number })).code).toBe("FORBIDDEN");
    });
  });
});
