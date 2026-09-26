import { describe, expect, it } from "vitest";
import { encumber, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const SHA = "a".repeat(64);

async function upload(t: any, who: "owner_a" | "owner_b" | "dealer" | "financier_a", machineId: string, visibility = "owner", type = "invoice") {
  await t.as(who);
  const up = await t.rpc("create_document_upload", {
    p_org_id: ORGS[who], p_machine_id: machineId, p_type: type, p_filename: "faktura 1.pdf", p_mime: "application/pdf",
    p_size_bytes: 1000, p_sha256: SHA, p_visibility: visibility,
  });
  return t.rpc("finalize_document", { p_org_id: ORGS[who], p_document_id: up.id });
}

describe("documents (step 6)", () => {
  it("reserves a path, logs the sha256 in the event, and validates type/size", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const d = await upload(t, "owner_a", m.id);
      expect(d.status).toBe("clean");
      await t.as(null);
      const ev = await t.one<any>("select type, payload from public.events where machine_id = $1 order by seq desc limit 1", [m.id]);
      expect(ev).toMatchObject({ type: "document.uploaded", payload: { sha256: SHA } });
      const path = await t.val<string>("select storage_path from public.documents where id = $1", [d.id]);
      expect(path).toMatch(new RegExp(`^${ORGS.owner_a}/[0-9a-f-]{36}/faktura_1.pdf$`));
      await t.as("owner_a");
      const base = { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "invoice", p_filename: "x", p_sha256: SHA };
      expect((await t.rpcError("create_document_upload", { ...base, p_mime: "text/html", p_size_bytes: 10 })).code).toBe("VALIDATION");
      expect((await t.rpcError("create_document_upload", { ...base, p_mime: "application/pdf", p_size_bytes: 26214401 })).code).toBe("VALIDATION");
    });
  });

  it("owner B cannot read owner A's documents (§16.2); holder sees owner_and_financier documents", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const priv = await upload(t, "owner_a", m.id, "owner");
      const shared = await upload(t, "owner_a", m.id, "owner_and_financier", "financing_contract");
      await t.as("owner_b");
      expect(await t.q("select id from public.documents where machine_id = $1", [m.id])).toHaveLength(0);
      expect((await t.rpcError("authorize_document_download", { p_document_id: priv.id })).code).toBe("NOT_FOUND");
      await encumber(t, "financier_a", m.id);
      await t.as("financier_a");
      const docs = await t.rpc<any[]>("list_documents", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      expect(docs.map((d) => d.id)).toEqual([shared.id]);
      const url = await t.rpc("authorize_document_download", { p_document_id: shared.id });
      expect(url.expires_in).toBe(300);
    });
  });

  it("storage upload is only allowed to a reserved path", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const up = await t.rpc("create_document_upload", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "invoice", p_filename: "a.pdf", p_mime: "application/pdf", p_size_bytes: 5, p_sha256: SHA,
      });
      await t.q("insert into storage.objects (bucket_id, name) values ('documents', $1)", [up.path]);
      const e = await t.error(() => t.q("insert into storage.objects (bucket_id, name) values ('documents', 'evil/path.pdf')"));
      expect(e.code).toMatch(/row-level security/);
      await t.as("owner_b");
      const e2 = await t.error(() => t.q("insert into storage.objects (bucket_id, name) values ('documents', $1)", [up.path + "2"]));
      expect(e2.code).toMatch(/row-level security/);
    });
  });
});

