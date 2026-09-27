import { describe, expect, it } from "vitest";
import { encumber, machineData, registerAs, serial, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

async function doc(t: any, machineId: string, type: string) {
  await t.as("owner_a");
  const up = await t.rpc("create_document_upload", {
    p_org_id: ORGS.owner_a, p_machine_id: machineId, p_type: type, p_filename: `${type}.pdf`,
    p_mime: type.startsWith("photo") ? "image/jpeg" : "application/pdf", p_size_bytes: 100, p_sha256: "b".repeat(64),
  });
  return (await t.rpc("finalize_document", { p_org_id: ORGS.owner_a, p_document_id: up.id })).id as string;
}

describe("verification (SPEC §6.4, step 7)", () => {
  it("level 1: documents required; operator queue; approval raises level and notifies", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const inv = await doc(t, m.id, "invoice");
      const photo = await doc(t, m.id, "photo_nameplate");
      await t.as("owner_a");
      expect((await t.rpcError("request_verification", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_level: 1, p_document_ids: [inv] })).detail)
        .toMatchObject({ reason: "invoice_and_nameplate_photo_required" });
      const r = await t.rpc("request_verification", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_level: 1, p_document_ids: [inv, photo] });
      expect(r.status).toBe("open");
      await t.as("dealer");
      expect(await t.rpc<any[]>("list_verification_queue", { p_org_id: ORGS.dealer })).toHaveLength(0);
      expect((await t.rpcError("decide_verification", { p_org_id: ORGS.dealer, p_request_id: r.id, p_decision: "approved" })).code).toBe("FORBIDDEN");
      await t.as("verifier");
      const q = await t.rpc<any[]>("list_verification_queue", { p_org_id: ORGS.operator });
      expect(q.map((x) => x.id)).toContain(r.id);
      const claimed = await t.rpc("claim_verification", { p_org_id: ORGS.operator, p_request_id: r.id });
      expect(claimed.documents).toHaveLength(2);
      await t.rpc("decide_verification", { p_org_id: ORGS.operator, p_request_id: r.id, p_decision: "approved" });
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v).toMatchObject({ verification_level: 1, verification_method: "documents", verified_by: "Test Operatör AB" });
      expect((await t.rpc<any[]>("list_notifications")).some((n) => n.type === "machine.verified")).toBe(true);
    });
  });

  it("partner queue, needs_info round trip and financier limited to level 1", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const inv = await doc(t, m.id, "invoice");
      const photo = await doc(t, m.id, "photo_nameplate");
      await t.as("owner_a");
      expect((await t.rpcError("request_verification", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_level: 2, p_reviewer_org_id: ORGS.financier_a })).code).toBe("VALIDATION");
      const r = await t.rpc("request_verification", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_level: 1, p_document_ids: [inv, photo], p_reviewer_org_id: ORGS.financier_a,
      });
      await t.as("financier_a");
      // The assigned reviewer can see the machine and its verifier documents
      const docs = await t.rpc<any[]>("list_documents", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      expect(docs).toHaveLength(2);
      await t.rpc("decide_verification", { p_org_id: ORGS.financier_a, p_request_id: r.id, p_decision: "needs_info", p_note: "Otydlig faktura" });
      await t.as("owner_a");
      const inbox = await t.rpc("get_inbox", { p_org_id: ORGS.owner_a });
      expect(inbox.items.map((i: any) => i.kind)).toContain("verification_needs_info");
      await t.rpc("update_verification_request", { p_org_id: ORGS.owner_a, p_request_id: r.id, p_document_ids: [inv], p_note: "Ny" });
      await t.as("financier_a");
      const done = await t.rpc("decide_verification", { p_org_id: ORGS.financier_a, p_request_id: r.id, p_decision: "approved" });
      expect(done.status).toBe("approved");
    });
  });

  it("level 2 requires the nameplate to match; binds the label; dealer on-site verification at trade-in", async () => {
    await tx(async (t) => {
      const s = serial("PHY");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("owner_a");
      const r = await t.rpc("request_verification", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_level: 2, p_reviewer_org_id: ORGS.inspector });
      await t.as("operator");
      const b = await t.rpc("print_label_batch", { p_quantity: 1, p_assigned_org_id: ORGS.inspector });
      await t.as(null);
      const code = await t.val<string>("select code from public.labels where batch_id = $1", [b.id]);
      await t.as("inspector");
      const bad = await t.rpcError("decide_verification", {
        p_org_id: ORGS.inspector, p_request_id: r.id, p_decision: "approved", p_nameplate_serial: "WRONG123",
      });
      expect(bad.code).toBe("NAMEPLATE_MISMATCH");
      await t.rpc("decide_verification", {
        p_org_id: ORGS.inspector, p_request_id: r.id, p_decision: "approved", p_nameplate_serial: s.toLowerCase(), p_label_code: code,
      });
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.verification_level).toBe(2);
      expect(v.labels[0].code).toBe(code);
      expect(v.identifiers[0].verified).toBe(true);

      const m2 = await registerAs(t, "owner_a");
      await t.as("dealer");
      expect((await t.rpcError("verify_on_site", { p_org_id: ORGS.dealer, p_machine_id: m2.id, p_nameplate_serial: "x" })).code).toBe("FORBIDDEN");
      await t.rpc("request_trade_in", { p_org_id: ORGS.dealer, p_machine_id: m2.id });
      await t.as("owner_a");
      const inbox = await t.rpc("get_inbox", { p_org_id: ORGS.owner_a });
      const tr = inbox.items.find((i: any) => i.kind === "trade_in_approve");
      await t.rpc("approve_trade_in", { p_org_id: ORGS.owner_a, p_transfer_id: tr.id });
      await t.as(null);
      const s2 = await t.val<string>("select normalized_value from public.machine_identifiers where machine_id = $1", [m2.id]);
      await t.as("dealer");
      const on = await t.rpc("verify_on_site", { p_org_id: ORGS.dealer, p_machine_id: m2.id, p_nameplate_serial: s2 });
      expect(on.verification_level).toBe(2);
    });
  });
});

