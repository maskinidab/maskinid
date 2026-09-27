import { describe, expect, it } from "vitest";
import { machineData, registerAs, serial, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("NFC labels (step 25)", () => {
  it("orders NFC labels, binds the chip serial once, and warns the owner when a different chip is scanned", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const b = await t.rpc<any>("order_labels", { p_org_id: ORGS.owner_a, p_quantity: 10, p_medium: "nfc" });
      expect(b.medium).toBe("nfc");
      const m = await registerAs(t, "owner_a", machineData());
      const code = `NFC${Date.now().toString(36)}${Math.random().toString(36).slice(2)}XXXXXXXXXXXXXXXXXXXX`.replace(/[^0-9A-Za-z]/g, "").slice(0, 22);
      await t.as(null);
      await t.q("insert into public.labels (code, status, medium, assigned_org_id) values ($1, 'assigned', 'nfc', $2)", [code, ORGS.owner_a]);
      await t.as("owner_a");
      await t.rpc("bind_label", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_code: code });
      await t.rpc("register_nfc_tag", { p_org_id: ORGS.owner_a, p_code: code, p_uid: "04:a1:b2:c3:d4:e5:f6" });
      expect((await t.rpc<any>("register_nfc_tag", { p_org_id: ORGS.owner_a, p_code: code, p_uid: "04A1B2C3D4E5F6" })).already).toBe(true);
      expect((await t.rpcError("register_nfc_tag", { p_org_id: ORGS.owner_a, p_code: code, p_uid: "0499999999999" })).code).toBe("LABEL_ALREADY_USED");
      await t.as("owner_b");
      expect((await t.rpcError("register_nfc_tag", { p_org_id: ORGS.owner_b, p_code: code, p_uid: "0411111111111" })).code).toMatch(/FORBIDDEN|NOT_FOUND|LABEL/);

      await t.as("service");
      expect((await t.rpc<any>("check_nfc_tag", { p_code: code, p_uid: "04A1B2C3D4E5F6", p_ip_hash: "x" })).result).toBe("match");
      expect((await t.rpc<any>("check_nfc_tag", { p_code: code, p_uid: "04FFFFFFFFFFFF", p_ip_hash: "x" })).result).toBe("mismatch");
      expect(await t.val("select count(*)::int from public.notifications where type = 'label.nfc_mismatch' and org_id = $1", [ORGS.owner_a])).toBeGreaterThan(0);
      await t.as("anon");
      expect((await t.rpcError("check_nfc_tag", { p_code: code, p_uid: "04A1", p_ip_hash: "x" })).code).toMatch(/permission|FORBIDDEN/i);
    });
  });
});

