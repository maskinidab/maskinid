import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, encParams, encumber, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

/**
 * The two financing paths the product owner asked for and that had no server-side coverage:
 * the lender attaching its own agreement, and exporting a financed machine through a payoff.
 */

const SHA = "b".repeat(64);

async function uploadDoc(t: any, org: string, machineId: string | null, type = "financing_contract"): Promise<string> {
  const up = await t.rpc("create_document_upload", {
    p_org_id: org, p_machine_id: machineId, p_type: type, p_filename: "avtal.pdf", p_mime: "application/pdf",
    p_size_bytes: 1024, p_sha256: SHA, p_visibility: "owner_and_financier",
  });
  await t.rpc("finalize_document", { p_org_id: org, p_document_id: up.id });
  return up.id;
}

describe("the lender's own document path (SPEC §6.5)", () => {
  it("a lender uploads the agreement without a machine and register_encumbrance adopts it", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("financier_a");
      // A bank is not a party to the machine yet, so it may only upload at organisation level.
      const doc = await uploadDoc(t, ORGS.financier_a, null);
      expect((await t.rpcError("create_document_upload", {
        p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "financing_contract", p_filename: "x.pdf",
        p_mime: "application/pdf", p_size_bytes: 10, p_sha256: SHA,
      })).code).toBe("FORBIDDEN");

      const sig = await sign(t, ORGS.financier_a, "register_encumbrance", m.id, encParams("leasing", "DOC-1", TODAY, NEXT_YEAR));
      const r = await t.rpc("register_encumbrance", {
        p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "DOC-1",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_counterparty_org_id: ORGS.owner_a, p_signature_id: sig,
        p_document_ids: [doc],
      });
      expect(r.ok).toBe(true);
      await t.as(null);
      // Adopted onto the machine and shared with both sides, so the owner can read what the bank registered.
      const d = await t.one<{ machine_id: string; visibility: string }>("select machine_id, visibility from public.documents where id = $1", [doc]);
      expect(d.machine_id).toBe(m.id);
      expect(d.visibility).toBe("owner_and_financier");
      expect(await t.val("select document_ids[1]::text from public.encumbrances where machine_id = $1", [m.id])).toBe(doc);
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.financing.active.documents?.length).toBe(1);
    });
  });

  it("a document belonging to another machine is refused", async () => {
    await tx(async (t) => {
      const mine = await registerAs(t, "owner_a");
      const other = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const doc = await uploadDoc(t, ORGS.owner_a, other.id);
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "register_encumbrance", mine.id, encParams("leasing", "X", TODAY, NEXT_YEAR));
      expect((await t.rpcError("register_encumbrance", {
        p_org_id: ORGS.financier_a, p_machine_id: mine.id, p_type: "leasing", p_contract_ref: "X",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_counterparty_org_id: ORGS.owner_a, p_signature_id: sig,
        p_document_ids: [doc],
      })).code).toBe("FORBIDDEN");
    });
  });
});

describe("export of a financed machine goes through the payoff (SPEC §6.9)", () => {
  it("the block stops the export, the lender releases it, and then the export goes through", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const enc = await encumber(t, "financier_a", m.id);

      // 1. Export is refused while the credit is live.
      await t.as("owner_a");
      const sig1 = await sign(t, ORGS.owner_a, "deregister_machine", m.id, { reason: "exported", label_disposition: "kept" });
      expect((await t.rpcError("deregister_machine", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "exported", p_label_disposition: "kept",
        p_signature_id: sig1, p_export_country: "NO",
      })).code).toBe("ENCUMBRANCE_BLOCKS_DEREGISTRATION");

      // 2. The owner asks for a payoff for the export, and says where the machine is going.
      const p = await t.rpc("request_payoff", {
        p_org_id: ORGS.owner_a, p_encumbrance_id: enc.encumbrance.id, p_purpose: "export",
        p_export_country: "NO", p_export_customs_ref: "TULL-1",
      });
      expect(p.payoff_request.purpose).toBe("export");
      expect(p.payoff_request.export_country).toBe("NO");

      // 3. The owner cannot release it themselves, whatever they upload.
      await t.as("owner_a");
      expect((await t.rpcError("settle_payoff", { p_org_id: ORGS.owner_a, p_payoff_request_id: p.payoff_request.id })).code).toBe("FORBIDDEN");

      // 4. Only the lender, with a signature.
      await t.as("financier_a");
      const sig2 = await sign(t, ORGS.financier_a, "release_encumbrance", enc.encumbrance.id, {});
      await t.rpc("settle_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: p.payoff_request.id, p_signature_id: sig2 });
      await t.as(null);
      expect(await t.val("select status from public.encumbrances where id = $1", [enc.encumbrance.id])).toBe("released");

      // 5. Now the export goes through, and the machine keeps its identity (ADR 0026).
      await t.as("owner_a");
      const sig3 = await sign(t, ORGS.owner_a, "deregister_machine", m.id, { reason: "exported", label_disposition: "kept" });
      const r = await t.rpc("deregister_machine", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "exported", p_label_disposition: "kept",
        p_signature_id: sig3, p_export_country: "NO", p_export_customs_ref: "TULL-1",
      });
      expect(r.ok).toBe(true);
      await t.as(null);
      const after = await t.one<{ status: string; export_country: string }>(
        "select status, export_country from public.machines where id = $1", [m.id]);
      expect(after).toEqual({ status: "exported", export_country: "NO" });
    });
  });

  it("a payoff for a sale is a tracked request the lender can answer", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const enc = await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b });
      const p = await t.rpc("request_payoff", {
        p_org_id: ORGS.owner_a, p_encumbrance_id: enc.encumbrance.id, p_purpose: "sale", p_transfer_id: init.transfer.id,
      });
      expect(p.payoff_request.purpose).toBe("sale");
      // The lender sees it as work to do, next to the transfer decision they already had.
      await t.as("financier_a");
      const inbox = await t.rpc("get_inbox", { p_org_id: ORGS.financier_a });
      const kinds = inbox.items.map((x: { kind: string }) => x.kind);
      expect(kinds).toContain("payoff_request");
      expect(kinds).toContain("transfer_financier");
    });
  });
});
