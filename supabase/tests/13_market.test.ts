import { describe, expect, it } from "vitest";
import { encumber, machineData, registerAs, serial, sign } from "./factories.ts";
import { ORGS, tx, type Tx } from "./helpers.ts";

async function run(t: Tx, source = "partner-feed") {
  await t.as(null);
  await t.q("update public.market_sources set enabled = true where key = $1", [source]);
  await t.as("service");
  return (await t.rpc("start_market_run", { p_source_key: source })).run_id as string;
}
const listing = (o: Record<string, unknown>) => ({ external_id: `L${Math.random().toString(36).slice(2)}`, url: "https://market.example/1",
  make: "Volvo", model: "EC220E", year: 2019, seller_type: "business", seller_name: "Handlare AB", seller_org_number: "556677-8899", ...o });

describe("market surveillance (SPEC §8)", () => {
  it("private sellers are never stored with identity; raw payload is stripped of personal fields", async () => {
    await tx(async (t) => {
      const runId = await run(t);
      await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([
        listing({ external_id: "P2", seller_type: "business", seller_name: "Kalles Schakt", seller_org_number: "800101-1234" }),
        listing({ external_id: "P1", seller_type: "private", seller_name: "Kalle Privat", seller_org_number: "19800101-1234",
          raw: { title: "Grävare", phone: "070-123", seller: { name: "Kalle" }, specs: { weight: 22000, contact_email: "k@x.se" } } }),
      ]) });
      await t.as(null);
      const [o] = await t.q<any>("select seller_type, seller_name, seller_org_number, raw from public.market_observations where listing_external_id = 'P1'");
      expect(o).toMatchObject({ seller_type: "private", seller_name: null, seller_org_number: null });
      expect(o.raw).toEqual({ title: "Grävare", specs: { weight: 22000 } });
      // Sole trader: org number is a personal number ⇒ stored as private.
      const [st] = await t.q<any>("select seller_type, seller_name, seller_org_number from public.market_observations where listing_external_id = 'P2'");
      expect(st).toEqual({ seller_type: "private", seller_name: null, seller_org_number: null });
      await expect(t.q("update public.market_observations set seller_name = 'X' where listing_external_id = 'P1'")).rejects.toThrow();
    });
  });

  it("restricted or disabled sources cannot run (kill switch)", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q("update public.market_sources set enabled = true, tos_status = 'restricted' where key = 'mascus'");
      await t.as("service");
      expect((await t.rpcError("start_market_run", { p_source_key: "mascus" })).code).toBe("SOURCE_DISABLED");
      expect((await t.rpcError("start_market_run", { p_source_key: "blocket" })).code).toBe("SOURCE_DISABLED");
    });
  });

  it("stolen machine listed ⇒ match + critical alert to owner, holder and flagger; visible in checks", async () => {
    await tx(async (t) => {
      const s = serial("MKT");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "K-9" });
      await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "K-9", p_signature_id: sig });
      const runId = await run(t);
      const r = await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([listing({ serial: s.toLowerCase() })]) });
      expect(r).toMatchObject({ new: 1, matched: 1 });
      await t.as("owner_a");
      const n = await t.rpc<any[]>("list_notifications");
      expect(n.find((x) => x.type === "market.stolen_machine_listed")).toMatchObject({ severity: "critical" });
      await t.as("financier_a");
      const fn = await t.rpc<any[]>("list_notifications");
      expect(fn.map((x) => x.type)).toEqual(expect.arrayContaining(["market.stolen_machine_listed", "market.listed_with_active_financing"]));
      const c = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      expect(c.result.market_listings[0]).toMatchObject({ source: "Partnerflöde (JSON)", seller: "Handlare AB" });
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.market_listings).toHaveLength(1);
      await t.as("anon");
      const card = await t.rpc("public_machine_card", { p_reg: m.reg_number });
      expect(card.found).toBe(true);
      expect(JSON.stringify(card)).not.toContain("market_listings");
      await t.as("owner_b");
      expect(await t.q("select id from public.market_observations")).toHaveLength(0);
      expect(await t.q("select id from public.market_alerts")).toHaveLength(0);
    });
  });

  it("a stolen flag raised later re-checks active listings", async () => {
    await tx(async (t) => {
      const s = serial("LATE");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const runId = await run(t);
      await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([listing({ serial: s, seller_org_number: "559900-0001" })]) });
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "K-10" });
      await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "K-10", p_signature_id: sig });
      await t.as(null);
      expect((await t.q<any>("select type from public.market_alerts where machine_id = $1", [m.id])).map((a: any) => a.type)).toContain("stolen_machine_listed");
    });
  });

  it("seller not owner, duplicate serial across sellers, image OCR below 0.85 is not matched", async () => {
    await tx(async (t) => {
      const s = serial("DUPM");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const runId = await run(t);
      await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([
        listing({ serial: s, seller_org_number: "556677-8899" }),
        listing({ serial: s, seller_name: "Annan AB", seller_org_number: "556677-0001" }),
      ]) });
      await t.as(null);
      const types = (await t.q<any>("select type from public.market_alerts where machine_id = $1 order by type", [m.id])).map((a: any) => a.type);
      expect(types).toEqual(["duplicate_serial_in_market", "seller_not_owner"]);
      const runId2 = await run(t);
      const obs = await t.rpc("ingest_observations", { p_run_id: runId2, p_observations: JSON.stringify([listing({ external_id: "OCR1", serial: null })]) });
      expect(obs.matched).toBe(0);
      await t.as(null);
      const [o] = await t.q<any>("select id from public.market_observations where listing_external_id = 'OCR1'");
      await t.as("service");
      await t.rpc("record_listing_serial", { p_observation_id: o.id, p_serial: s, p_confidence: 0.6 });
      await t.as(null);
      expect((await t.q<any>("select matched_machine_id from public.market_observations where id = $1", [o.id]))[0].matched_machine_id).toBeNull();
      await t.as("service");
      await t.rpc("record_listing_serial", { p_observation_id: o.id, p_serial: s, p_confidence: 0.93 });
      await t.as(null);
      expect((await t.q<any>("select matched_machine_id from public.market_observations where id = $1", [o.id]))[0].matched_machine_id).toBe(m.id);
    });
  });

  it("candidates: an org sees unregistered machines it advertises and can turn them into drafts", async () => {
    await tx(async (t) => {
      const runId = await run(t);
      await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([
        listing({ serial: serial("CAND"), seller_name: "Test Dealer AB", seller_org_number: "559900-0003", category: "Grävmaskin" }),
      ]) });
      await t.as("dealer");
      const c = await t.rpc<any[]>("list_market_candidates", { p_org_id: ORGS.dealer });
      expect(c).toHaveLength(1);
      expect((await t.rpc("create_drafts_from_candidates", { p_org_id: ORGS.dealer, p_observation_ids: [c[0].id] })).drafts).toBe(1);
      expect(await t.rpc<any[]>("list_market_candidates", { p_org_id: ORGS.dealer })).toHaveLength(0);
      const drafts = await t.rpc<any[]>("list_machine_drafts", { p_org_id: ORGS.dealer });
      expect(drafts[0].draft_data).toMatchObject({ make: "Volvo", model: "EC220E", category: "excavator_tracked" });
    });
  });

  it("operator reviews alerts; escalation opens a conflict; non-operators are refused", async () => {
    await tx(async (t) => {
      const s = serial("ESC");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const runId = await run(t);
      await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([listing({ serial: s })]) });
      await t.as("verifier");
      const a = await t.rpc<any[]>("list_market_alerts", {});
      const mine = a.find((x) => x.machine_id === m.id);
      await t.rpc("review_market_alert", { p_alert_id: mine.id, p_status: "escalated", p_note: "Kontakta ägaren" });
      await t.as(null);
      expect((await t.q<any>("select type from public.conflicts where machine_id = $1", [m.id]))[0].type).toBe("market_anomaly");
      await t.as("owner_a");
      expect((await t.rpcError("list_market_alerts", {})).code).toBe("FORBIDDEN");
    });
  });

  it("operator sets connector config (no credentials); start_market_run hands it to the worker", async () => {
    await tx(async (t) => {
      await t.as("operator");
      const [src] = (await t.rpc<any[]>("list_market_sources")).filter((x) => x.key === "dealer-sitemap");
      expect((await t.rpcError("set_market_source", { p_source_id: src.id, p_enabled: true, p_config: { api_token: "x" } })).code).toBe("VALIDATION");
      await t.rpc("set_market_source", { p_source_id: src.id, p_enabled: true, p_tos_status: "allowed", p_config: { sitemaps: ["https://handlare.example/sitemap.xml"] } });
      await t.as("service");
      const r = await t.rpc("start_market_run", { p_source_key: "dealer-sitemap" });
      expect(r).toMatchObject({ connector: "generic-dealer", config: { sitemaps: ["https://handlare.example/sitemap.xml"] }, since: null });
      await t.as("verifier");
      expect((await t.rpcError("set_market_source", { p_source_id: src.id, p_enabled: false })).code).toBe("FORBIDDEN");
    });
  });

  it("OCR candidates are claimed once per listing (no serial, has images)", async () => {
    await tx(async (t) => {
      const runId = await run(t);
      await t.rpc("ingest_observations", { p_run_id: runId, p_observations: JSON.stringify([
        listing({ external_id: "O1", images: ["https://img.example/1.jpg"] }),
        listing({ external_id: "O2", images: ["https://img.example/2.jpg"], serial: "ABC12345" }),
        listing({ external_id: "O3" }),
      ]) });
      const first = await t.rpc<any[]>("claim_ocr_candidates", { p_run_id: runId });
      expect(first).toHaveLength(1);
      expect(first[0].images).toEqual(["https://img.example/1.jpg"]);
      expect(await t.rpc("claim_ocr_candidates", { p_run_id: runId })).toEqual([]);
    });
  });
});
