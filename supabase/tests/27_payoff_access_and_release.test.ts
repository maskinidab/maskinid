import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, encumber, machineData, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

/**
 * Two defects the product owner hit, both of which surfaced as "ingen behörighet" (ADR 0030):
 *
 *  1. The dealer could see that a payoff statement had arrived but not open it.
 *  2. The lender got an error instead of a confirmation when it released the block.
 */

const SHA = "c".repeat(64);

async function uploadDoc(t: any, org: string, filename: string, type = "payoff_statement"): Promise<string> {
  const up = await t.rpc("create_document_upload", {
    p_org_id: org, p_machine_id: null, p_type: type, p_filename: filename, p_mime: "application/pdf",
    p_size_bytes: 2048, p_sha256: SHA, p_visibility: "owner_and_financier",
  });
  await t.rpc("finalize_document", { p_org_id: org, p_document_id: up.id });
  return up.id;
}

/** A machine owned by owner_a, financed by financier_a, with the dealer asking for a payoff at trade-in. */
async function tradeInPayoff(t: any) {
  const m = await registerAs(t, "owner_a", machineData());
  await encumber(t, "financier_a", m.id);
  await t.as("dealer");
  const r = await t.rpc("request_trade_in", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_message: "Inbyte", p_request_payoff: true });
  return { m, payoff: r.payoff_request, transfer: r.transfer };
}

describe("the parties to a payoff can open its documents (ADR 0030)", () => {
  it("the dealer that asked for the payoff can open the lender's statement", async () => {
    await tx(async (t) => {
      const { m, payoff, transfer } = await tradeInPayoff(t);
      // The setup that made this fail: the transfer is still a draft, so the dealer has no relation at all.
      expect(transfer.status).toBe("draft");
      await t.as(null);
      expect(await t.val<string[]>("select app.machine_relations($1, array[$2]::uuid[])", [m.id, ORGS.dealer])).toEqual([]);

      await t.as("financier_a");
      const doc = await uploadDoc(t, ORGS.financier_a, "losenbesked.pdf");
      await t.rpc("submit_payoff_quote", {
        p_org_id: ORGS.financier_a, p_payoff_request_id: payoff.id, p_document_id: doc,
        p_reference: "LB-1", p_valid_until: NEXT_YEAR,
      });

      // The dealer: no relation to the machine, but a party to the payoff.
      await t.as("dealer");
      expect((await t.rpc<any>("authorize_document_download", { p_document_id: doc })).filename).toBe("losenbesked.pdf");
      // It shows up in the dealer's own list of payoff requests too, with the document id on it.
      const list = await t.rpc<any[]>("list_payoff_requests", { p_org_id: ORGS.dealer });
      expect(list[0].quote_document_id).toBe(doc);

      // The owner of the machine, and the lender that uploaded it.
      await t.as("owner_a");
      expect((await t.rpc<any>("authorize_document_download", { p_document_id: doc })).filename).toBe("losenbesked.pdf");
      await t.as("financier_a");
      expect((await t.rpc<any>("authorize_document_download", { p_document_id: doc })).filename).toBe("losenbesked.pdf");

      // Nobody else. Being a dealer, or a lender, is not enough.
      for (const who of ["owner_b", "financier_b", "insurer", "inspector"] as const) {
        await t.as(who);
        expect((await t.rpcError("authorize_document_download", { p_document_id: doc })).code, who).toBe("NOT_FOUND");
      }
      await t.as("anon");
      expect((await t.rpcError("authorize_document_download", { p_document_id: doc })).code).toBe("NOT_FOUND");
    });
  });

  it("the lender can open the requester's proof of settlement", async () => {
    await tx(async (t) => {
      const { payoff } = await tradeInPayoff(t);
      await t.as("dealer");
      const proof = await uploadDoc(t, ORGS.dealer, "losenbevis.pdf");
      await t.rpc("submit_payoff_settlement", { p_org_id: ORGS.dealer, p_payoff_request_id: payoff.id, p_document_id: proof });
      await t.as("financier_a");
      expect((await t.rpc<any>("authorize_document_download", { p_document_id: proof })).filename).toBe("losenbevis.pdf");
      await t.as("financier_b");
      expect((await t.rpcError("authorize_document_download", { p_document_id: proof })).code).toBe("NOT_FOUND");
    });
  });

  it("a document that is still being scanned says so, not NOT_FOUND", async () => {
    // Otherwise a dealer clicking "Öppna lösenbesked" seconds after the upload gets the same message as the
    // permission bug just fixed, which is exactly the confusion to avoid.
    await tx(async (t) => {
      const { payoff } = await tradeInPayoff(t);
      await t.as("financier_a");
      const doc = await uploadDoc(t, ORGS.financier_a, "scanning.pdf");
      await t.rpc("submit_payoff_quote", {
        p_org_id: ORGS.financier_a, p_payoff_request_id: payoff.id, p_document_id: doc,
        p_reference: "LB-2", p_valid_until: NEXT_YEAR,
      });
      await t.as(null);
      await t.q("update public.documents set status = 'scanning' where id = $1", [doc]);
      await t.as("dealer");
      expect((await t.rpcError("authorize_document_download", { p_document_id: doc })).code).toBe("DOCUMENT_NOT_READY");
      // A stranger still gets NOT_FOUND: "not ready" must not become a way to probe which ids exist.
      await t.as("owner_b");
      expect((await t.rpcError("authorize_document_download", { p_document_id: doc })).code).toBe("NOT_FOUND");
    });
  });
});

