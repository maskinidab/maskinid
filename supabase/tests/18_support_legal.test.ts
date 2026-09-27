import { describe, expect, it } from "vitest";
import { machineData, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("tips and public stolen list (step 22)", () => {
  it("a tip about a stolen machine reaches owner and operator; contact stays with the operator; forwarding goes to the police flagger", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("authority");
      const sig = await sign(t, ORGS.authority, "raise_flag_stolen", m.id, { reference: "P-77" });
      await t.rpc("raise_flag", { p_org_id: ORGS.authority, p_machine_id: m.id, p_type: "stolen", p_reference: "P-77", p_signature_id: sig });
      await t.as("anon");
      expect((await t.rpcError("submit_tip", { p_kind: "seen_machine", p_reg_or_serial: m.reg_number, p_message: "Står vid grustaget" })).code).toMatch(/permission denied/);
      await t.as("service");
      const r = await t.rpc("submit_tip", { p_kind: "seen_machine", p_reg_or_serial: m.reg_number, p_message: "Står vid grustaget i Sala",
        p_location: { city: "Sala", lat: 59.9212, lng: 16.6061 }, p_contact: "070-000 00 00", p_ip_hash: "ip-tip" });
      expect(r).toMatchObject({ ok: true, matched: true });
      await t.as("owner_a");
      const n = (await t.rpc<any[]>("list_notifications")).find((x) => x.type === "tip.stolen_machine");
      expect(n).toMatchObject({ severity: "critical" });
      expect(JSON.stringify(n)).not.toContain("070-000");
      await t.as("support");
      const [tip] = await t.rpc<any[]>("admin_list_tips", {});
      expect(tip).toMatchObject({ contact: "070-000 00 00", machine: { id: m.id } });
      expect(tip).not.toHaveProperty("ip_hash");
      await t.as("verifier");
      await t.rpc("admin_review_tip", { p_tip_id: tip.id, p_status: "forwarded" });
      await t.as("authority");
      expect((await t.rpc<any[]>("list_notifications")).map((x) => x.type)).toContain("tip.forwarded");
      await t.as("owner_a");
      expect((await t.rpcError("admin_list_tips", {})).code).toBe("FORBIDDEN");
    });
  });

  it("stolen list shows only published flags, without owner", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "K-5" });
      const f = await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "K-5", p_signature_id: sig });
      const flagId = f.flag?.id ?? f.id ?? (await t.val<string>("select id from public.flags where machine_id = $1", [m.id]));
      await t.as("anon");
      expect((await t.rpc<any[]>("public_stolen_list", {})).map((x) => x.reg_number)).not.toContain(m.reg_number);
      await t.as("owner_b");
      expect((await t.rpcError("set_flag_public", { p_org_id: ORGS.owner_b, p_flag_id: flagId, p_public: true })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      await t.rpc("set_flag_public", { p_org_id: ORGS.owner_a, p_flag_id: flagId, p_public: true });
      expect((await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).stolen_public).toEqual({ flag_id: flagId, published: true });
      await t.as("anon");
      const row = (await t.rpc<any[]>("public_stolen_list", {})).find((x) => x.reg_number === m.reg_number);
      expect(row).toBeTruthy();
      expect(JSON.stringify(row)).not.toMatch(/owner|Test Owner/);
    });
  });
});

describe("support tickets (step 22)", () => {
  it("customer opens a ticket, operator replies (logged), customer sees the thread; other orgs cannot", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const tk = await t.rpc("create_support_ticket", { p_org_id: ORGS.owner_a, p_category: "labels", p_subject: "Märke går inte att läsa", p_body: "QR-koden är repad." });
      expect(tk.messages).toHaveLength(1);
      await t.as("owner_b");
      expect((await t.rpcError("get_ticket", { p_org_id: ORGS.owner_b, p_ticket_id: tk.id })).code).toBe("NOT_FOUND");
      await t.as("support");
      const list = await t.rpc<any[]>("admin_list_tickets", { p_status: "open" });
      expect(list.map((x) => x.id)).toContain(tk.id);
      await t.rpc("add_ticket_message", { p_org_id: null, p_ticket_id: tk.id, p_body: "Vi skickar ett nytt märke." });
      await t.as("owner_a");
      const full = await t.rpc("get_ticket", { p_org_id: ORGS.owner_a, p_ticket_id: tk.id });
      expect(full.status).toBe("waiting_customer");
      expect(full.messages[1]).toMatchObject({ from_operator: true, author: "MaskinID support" });
      expect((await t.rpc<any[]>("list_notifications")).map((n) => n.type)).toContain("support.reply");
      expect((await t.rpcError("set_ticket_status", { p_org_id: ORGS.owner_a, p_ticket_id: tk.id, p_status: "open" })).code).toBe("FORBIDDEN");
      await t.rpc("set_ticket_status", { p_org_id: ORGS.owner_a, p_ticket_id: tk.id, p_status: "closed" });
      await t.as("service");
      expect((await t.rpc("submit_public_support", { p_email: "kund@example.se", p_category: "account", p_subject: "Kan inte logga in",
        p_body: "Länken fungerar inte", p_ip_hash: "ip-sup" })).ok).toBe(true);
    });
  });
});