describe("access log (step 6, §16.2, §16.10, §16.17)", () => {
  it("lookups by other orgs are logged and visible to the owner; authority reads hidden by default", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("financier_b");
      await t.rpc("perform_check", { p_org_id: ORGS.financier_b, p_query: { reg: m.reg_number } });
      await t.as("authority");
      await t.rpc("lookup_machine", { p_org_id: ORGS.authority, p_query: m.reg_number });
      await t.as("owner_a");
      const log = await t.rpc<any[]>("list_access_log", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(log.map((l) => l.viewer_type)).toEqual(["financier"]);
      expect(log[0]).toMatchObject({ via: "check", viewer_org_name: "Test Finans B AB" });
      await t.as("owner_b");
      expect((await t.rpcError("list_access_log", { p_org_id: ORGS.owner_b, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      expect(await t.q("select id from public.access_log where machine_id = $1", [m.id])).toHaveLength(0);
      const e = await t.error(() => t.q("select * from public.access_log_default"));
      expect(e.code).toMatch(/permission denied/);
      await t.as("authority");
      expect(await t.rpc<any[]>("list_access_log", { p_org_id: ORGS.authority, p_machine_id: m.id })).toHaveLength(2);
      await t.as(null);
      await t.q("update public.organizations set settings = settings || '{\"show_authority_reads_to_owner\": true}' where id = $1", [ORGS.authority]);
      await t.as("authority");
      await t.rpc("perform_check", { p_org_id: ORGS.authority, p_query: { reg: m.reg_number } });
      await t.as("owner_a");
      expect((await t.rpc<any[]>("list_access_log", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).map((l) => l.viewer_type)).toContain("authority");
    });
  });

  it("public scan of a stolen machine logs access, notifies owner (critical, with location) and sends machine.scanned", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "P-1" });
      await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "P-1", p_signature_id: sig });
      await t.as(null);
      await t.q("insert into public.webhooks (org_id, url, secret) values ($1, 'https://hooks.example/o', 's')", [ORGS.owner_a]);
      await t.as("service");
      const card = await t.rpc("log_public_scan", {
        p_code: null, p_reg: m.reg_number, p_ip_hash: "iphash-1", p_user_agent_family: "Mobile Safari",
        p_location: { lat: 59.8586, lng: 17.6389, city: "Uppsala" },
      });
      expect(card.card.status).toBe("stolen");
      await t.as(null);
      const log = await t.one<any>("select viewer_type, via, approx_location from public.access_log where machine_id = $1", [m.id]);
      expect(log).toMatchObject({ viewer_type: "public", via: "web", approx_location: { lat: 59.86, lng: 17.64, city: "Uppsala" } });
      const n = await t.one<any>("select severity, data from public.notifications where type = 'machine.stolen_scanned'");
      expect(n.severity).toBe("critical");
      expect(n.data.location.city).toBe("Uppsala");
      expect(await t.val("select count(*)::int from public.webhook_deliveries where event_type = 'machine.scanned'")).toBe(1);
    });
  });

  it("rate limit: the 31st public lookup per minute from one IP is refused (§16.11)", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("service");
      for (let i = 0; i < 30; i++) {
        await t.rpc("log_public_scan", { p_code: null, p_reg: m.reg_number, p_ip_hash: "ip-rate" });
      }
      const e = await t.rpcError("log_public_scan", { p_code: null, p_reg: m.reg_number, p_ip_hash: "ip-rate" });
      expect(e).toMatchObject({ code: "RATE_LIMITED", sqlstate: "PT429" });
      expect((await t.rpc("log_public_scan", { p_code: null, p_reg: m.reg_number, p_ip_hash: "other-ip" })).found).toBe(true);
    });
  });

  it("anon cannot call the scan logger directly", async () => {
    await tx(async (t) => {
      await t.as("anon");
      const e = await t.error(() => t.rpc("log_public_scan", { p_code: null, p_reg: "ABC-2345", p_ip_hash: "x" }));
      expect(e.code).toMatch(/permission denied/);
    });
  });
});

describe("share links (step 6, SPEC §6.10)", () => {
  it("owner shares a buyer report; link shows history and financing holder; expires and counts views", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await upload(t, "owner_a", m.id, "verifiers", "invoice");
      await upload(t, "owner_a", m.id, "owner", "insurance_policy");
      await t.as("owner_b");
      expect((await t.rpcError("create_share_link", { p_org_id: ORGS.owner_b, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      const link = await t.rpc("create_share_link", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_days: 7, p_max_views: 2 });
      await t.as("service");
      const v = await t.rpc("get_share_view", { p_token: link.token, p_ip_hash: "buyer" });
      expect(v.ok).toBe(true);
      expect(v.data.financing).toMatchObject({ has_active: true, holder: "Test Finans A AB" });
      expect(v.data.history.map((h: any) => h.type)).toEqual(expect.arrayContaining(["machine.registered", "encumbrance.registered"]));
      expect(v.data.documents).toHaveLength(1);
      await t.rpc("get_share_view", { p_token: link.token });
      expect(await t.rpc("get_share_view", { p_token: link.token })).toEqual({ ok: false, reason: "max_views" });
      expect(await t.rpc("get_share_view", { p_token: "nope" })).toEqual({ ok: false, reason: "not_found" });
      await t.as(null);
      await t.q("update public.share_links set expires_at = now() - interval '1 second', max_views = null where id = $1", [link.id]);
      await t.as("service");
      expect((await t.rpc("get_share_view", { p_token: link.token })).reason).toBe("expired");
      await t.as("owner_a");
      const logs = await t.rpc<any[]>("list_access_log", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(logs.filter((l) => l.via === "share_link")).toHaveLength(2);
      const list = await t.rpc<any[]>("list_share_links", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(list[0]).toMatchObject({ views: 2, active: false });
      expect(JSON.stringify(list)).not.toContain(link.token);
    });
  });

  it("revoked link stops working", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const link = await t.rpc("create_share_link", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_scope: "public_card", p_days: 30 });
      await t.rpc("revoke_share_link", { p_org_id: ORGS.owner_a, p_share_link_id: link.id });
      await t.as("service");
      expect((await t.rpc("get_share_view", { p_token: link.token })).reason).toBe("revoked");
    });
  });
});
