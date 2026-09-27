import { parseRobots, type Robots } from "./robots.ts";
import type { Fetcher } from "./types.ts";

export const USER_AGENT = "MaskinIDBot/1.0 (+https://maskinid.se/bot)";
/** SPEC §8.2: at most one request per two seconds per domain. robots.txt Crawl-delay can only make it slower. */
export const MIN_INTERVAL_MS = 2000;

export interface PoliteFetcherOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  userAgent?: string;
}

/** HTTP fetcher that respects robots.txt and a per-domain rate limit. One instance per run. */
export class PoliteFetcher implements Fetcher {
  private readonly robots = new Map<string, Promise<Robots>>();
  private readonly nextSlot = new Map<string, number>();
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minInterval: number;
  private readonly ua: string;
  requests = 0;

  constructor(o: PoliteFetcherOptions = {}) {
    this.f = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minInterval = Math.max(MIN_INTERVAL_MS, o.minIntervalMs ?? MIN_INTERVAL_MS);
    this.ua = o.userAgent ?? USER_AGENT;
  }

  async text(url: string, init: { accept?: string; headers?: Record<string, string> } = {}): Promise<string | null> {
    const res = await this.request(url, init.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5", init.headers);
    return res ? res.text() : null;
  }

  /** Binary download (listing images for OCR); same robots and rate rules. */
  async bytes(url: string): Promise<Uint8Array | null> {
    const res = await this.request(url, "image/*");
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  }

  private async request(url: string, accept: string, headers?: Record<string, string>): Promise<Response | null> {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`unsupported protocol: ${u.protocol}`);
    const robots = await this.robotsFor(u.origin);
    if (!robots.isAllowed(u.pathname + u.search)) return null;
    const interval = Math.max(this.minInterval, (robots.crawlDelaySeconds ?? 0) * 1000);
    const res = await this.get(u, accept, interval, headers);
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.origin}${u.pathname}`);
    return res;
  }

  private robotsFor(origin: string): Promise<Robots> {
    let p = this.robots.get(origin);
    if (!p) {
      p = (async () => {
        const res = await this.get(new URL("/robots.txt", origin), "text/plain", this.minInterval);
        // 4xx ⇒ no restrictions (RFC 9309 §2.3.1.3); 5xx/network ⇒ assume everything is disallowed.
        if (res.status >= 500) return parseRobots("User-agent: *\nDisallow: /", this.ua);
        return parseRobots(res.ok ? await res.text() : "", this.ua);
      })().catch(() => parseRobots("User-agent: *\nDisallow: /", this.ua));
      this.robots.set(origin, p);
    }
    return p;
  }

  private async get(u: URL, accept: string, interval: number, headers: Record<string, string> = {}): Promise<Response> {
    const host = u.host;
    const slot = Math.max(this.now(), this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + interval);
    const wait = slot - this.now();
    if (wait > 0) await this.sleep(wait);
    this.requests++;
    return this.f(u, { headers: { ...headers, "user-agent": this.ua, accept }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  }
}
