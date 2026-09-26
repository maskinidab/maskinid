import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { blocket } from "./connectors/blocket.ts";
import { dealerSite } from "./connectors/dealerSite.ts";
import { listingPage } from "./connectors/listingSite.ts";
import { mascus } from "./connectors/mascus.ts";
import { partnerFeed } from "./connectors/partnerFeed.ts";
import { serialFromText, vatIncluded } from "./extract.ts";
import { PoliteFetcher } from "./http.ts";
import { parseRobots } from "./robots.ts";
import { RpcError, type Rpc } from "./rpc.ts";
import { runSource } from "./run.ts";
import { sanitizeObservation } from "./sanitize.ts";
import type { ConnectorContext, Fetcher, SourceConfig } from "./types.ts";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

/** Fetcher over a URL → fixture map; records requested URLs. */
function fakeFetcher(map: Record<string, string>): Fetcher & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async text(url) {
      seen.push(url);
      return map[url] ?? null;
    },
  };
}
const ctx = (source: SourceConfig, fetcher: Fetcher, over: Partial<ConnectorContext> = {}): ConnectorContext =>
  ({ source, since: null, fetcher, limit: 100, env: {}, log: () => undefined, ...over });

describe("robots.txt", () => {
  const r = parseRobots(`# comment
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /sok
Allow: /sok/maskiner$
Disallow: /*.pdf$
Crawl-delay: 5`, "MaskinIDBot/1.0");
  it("uses the * group, longest match wins, $ anchors, crawl-delay", () => {
    expect(r.isAllowed("/annons/1")).toBe(true);
    expect(r.isAllowed("/sok?q=x")).toBe(false);
    expect(r.isAllowed("/sok/maskiner")).toBe(true);
    expect(r.isAllowed("/sok/maskiner/2")).toBe(false);
    expect(r.isAllowed("/a/b.pdf")).toBe(false);
    expect(r.crawlDelaySeconds).toBe(5);
  });
  it("a specific group for our bot overrides *", () => {
    expect(parseRobots("User-agent: *\nDisallow:\n\nUser-agent: maskinidbot\nDisallow: /", "MaskinIDBot/1.0").isAllowed("/x")).toBe(false);
  });
});