describe("legal documents with acceptance (step 22)", () => {
  it("published documents are public; users must accept new required versions", async () => {
    await tx(async (t) => {
      await t.as("anon");
      const terms = await t.rpc("get_legal_document", { p_key: "terms", p_locale: "en" });
      expect(terms).toMatchObject({ key: "terms", version: 1, locale: "en" });
      expect((await t.rpc<any[]>("list_legal_documents", { p_locale: "sv" })).map((d) => d.key).sort()).toEqual(["cookies", "dpa", "privacy", "terms"]);
      await t.as("owner_a");
      const ctx = await t.rpc("my_context");
      expect(ctx.legal_pending.map((p: any) => p.key).sort()).toEqual(["dpa", "privacy", "terms"]);
      await t.rpc("accept_legal_documents", { p_items: JSON.stringify(ctx.legal_pending) });
      expect((await t.rpc("my_context")).legal_pending).toEqual([]);
      await t.as("operator");
      const v = await t.rpc("admin_publish_legal", { p_key: "terms", p_title_sv: "Användarvillkor", p_body_sv: "Ny version.", p_title_en: null, p_body_en: null, p_requires_acceptance: true });
      expect(v.version).toBe(2);
      await t.as("owner_a");
      expect((await t.rpc("my_context")).legal_pending).toEqual([{ key: "terms", version: 2 }]);
      expect((await t.rpcError("admin_publish_legal", { p_key: "terms", p_title_sv: "X", p_body_sv: "Y", p_title_en: null, p_body_en: null, p_requires_acceptance: false })).code).toBe("FORBIDDEN");
    });
  });
});

describe("account security and view-as (step 22)", () => {
  it("security events are per user", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("record_security_event", { p_type: "sign_in", p_ua_family: "Chrome" });
      expect((await t.rpcError("record_security_event", { p_type: "view_as_started" })).code).toBe("VALIDATION");
      expect((await t.rpc<any[]>("list_security_events", {}))[0]).toMatchObject({ type: "sign_in", ua_family: "Chrome" });
      await t.as("owner_b");
      expect(await t.rpc("list_security_events", {})).toEqual([]);
    });
  });

  it("operator views an org read-only: reads work, writes are refused, the org is told, it is audited and it ends", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      expect((await t.rpcError("admin_start_view_as", { p_org_id: ORGS.owner_b, p_reason: "Hjälp" })).code).toBe("FORBIDDEN");
      await t.as("support");
      expect((await t.rpcError("list_machines", { p_org_id: ORGS.owner_a, p_scope: "owned" })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("admin_start_view_as", { p_org_id: ORGS.owner_a, p_reason: "x" })).code).toBe("VALIDATION");
      await t.rpc("admin_start_view_as", { p_org_id: ORGS.owner_a, p_reason: "Kunden ser inte sin maskin" });
      const ctx = await t.rpc("my_context");
      expect(ctx.memberships.find((x: any) => x.org.id === ORGS.owner_a)).toMatchObject({ view_as: true, role: "readonly" });
      expect((await t.rpc("list_machines", { p_org_id: ORGS.owner_a, p_scope: "owned" })).items.map((x: any) => x.id)).toContain(m.id);
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).id).toBe(m.id);
      expect((await t.rpcError("update_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_patch: { color: "blå" } })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 100 })).code).toBe("FORBIDDEN");
      // Writes a readonly member may make (support tickets) are refused while viewing as the org (ADR 0024).
      expect((await t.rpcError("create_support_ticket", { p_org_id: ORGS.owner_a, p_category: "other", p_subject: "Test", p_body: "Test" })).code)
        .toBe("VIEW_AS_READ_ONLY");
      await t.rpc("end_view_as", {});
      expect((await t.rpcError("list_machines", { p_org_id: ORGS.owner_a, p_scope: "owned" })).code).toBe("FORBIDDEN");
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action like 'view_as.%'")).toBe(2);
      await t.as("owner_a");
      expect((await t.rpc<any[]>("list_notifications")).map((n) => n.type)).toContain("support.viewed_as");
    });
  });
});