describe("a lender keeps reading what it just released (ADR 0030)", () => {
  it("releasing leaves a former_holder relation instead of nothing", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await encumber(t, "financier_a", m.id);
      const e = await t.val<string>("select id::text from public.encumbrances where machine_id = $1", [m.id]);

      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", e, {});
      expect((await t.rpc<any>("release_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: e, p_signature_id: sig })).ok).toBe(true);

      // Before the fix this was [] and every read of the machine raised NOT_FOUND.
      await t.as(null);
      expect(await t.val<string[]>("select app.machine_relations($1, array[$2]::uuid[])", [m.id, ORGS.financier_a]))
        .toEqual(["former_holder"]);

      await t.as("financier_a");
      const view = await t.rpc<any>("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      // Its own released row is there, so the financing tab renders and the confirmation has something to show.
      expect(view.encumbrances.map((x: any) => x.status)).toEqual(["released"]);
      // Not full access: a released financing is not continued access to the owner's machine.
      expect(view.access).not.toBe("full");
      expect(await t.val("select app.has_full_access(array['former_holder'])")).toBe(false);
    });
  });

  it("the former holder sees its own financing history, including the release itself", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await encumber(t, "financier_a", m.id);
      const e = await t.val<string>("select id::text from public.encumbrances where machine_id = $1", [m.id]);
      // Something in the owner's history that has nothing to do with the financing.
      await t.as("owner_a");
      await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 1234, p_at: TODAY });

      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", e, {});
      await t.rpc("release_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: e, p_signature_id: sig });

      const history = await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      const types = history.map((h) => h.type).sort();
      // The release event is logged *after* released_at is set, so an exact cut-off would hide the one event the
      // confirmation exists to show. A day of slack, as previous_owner already does.
      expect(types).toContain("encumbrance.released");
      expect(types).toContain("encumbrance.registered");
      // Not the owner's unrelated history.
      expect(types.join(",")).not.toMatch(/hours|service|maintenance/);
    });
  });

  it("the grace window ends after 90 days", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await encumber(t, "financier_a", m.id);
      const e = await t.val<string>("select id::text from public.encumbrances where machine_id = $1", [m.id]);
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", e, {});
      await t.rpc("release_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: e, p_signature_id: sig });

      await t.as(null);
      await t.q("update public.encumbrances set released_at = now() - interval '91 days' where id = $1", [e]);
      expect(await t.val<string[]>("select app.machine_relations($1, array[$2]::uuid[])", [m.id, ORGS.financier_a])).toEqual([]);
      await t.as("financier_a");
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id })).code).toBe("NOT_FOUND");
    });
  });

  it("a former holder sees neither another lender's financing nor the terms of one", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await encumber(t, "financier_a", m.id, "rental", NEXT_YEAR);
      const own = await t.val<string>("select id::text from public.encumbrances where machine_id = $1 and holder_org_id = $2",
        [m.id, ORGS.financier_a]);
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", own, {});
      await t.rpc("release_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: own, p_signature_id: sig });

      // A different lender now finances the machine, with terms.
      await t.as("financier_b");
      const params = { type: "leasing", contract_ref: "B-1", start_date: TODAY, end_date: NEXT_YEAR };
      const sig2 = await sign(t, ORGS.financier_b, "register_encumbrance", m.id, params);
      await t.rpc("register_encumbrance", {
        p_org_id: ORGS.financier_b, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "B-1",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_signature_id: sig2,
        p_terms: { financing_amount: 500_000, amortization_months: 36, interest_rate: 5 },
      });

      await t.as("financier_a");
      const view = await t.rpc<any>("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      expect(view.encumbrances.map((x: any) => x.id)).toEqual([own]);
      // Its own row is a rental with nothing filled in, so the terms object is there with null in every field.
      // What must never appear is a figure – least of all the 500 000 the other lender just registered.
      expect(JSON.stringify(view.encumbrances))
        .not.toMatch(/"(financing_amount|down_payment|residual_value|monthly_cost|total_credit_amount|interest_rate|amortization_months)":\s*\d/);
    });
  });
});