describe("PoliteFetcher", () => {
  it("respects robots.txt and spaces requests ≥ 2 s per domain (Crawl-delay can only slow it down)", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const f = vi.fn(async (u: URL | string) => {
      const url = String(u);
      if (url.endsWith("/robots.txt")) return new Response(url.includes("slow") ? "User-agent: *\nCrawl-delay: 10\nDisallow: /privat" : "User-agent: *\nDisallow: /privat");
      return new Response("ok");
    });
    const p = new PoliteFetcher({ fetch: f as unknown as typeof fetch, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
    expect(await p.text("https://a.example/privat/1")).toBeNull();
    expect(await p.text("https://a.example/1")).toBe("ok");
    expect(await p.text("https://a.example/2")).toBe("ok");
    expect(await p.text("https://b.example/1")).toBe("ok");
    expect(sleeps).toEqual([2000, 2000, 2000]); // a: robots → /1 → /2; b: robots → /1
    await p.text("https://slow.example/1");
    await p.text("https://slow.example/2");
    expect(sleeps.at(-1)).toBe(10_000);
    const ua = (f.mock.calls[1] as unknown as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(ua["user-agent"]).toMatch(/^MaskinIDBot/);
  });
  it("robots.txt 5xx ⇒ nothing is fetched", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    const p = new PoliteFetcher({ fetch: f as unknown as typeof fetch, sleep: async () => undefined });
    expect(await p.text("https://down.example/x")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("extraction helpers", () => {
  it("serials only after explicit labels", () => {
    expect(serialFromText("Välskött. Serienr: VCEC220EL00212345. Ring")).toBe("VCEC220EL00212345");
    expect(serialFromText("S/N ABC-12345 finns")).toBe("ABC-12345");
    expect(serialFromText("PIN 1FF350GXCKF400123")).toBe("1FF350GXCKF400123");
    expect(serialFromText("Modell EC220E 2019, 6500 timmar")).toBeUndefined();
    expect(serialFromText("vinterdäck 2020 pinnar")).toBeUndefined();
  });
  it("VAT markers", () => {
    expect(vatIncluded("895 000 kr exkl. moms")).toBe(false);
    expect(vatIncluded("100 000 + moms")).toBe(false);
    expect(vatIncluded("inkl. moms")).toBe(true);
    expect(vatIncluded("pris")).toBeUndefined();
  });
});

describe("sanitizer (SPEC §8.1/§8.6)", () => {
  it("private seller: no identity; raw stripped of personal keys and values", () => {
    const o = sanitizeObservation({ external_id: "1", seller_type: "private", seller_name: "Kalle", seller_org_number: "556701-1001",
      raw: { title: "Grävare", phone: "070", owner: { namn: "K" }, note: "ring 070-123 45 67", mail: "a@b.se", tags: ["ok", "k@x.se"] },
      images: ["https://i.example/1.jpg", "http://x/2.jpg", "javascript:alert(1)"] });
    expect(o).toMatchObject({ seller_type: "private", raw: { title: "Grävare", owner: {}, tags: ["ok"] }, images: ["https://i.example/1.jpg"] });
    expect(o).not.toHaveProperty("seller_name");
    expect(o).not.toHaveProperty("seller_org_number");
  });
  it("sole trader (personal number) ⇒ private; invalid org number dropped; valid normalised", () => {
    const st = sanitizeObservation({ external_id: "1", seller_type: "business", seller_name: "Kalles Schakt", seller_org_number: "800101-1234" });
    expect(st.seller_type).toBe("private");
    expect(st).not.toHaveProperty("seller_name");
    expect(st).not.toHaveProperty("seller_org_number");
    expect(sanitizeObservation({ external_id: "1", seller_type: "business", seller_name: "X AB", seller_org_number: "556701-1000" }).seller_org_number).toBeUndefined();
    expect(sanitizeObservation({ external_id: "1", seller_type: "business", seller_name: "X AB", seller_org_number: "5567011001" }).seller_org_number).toBe("556701-1001");
  });
});

describe("connectors", () => {
  it("mascus: search page → same-host listing links → JSON-LD product (business seller, serial from text, VAT)", async () => {
    const f = fakeFetcher({
      "https://www.mascus.se/entreprenadmaskiner": fx("mascus-search.html"),
      "https://www.mascus.se/entreprenadmaskiner/bandgravmaskiner/volvo-ec220el,abc123.html": fx("mascus-listing.html"),
    });
    const obs = await mascus.fetchListings(ctx({ key: "mascus", connector: "mascus", base_url: "https://www.mascus.se", config: { search_paths: ["/entreprenadmaskiner"], max_pages: 1 } }, f));
    expect(f.seen).not.toContain("https://other.example/entreprenadmaskiner/x/y,zzz.html");
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ external_id: "abc123", make: "Volvo", model: "EC220EL", year: 2019, hours: 6540, price_amount: 895000,
      price_vat_included: false, location: "Umeå", seller_type: "business", seller_name: "Nordmaskin AB", serial: "VCEC220EL00212345",
      serial_source: "listing_text", category: "Bandgrävmaskin" });
    const clean = sanitizeObservation(obs[0]);
    expect(clean.images).toEqual(["https://img.mascus.example/1.jpg"]);
    expect(JSON.stringify(clean)).not.toMatch(/070|sven@|Storgatan/);
  });
  it("blocket: Person seller ⇒ private, identity never leaves the worker; hours from odometer HUR", () => {
    const o = listingPage(fx("blocket-listing.html"), "https://www.blocket.se/mobility/item/12345", { private_marker: "Privatperson" })!;
    expect(o).toMatchObject({ external_id: "12345", make: "Kubota", model: "KX019-4", year: 2017, hours: 2100, seller_type: "private" });
    expect(JSON.stringify(sanitizeObservation(o))).not.toMatch(/Kalle|0701234567/);
    expect(blocket.complete).toBe(false);
  });
  it("generic dealer: sitemap index → pages newer than since → product; dealer identity from config", async () => {
    const f = fakeFetcher({
      "https://handlare.example/sitemap.xml": fx("sitemap-index.xml"),
      "https://handlare.example/sitemap-machines.xml": fx("sitemap-machines.xml"),
      "https://handlare.example/begagnat/volvo-l60h": fx("dealer-product.html"),
    });
    const obs = await dealerSite.fetchListings(ctx({ key: "dealer-sitemap", connector: "generic-dealer", base_url: null,
      config: { sites: [{ sitemap: "https://handlare.example/sitemap.xml", seller_name: "Handlare AB", seller_org_number: "556701-1001" }] } }, f,
      { since: new Date("2026-01-01") }));
    expect(f.seen).not.toContain("https://handlare.example/begagnat/gammal");
    expect(f.seen).not.toContain("https://handlare.example/kontakt");
    expect(obs).toEqual([expect.objectContaining({ external_id: "L60H-7788", make: "Volvo", year: 2021, hours: 3200, serial: "VCE0L60HV00012345",
      serial_confidence: 1, price_vat_included: false, seller_type: "business", seller_name: "Handlare AB", seller_org_number: "556701-1001" })]);
  });
  it("partner feed: bearer token from env, complete set, feed serials", async () => {
    const text = vi.fn(async () => JSON.stringify({ items: [{ external_id: 7, make: "CAT", model: "320", serial: "CAT0320X", seller_type: "business" }, { make: "no id" }] }));
    const obs = await partnerFeed.fetchListings(ctx({ key: "partner-feed", connector: "partner-feed", base_url: null, config: { feed_url: "https://p.example/feed", token_env: "FEED_TOKEN" } },
      { text }, { env: { FEED_TOKEN: "s3cret" } }));
    expect(text).toHaveBeenCalledWith("https://p.example/feed", { accept: "application/json", headers: { authorization: "Bearer s3cret" } });
    expect(obs).toEqual([expect.objectContaining({ external_id: "7", serial_source: "feed", serial_confidence: 1 })]);
    expect(partnerFeed.complete).toBe(true);
  });
});

describe("runSource", () => {
  it("disabled source (kill switch) is skipped without fetching", async () => {
    const rpc = vi.fn(async () => { throw new RpcError("SOURCE_DISABLED", "SOURCE_DISABLED"); }) as unknown as Rpc;
    const f = fakeFetcher({});
    expect(await runSource("mascus", { rpc, fetcher: f, env: {}, log: () => undefined })).toMatchObject({ status: "skipped" });
    expect(f.seen).toEqual([]);
  });
  it("sanitises before sending, batches, runs OCR on claimed candidates, finishes ok", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "start_market_run") return { run_id: "r1", connector: "partner-feed", base_url: null, config: { feed_url: "https://p.example/f" }, since: null };
      if (fn === "ingest_observations") return { fetched: (args.p_observations as unknown[]).length, new: 1, matched: 0, alerts: 0 };
      if (fn === "claim_ocr_candidates") return [{ id: "o1", images: ["https://i/1.jpg"] }];
      return null;
    }) as Rpc;
    const feed = [{ external_id: "a", seller_type: "private", seller_name: "Privat Person", raw: { phone: "070" } }, { external_id: "b", seller_type: "unknown" }];
    const ocr = vi.fn(async () => undefined);
    const r = await runSource("partner-feed", { rpc, fetcher: { text: async () => JSON.stringify(feed) }, env: {}, log: () => undefined, ocr });
    expect(r).toMatchObject({ status: "ok", fetched: 2 });
    const sent = calls.find((c) => c[0] === "ingest_observations")![1];
    expect(sent.p_complete).toBe(true);
    expect(JSON.stringify(sent.p_observations)).not.toMatch(/Privat Person|070/);
    expect(ocr).toHaveBeenCalledWith("o1", ["https://i/1.jpg"]);
    expect(calls.at(-1)).toEqual(["finish_market_run", { p_run_id: "r1", p_status: "ok" }]);
  });
  it("connector failure ⇒ run finished as error with message", async () => {
    const calls: string[] = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => {
      calls.push(`${fn}:${args.p_status ?? ""}`);
      if (fn === "start_market_run") return { run_id: "r1", connector: "partner-feed", base_url: null, config: {}, since: null };
      return null;
    }) as Rpc;
    const r = await runSource("partner-feed", { rpc, fetcher: fakeFetcher({}), env: {}, log: () => undefined });
    expect(r).toMatchObject({ status: "error", error: expect.stringContaining("feed_url") });
    expect(calls).toEqual(["start_market_run:", "finish_market_run:error"]);
  });
});