describe("conflicts (step 7)", () => {
  it("duplicate conflict: operator keeps the existing machine; the duplicate is deregistered", async () => {
    await tx(async (t) => {
      const s = serial("RES");
      const first = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const dup = await registerAs(t, "owner_b", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("owner_b");
      const mine = await t.rpc<any[]>("list_my_conflicts", { p_org_id: ORGS.owner_b });
      expect(mine[0].id).toBe(dup.conflict_id);
      expect((await t.rpcError("resolve_conflict", { p_conflict_id: dup.conflict_id, p_resolution: "keep_existing", p_note: "x" })).code).toBe("FORBIDDEN");
      await t.as("verifier");
      const list = await t.rpc<any[]>("list_conflicts");
      expect(list.map((c) => c.id)).toContain(dup.conflict_id);
      await t.rpc("resolve_conflict", { p_conflict_id: dup.conflict_id, p_resolution: "keep_existing", p_note: "Fel serienummer angivet" });
      await t.as(null);
      expect(await t.val("select status from public.machines where id = $1", [dup.id])).toBe("deregistered");
      expect(await t.val("select status from public.machines where id = $1", [first.id])).toBe("active");
    });
  });

  it("keep_new moves the unique slot to the new machine", async () => {
    await tx(async (t) => {
      const s = serial("NEW");
      const first = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const dup = await registerAs(t, "owner_b", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("verifier");
      await t.rpc("resolve_conflict", { p_conflict_id: dup.conflict_id, p_resolution: "keep_new", p_note: "Första registreringen var fel" });
      await t.as(null);
      expect(await t.val("select machine_id from public.machine_identifiers where normalized_value = $1 and unique_active", [s])).toBe(dup.id);
      expect(await t.val("select status from public.machines where id = $1", [dup.id])).toBe("active");
      expect(await t.val("select status from public.machines where id = $1", [first.id])).toBe("deregistered");
    });
  });
});

describe("owner correction (SPEC §11.4 four eyes, §11.7 objection period)", () => {
  it("needs two different operators, then 14 days objection; objection stops it", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("operator");
      const s1 = await sign(t, ORGS.operator, "propose_owner_correction", m.id, { to_org_id: ORGS.owner_b });
      const c = await t.rpc("propose_owner_correction", { p_machine_id: m.id, p_to_org_id: ORGS.owner_b, p_reason: "Fel ägare vid import", p_signature_id: s1 });
      const s2 = await sign(t, ORGS.operator, "approve_owner_correction", c.id);
      expect((await t.rpcError("approve_owner_correction", { p_correction_id: c.id, p_signature_id: s2 })).code).toBe("FOUR_EYES_REQUIRED");
      await t.as("verifier");
      const s3 = await sign(t, ORGS.operator, "approve_owner_correction", c.id);
      const ap = await t.rpc("approve_owner_correction", { p_correction_id: c.id, p_signature_id: s3 });
      expect(ap.status).toBe("objection_period");
      await t.as(null);
      expect(await t.val("select status from public.machines where id = $1", [m.id])).toBe("disputed");
      expect(await t.val("select app.apply_due_corrections()")).toBe(0);
      await t.as("owner_a");
      const inbox = await t.rpc("get_inbox", { p_org_id: ORGS.owner_a });
      expect(inbox.items.map((i: any) => i.kind)).toContain("correction_objection");
      await t.rpc("object_owner_correction", { p_org_id: ORGS.owner_a, p_correction_id: c.id, p_note: "Vi äger maskinen, se faktura" });
      await t.as(null);
      await t.q("update public.owner_corrections set effective_after = now() - interval '1 day' where id = $1", [c.id]);
      expect(await t.val("select app.apply_due_corrections()")).toBe(0);
    });
  });

  it("applies after the objection period (or at once for an obvious typo)", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("operator");
      const s1 = await sign(t, ORGS.operator, "propose_owner_correction", m.id, { to_org_id: ORGS.owner_b });
      const c = await t.rpc("propose_owner_correction", { p_machine_id: m.id, p_to_org_id: ORGS.owner_b, p_reason: "Import", p_signature_id: s1 });
      await t.as("verifier");
      await t.rpc("approve_owner_correction", { p_correction_id: c.id, p_signature_id: await sign(t, ORGS.operator, "approve_owner_correction", c.id) });
      await t.as(null);
      await t.q("update public.owner_corrections set effective_after = now() - interval '1 second' where id = $1", [c.id]);
      expect(await t.val("select app.apply_due_corrections()")).toBe(1);
      const own = await t.one<any>("select owner_org_id, status from public.machines where id = $1", [m.id]);
      expect(own).toEqual({ owner_org_id: ORGS.owner_b, status: "active" });
      expect(await t.val("select acquired_via from public.ownerships where machine_id = $1 and to_date is null", [m.id])).toBe("correction");
    });
  });
});

describe("inbox (step 7)", () => {
  it("collects everything waiting for the org", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b });
      const m2 = await registerAs(t, "owner_a");
      await t.as("owner_a");
      await t.rpc("request_encumbrance", { p_org_id: ORGS.owner_a, p_machine_id: m2.id, p_holder_org_id: ORGS.financier_a, p_type: "rental" });
      await t.as("financier_a");
      const inbox = await t.rpc("get_inbox", { p_org_id: ORGS.financier_a });
      expect(inbox.items.map((i: any) => i.kind).sort()).toEqual(["encumbrance_confirm", "transfer_financier"]);
      await t.as("owner_b");
      expect((await t.rpc("get_inbox", { p_org_id: ORGS.owner_b })).count).toBe(0);
    });
  });
});
