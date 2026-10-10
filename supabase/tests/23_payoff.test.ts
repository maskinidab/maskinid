import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, encumber, registerAs, sign } from "./factories.ts";
import { ORGS, tx, type Tx } from "./helpers.ts";

/**
 * Payoff ("lösen"), step: the lender gets a real work item and releases the block in one approved step.
 *
 * The invariant these tests exist to protect: the encumbrance is released ONLY by the holder, and only with a
 * signature. Uploading proof of settlement changes nothing about the block. And no amount is ever stored.
 */

async function leased(t: Tx, serial: string) {
  const m = await registerAs(t, "owner_a", {
    make: "Volvo", model: "EC220E", year: 2021, category: "excavator_tracked",
    identifiers: [{ type: "serial", value: serial }],
  });
  const r = await encumber(t, "financier_a", m.id);
  return { m, enc: r.encumbrance as { id: string } };
}

async function document(t: Tx, who: "financier_a" | "owner_a", orgId: string, machineId: string | null) {
  await t.as(who);
  const up = await t.rpc<{ id: string }>("create_document_upload", {
    p_org_id: orgId, p_machine_id: machineId, p_type: "payoff_statement", p_filename: "losen.pdf",
    p_mime: "application/pdf", p_size_bytes: 2048, p_sha256: "c".repeat(64), p_visibility: "owner",
  });
  return (await t.rpc<{ id: string }>("finalize_document", { p_org_id: orgId, p_document_id: up.id })).id;
}