describe("telematics (step 25)", () => {
  it("an admin connects a feed; ingest matches own machines, raises hours only, stores the latest position", async () => {
    await tx(async (t) => {
      const s = serial("TM");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const other = serial("TO");
      await registerAs(t, "owner_b", machineData({ identifiers: [{ type: "serial", value: other }] }));
      await t.as("owner_a");
      const c = await t.rpc<any>("create_telematics_connection", { p_org_id: ORGS.owner_a, p_provider: "caretrack", p_name: "CareTrack",
        p_base_url: "https://caretrack.example.com/aemp", p_credential: { type: "basic", username: "u", password: "hemligt" } });
      expect(c).toMatchObject({ provider: "caretrack", has_credential: true, sync_requested: true });
      expect(JSON.stringify(await t.rpc("list_telematics_connections", { p_org_id: ORGS.owner_a }))).not.toContain("hemligt");
      await t.as("owner_a_readonly");
      expect((await t.rpcError("create_telematics_connection", { p_org_id: ORGS.owner_a, p_provider: "mock", p_name: "x", p_base_url: null, p_credential: null })).code).toBe("FORBIDDEN");

      await t.as("service");
      const due = (await t.rpc<any[]>("telematics_due_connections", {})).find((x) => x.id === c.id);
      expect(due.credential).toEqual({ type: "basic", username: "u", password: "hemligt" });
      expect(due.machines.some((x: any) => x.machine_id === m.id)).toBe(true);
      const r = await t.rpc<any>("telematics_ingest", { p_connection_id: c.id, p_readings: JSON.stringify([
        { external_id: "CT-1", serial: s.toLowerCase(), hours: 1234.6, lat: 59.33, lon: 18.06, position_at: new Date().toISOString() },
        { external_id: "CT-2", serial: other, hours: 99 },
        { external_id: "CT-3", serial: "NOPE12345", hours: 5 },
      ]) });
      expect(r).toMatchObject({ matched: 1, unmatched: 2, hours: 1, positions: 1 });
      // lower hours never overwrite; the link is reused by external id
      await t.rpc("telematics_ingest", { p_connection_id: c.id, p_readings: JSON.stringify([{ external_id: "CT-1", hours: 1000 }]) });
      await t.as("owner_a");
      const mv = await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(mv.hour_meter).toBe(1234);
      expect(await t.rpc<any>("get_machine_position", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).toMatchObject({ lat: 59.33, lon: 18.06, provider: "caretrack" });
      await t.as("owner_b");
      expect((await t.rpcError("get_machine_position", { p_org_id: ORGS.owner_b, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      await t.as("authority");
      expect((await t.rpcError("get_machine_position", { p_org_id: ORGS.authority, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      expect(await t.q("select * from public.machine_positions")).toEqual([]);
    });
  });

  it("a stolen machine reporting a position alerts owner and the flagging police; the police may then see it", async () => {
    await tx(async (t) => {
      const s = serial("TS");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("authority");
      const sig = await sign(t, ORGS.authority, "raise_flag_stolen", m.id, { reference: "P-9" });
      await t.rpc("raise_flag", { p_org_id: ORGS.authority, p_machine_id: m.id, p_type: "stolen", p_reference: "P-9", p_signature_id: sig });
      await t.as("owner_a");
      const c = await t.rpc<any>("create_telematics_connection", { p_org_id: ORGS.owner_a, p_provider: "mock", p_name: "Demo", p_base_url: null, p_credential: null });
      await t.as("service");
      await t.rpc("telematics_ingest", { p_connection_id: c.id, p_readings: JSON.stringify([{ external_id: "M1", serial: s, lat: 57.7, lon: 11.97 }]) });
      expect(await t.val("select count(*)::int from public.notifications where type = 'telematics.stolen_position' and org_id = $1", [ORGS.authority])).toBeGreaterThan(0);
      await t.as("authority");
      expect((await t.rpc<any>("get_machine_position", { p_org_id: ORGS.authority, p_machine_id: m.id })).lat).toBe(57.7);
    });
  });

  it("a failed sync marks the connection and notifies the admins", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const c = await t.rpc<any>("create_telematics_connection", { p_org_id: ORGS.owner_a, p_provider: "mock", p_name: "Demo", p_base_url: null, p_credential: null });
      await t.as("service");
      await t.rpc("telematics_ingest", { p_connection_id: c.id, p_readings: "[]", p_error: "HTTP 401" });
      await t.as("owner_a");
      expect((await t.rpc<any[]>("list_telematics_connections", { p_org_id: ORGS.owner_a })).find((x) => x.id === c.id)).toMatchObject({ status: "error", last_error: "HTTP 401" });
      await t.rpc("update_telematics_connection", { p_org_id: ORGS.owner_a, p_connection_id: c.id, p_action: "delete" });
    });
  });
});

describe("theft register sync (step 25)", () => {
  it("stolen flags are queued for the external register and marked recovered when cleared", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("authority");
      const sig = await sign(t, ORGS.authority, "raise_flag_stolen", m.id, { reference: "P-10" });
      const f = await t.rpc<any>("raise_flag", { p_org_id: ORGS.authority, p_machine_id: m.id, p_type: "stolen", p_reference: "P-10", p_signature_id: sig });
      await t.as("service");
      const claimed = (await t.rpc<any[]>("claim_theft_sync", {})).filter((x) => x.report.regNumber === m.reg_number);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ action: "report", report: { policeReference: "P-10", status: "stolen" } });
      await t.rpc("record_theft_sync_result", { p_id: claimed[0].id, p_ok: true, p_external_ref: "LT-1" });
      const flagId = f.id ?? f.flag?.id ?? (await t.val<string>("select id from public.flags where machine_id = $1 and type = 'stolen'", [m.id]));
      expect(await t.val("select external_ref from public.flags where id = $1", [flagId])).toBe("LT-1");
      await t.q("update public.flags set status = 'cleared', cleared_at = now() where id = $1", [flagId]);
      expect((await t.rpc<any[]>("claim_theft_sync", {})).some((x) => x.action === "recovered" && x.report.regNumber === m.reg_number)).toBe(true);
    });
  });

  it("an external report on an unflagged machine alerts owner and operator but never flags automatically", async () => {
    await tx(async (t) => {
      const s = serial("LT");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("service");
      const r = await t.rpc<any>("ingest_external_theft_reports", { p_source: "larmtjanst", p_reports: JSON.stringify([
        { serial: s, make: "Volvo", status: "stolen", reportedAt: "2026-09-20T10:00:00Z", externalRef: "LT-77" }, { serial: "UNKNOWN0001", status: "stolen" }]) });
      expect(r).toMatchObject({ new: 2, matched: 1 });
      expect((await t.rpc<any>("ingest_external_theft_reports", { p_source: "larmtjanst", p_reports: JSON.stringify([{ serial: s, status: "stolen" }]) })).new).toBe(0);
      expect(await t.val("select count(*)::int from public.flags where machine_id = $1", [m.id])).toBe(0);
      expect(await t.val("select count(*)::int from public.notifications where type = 'theft.external_match' and org_id = $1", [ORGS.owner_a])).toBeGreaterThan(0);
      await t.as("verifier");
      const list = await t.rpc<any>("admin_list_external_theft_reports", { p_status: "new" });
      const rep = list.reports.find((x: any) => x.matched_machine_id === m.id);
      expect(rep.machine.reg_number).toBe(m.reg_number);
      await t.rpc("admin_review_external_theft_report", { p_id: rep.id, p_status: "confirmed" });
      await t.as("owner_a");
      expect((await t.rpcError("admin_list_external_theft_reports", {})).code).toBe("FORBIDDEN");
    });
  });
});

describe("public status (step 25)", () => {
  it("anyone can read the system status without register data", async () => {
    await tx(async (t) => {
      await t.as("anon");
      const s = await t.rpc<any>("public_system_status", {});
      expect(s.database).toBe("ok");
      expect(s.integrations).toHaveProperty("telematics");
      expect(JSON.stringify(s)).not.toMatch(/reg_number|owner/);
    });
  });
});
