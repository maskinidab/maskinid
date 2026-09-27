import { describe, expect, it } from "vitest";
import { encumber, machineData, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("PDF snapshots and e-mail outbox (SPEC §10, §13)", () => {
  it("ownership certificate: owner issues a numbered, hashed snapshot; others are refused; anyone can verify", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      expect(m.owner_org_id).toBe(ORGS.owner_a);
      await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const c = await t.rpc("create_ownership_certificate", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(c.report_number).toMatch(/^B-\d{4}-\d{6}$/);
      expect(c.result).toMatchObject({ machine: { reg_number: m.reg_number }, owner: { name: expect.any(String) }, financing: { has_active: true } });
      expect(JSON.stringify(c.result)).not.toMatch(/amount|price|belopp/i);
      expect(await t.rpc<any[]>("list_ownership_certificates", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).toHaveLength(1);
      await t.as("owner_b");
      expect((await t.rpcError("create_ownership_certificate", { p_org_id: ORGS.owner_b, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      await t.as("anon");
      expect(await t.rpc("verify_report", { p_report_number: c.report_number, p_result_hash: c.result_hash }))
        .toMatchObject({ valid: true, kind: "ownership_certificate", reg_number: m.reg_number, superseded: null });
      expect((await t.rpc("verify_report", { p_report_number: c.report_number, p_result_hash: "0".repeat(64) })).valid).toBe(false);
    });
  });

  it("completed transfer issues a new certificate, e-mails the new owner's admins and supersedes the old one", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      const old = await t.rpc("create_ownership_certificate", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      const today = new Date().toISOString().slice(0, 10);
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b, p_sale_date: today });
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "accept_transfer", init.transfer.id);
      await t.rpc("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: init.transfer.id, p_signature_id: sig });
      await t.as(null);
      const mails = await t.q<any>("select template, data from public.email_outbox where template = 'ownership_certificate' and org_id = $1", [ORGS.owner_b]);
      expect(mails.length).toBeGreaterThan(0);
      expect(mails[0].data).toMatchObject({ reg_number: m.reg_number, certificate_number: expect.stringMatching(/^B-/) });
      await t.as("anon");
      expect((await t.rpc("verify_report", { p_report_number: old.report_number, p_result_hash: old.result_hash })).superseded).toBe("owner_changed");
      await t.as("owner_a");
      expect((await t.rpcError("create_ownership_certificate", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).code).toBe("FORBIDDEN");
    });
  });

  it("machine report: owner and buyer_report share link (service) issue R- snapshots; other scopes refused", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      const r = await t.rpc("create_machine_report", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(r.report_number).toMatch(/^R-\d{4}-\d{6}$/);
      expect(r.result.machine.reg_number).toBe(m.reg_number);
      const link = await t.rpc("create_share_link", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_scope: "buyer_report", p_days: 7 });
      const card = await t.rpc("create_share_link", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_scope: "public_card", p_days: 7 });
      await t.as("owner_b");
      expect((await t.rpcError("create_machine_report", { p_org_id: ORGS.owner_b, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      await t.as("anon");
      expect((await t.rpcError("create_shared_machine_report", { p_token: link.token })).code).toMatch(/permission denied/);
      await t.as("service");
      const sr = await t.rpc("create_shared_machine_report", { p_token: link.token, p_ip_hash: "ip1" });
      expect(sr.result.machine.reg_number).toBe(m.reg_number);
      expect((await t.rpcError("create_shared_machine_report", { p_token: card.token })).code).toBe("NOT_FOUND");
    });
  });

  it("outbox worker: claim leases messages once; failures back off and fail after 5 attempts", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q("update public.email_outbox set status = 'sent'");
      const id = await t.val<string>("insert into public.email_outbox (to_email, template, data) values ('a@example.se', 'notification', '{}') returning id");
      await t.as("service");
      const first = await t.rpc<any[]>("claim_email_outbox", { p_limit: 10 });
      expect(first.map((x) => x.id)).toEqual([id]);
      expect(await t.rpc("claim_email_outbox", { p_limit: 10 })).toEqual([]);
      await t.rpc("record_email_result", { p_id: id, p_ok: false, p_error: "timeout" });
      await t.as(null);
      expect(await t.val("select status from public.email_outbox where id = $1", [id])).toBe("pending");
      await t.q("update public.email_outbox set attempts = 5 where id = $1", [id]);
      await t.as("service");
      await t.rpc("record_email_result", { p_id: id, p_ok: false, p_error: "bounce" });
      await t.as(null);
      expect(await t.val("select status from public.email_outbox where id = $1", [id])).toBe("failed");
    });
  });
});