describe("payoff requests", () => {
  it("runs the whole conversation and releases the block in the lender's approval", async () => {
    await tx(async (t) => {
      const { m, enc } = await leased(t, "PAYOFF-A1");

      await t.as("owner_a");
      const req = await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "export", p_export_country: "no" });
      expect(req.payoff_request.status).toBe("requested");
      expect(req.payoff_request.export_country).toBe("NO");

      // The lender now has something to work through, not just a bell notification.
      await t.as("financier_a");
      const inbox = await t.rpc<{ items: { kind: string }[] }>("get_inbox", { p_org_id: ORGS.financier_a });
      expect(inbox.items.map((i) => i.kind)).toContain("payoff_request");

      const qdoc = await document(t, "financier_a", ORGS.financier_a, null);
      await t.as("financier_a");
      const quoted = await t.rpc("submit_payoff_quote", {
        p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id, p_document_id: qdoc,
        p_reference: "LOSEN-1", p_valid_until: NEXT_YEAR,
      });
      expect(quoted.payoff_request.status).toBe("quoted");
      expect(quoted.payoff_request.quote_document_id).toBe(qdoc);

      // The requester sees the quote, and can open the document the lender attached.
      await t.as("owner_a");
      const own = await t.rpc<{ items: { kind: string }[] }>("get_inbox", { p_org_id: ORGS.owner_a });
      expect(own.items.map((i) => i.kind)).toContain("payoff_quote");
      const docs = await t.rpc<{ type: string }[]>("list_documents", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(docs.some((d) => d.type === "payoff_statement")).toBe(true);

      const sdoc = await document(t, "owner_a", ORGS.owner_a, m.id);
      await t.as("owner_a");
      const sub = await t.rpc("submit_payoff_settlement", { p_org_id: ORGS.owner_a, p_payoff_request_id: req.payoff_request.id, p_document_id: sdoc });
      expect(sub.payoff_request.status).toBe("settlement_submitted");
      // Proof of settlement must NOT release anything by itself.
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).financing.has_active).toBe(true);

      await t.as("financier_a");
      const fin = await t.rpc<{ items: { kind: string }[] }>("get_inbox", { p_org_id: ORGS.financier_a });
      expect(fin.items.map((i) => i.kind)).toContain("payoff_settlement_review");

      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", enc.id, {});
      const settled = await t.rpc("settle_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id, p_signature_id: sig });
      expect(settled.payoff_request.status).toBe("settled");
      expect(settled.encumbrance.status).toBe("released");

      await t.as("owner_a");
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).financing.has_active).toBe(false);
      // The reminders for the financing are closed, which release_encumbrance always did but the sale path did not.
      await t.as(null);
      expect(Number(await t.val("select count(*) from public.reminders where source_id = $1 and status <> 'done'", [enc.id]))).toBe(0);
    });
  });

  it("only the holder may settle, quote or decline", async () => {
    await tx(async (t) => {
      const { enc } = await leased(t, "PAYOFF-A2");
      await t.as("owner_a");
      const req = await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "sale" });

      // The owner cannot release their own block, however much they would like to.
      expect((await t.rpcError("settle_payoff", { p_org_id: ORGS.owner_a, p_payoff_request_id: req.payoff_request.id })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("submit_payoff_quote", { p_org_id: ORGS.owner_a, p_payoff_request_id: req.payoff_request.id })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("decline_payoff", { p_org_id: ORGS.owner_a, p_payoff_request_id: req.payoff_request.id })).code).toBe("FORBIDDEN");

      // Nor can an unrelated lender.
      await t.as("financier_b");
      expect((await t.rpcError("settle_payoff", { p_org_id: ORGS.financier_b, p_payoff_request_id: req.payoff_request.id })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("submit_payoff_quote", { p_org_id: ORGS.financier_b, p_payoff_request_id: req.payoff_request.id })).code).toBe("FORBIDDEN");
    });
  });

  it("settling needs a signature, and the signature is bound to the encumbrance", async () => {
    await tx(async (t) => {
      const a = await leased(t, "PAYOFF-A3");
      const b = await leased(t, "PAYOFF-A4");
      await t.as("owner_a");
      const req = await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: a.enc.id, p_purpose: "trade_in" });
      await t.as("financier_a");
      expect((await t.rpcError("settle_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id })).code).toBe("SIGNATURE_REQUIRED");
      // A signature for a different encumbrance must not work.
      const wrong = await sign(t, ORGS.financier_a, "release_encumbrance", b.enc.id, {});
      expect((await t.rpcError("settle_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id, p_signature_id: wrong })).code)
        .toBe("SIGNATURE_INVALID");
      const right = await sign(t, ORGS.financier_a, "release_encumbrance", a.enc.id, {});
      expect((await t.rpc("settle_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id, p_signature_id: right })).ok).toBe(true);
    });
  });

  it("one open request per encumbrance, and a decided one cannot be decided twice", async () => {
    await tx(async (t) => {
      const { enc } = await leased(t, "PAYOFF-A5");
      await t.as("owner_a");
      const req = await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "sale" });
      expect((await t.rpcError("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "sale" })).code).toBe("PAYOFF_ALREADY_OPEN");
      await t.as("financier_a");
      await t.rpc("decline_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id, p_reason: "Krediten löper vidare" });
      expect((await t.rpcError("decline_payoff", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id })).code).toBe("PAYOFF_NOT_PENDING");
      // Declining closes the conversation, so a new one may be opened.
      await t.as("owner_a");
      expect((await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "sale" })).ok).toBe(true);
    });
  });

  it("an unrelated organisation sees nothing, by RLS and by RPC", async () => {
    await tx(async (t) => {
      const { enc } = await leased(t, "PAYOFF-A6");
      await t.as("owner_a");
      await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "sale" });

      await t.as("owner_b");
      expect(Number(await t.val("select count(*) from public.payoff_requests"))).toBe(0);
      expect(await t.rpc("list_payoff_requests", { p_org_id: ORGS.owner_b })).toEqual([]);

      // Both parties to the conversation do see it.
      await t.as("owner_a");
      expect((await t.rpc<unknown[]>("list_payoff_requests", { p_org_id: ORGS.owner_a })).length).toBe(1);
      await t.as("financier_a");
      expect((await t.rpc<unknown[]>("list_payoff_requests", { p_org_id: ORGS.financier_a })).length).toBe(1);
    });
  });

  it("a quote past its validity date expires and tells both sides", async () => {
    await tx(async (t) => {
      const { enc } = await leased(t, "PAYOFF-A7");
      await t.as("owner_a");
      const req = await t.rpc("request_payoff", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_purpose: "sale" });
      await t.as("financier_a");
      await t.rpc("submit_payoff_quote", { p_org_id: ORGS.financier_a, p_payoff_request_id: req.payoff_request.id, p_reference: "L-1", p_valid_until: TODAY });
      await t.as(null);
      await t.q("update public.payoff_requests set quote_valid_until = current_date - 1 where id = $1", [req.payoff_request.id]);
      expect(await t.val("select (app.expire_payoff_quotes() ->> 'expired')::int")).toBe(1);
      expect(await t.val("select status::text from public.payoff_requests where id = $1", [req.payoff_request.id])).toBe("expired");
    });
  });

  it("stores no amount, and cannot grow one", async () => {
    await tx(async (t) => {
      await t.as(null);
      // CLAUDE.md rule 5 / SPEC §0: the payoff figure lives only in the lender's document.
      const cols = await t.q<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'payoff_requests'
         and column_name ~ 'amount|belopp|sum|price|debt|residual|sek'`);
      expect(cols.map((c) => c.column_name)).toEqual([]);
    });
  });

  it("a payoff cannot be opened on somebody else's machine, or on one's own encumbrance", async () => {
    await tx(async (t) => {
      const { enc } = await leased(t, "PAYOFF-A8");
      await t.as("owner_b");
      expect((await t.rpcError("request_payoff", { p_org_id: ORGS.owner_b, p_encumbrance_id: enc.id, p_purpose: "sale" })).code).toBe("FORBIDDEN");
      // The lender asking themselves for a payoff is meaningless.
      await t.as("financier_a");
      expect((await t.rpcError("request_payoff", { p_org_id: ORGS.financier_a, p_encumbrance_id: enc.id, p_purpose: "sale" })).code).toBe("FORBIDDEN");
    });
  });

  it("request_encumbrance_release still works and now leaves a tracked request", async () => {
    await tx(async (t) => {
      const { enc } = await leased(t, "PAYOFF-A9");
      await t.as("owner_a");
      expect((await t.rpc("request_encumbrance_release", { p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id, p_message: "Vi vill lösa" })).ok).toBe(true);
      await t.as("financier_a");
      const rows = await t.rpc<{ purpose: string; status: string }[]>("list_payoff_requests", { p_org_id: ORGS.financier_a });
      expect(rows[0]).toMatchObject({ purpose: "owner_request", status: "requested" });
    });
  });

  it("a dealer starting a trade-in can ask the lender for the payoff before the owner approves", async () => {
    await tx(async (t) => {
      const { m } = await leased(t, "PAYOFF-B1");
      await t.as("dealer");
      const r = await t.rpc("request_trade_in", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_message: "Inbyte", p_request_payoff: true });
      // The transfer is still a draft waiting for the owner, but the lender already has the payoff question.
      expect(r.transfer.status).toBe("draft");
      expect(r.payoff_request.purpose).toBe("trade_in");
      await t.as("financier_a");
      const inbox = await t.rpc<{ items: { kind: string }[] }>("get_inbox", { p_org_id: ORGS.financier_a });
      expect(inbox.items.map((i) => i.kind)).toContain("payoff_request");
    });
  });
});
