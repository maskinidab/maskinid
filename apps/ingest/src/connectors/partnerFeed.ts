import type { Connector, Observation } from "../types.ts";

/**
 * Official partner feed (tos_status = partner_feed): JSON in the ingest wire format, either an array or { items: [] }.
 * config: { feed_url, token_env? } – the bearer token is read from the worker environment, never stored in the DB.
 * The feed is the partner's full active set ⇒ complete = true (missing listings become inactive).
 */
export const partnerFeed: Connector = {
  key: "partner-feed",
  complete: true,
  async fetchListings(ctx) {
    const cfg = ctx.source.config as { feed_url?: string; token_env?: string };
    if (!cfg.feed_url) throw new Error("partner-feed: config.feed_url missing");
    const token = cfg.token_env ? ctx.env[cfg.token_env] : undefined;
    const body = await ctx.fetcher.text(cfg.feed_url, { accept: "application/json", headers: token ? { authorization: `Bearer ${token}` } : undefined });
    if (body === null) throw new Error("partner-feed: feed not reachable");
    const data = JSON.parse(body) as unknown;
    const items = (Array.isArray(data) ? data : (data as { items?: unknown[] }).items ?? []) as Record<string, unknown>[];
    return items.filter((i) => typeof i.external_id === "string" || typeof i.external_id === "number").slice(0, ctx.limit).map((i) => ({
      ...(i as unknown as Observation),
      external_id: String(i.external_id),
      seller_type: i.seller_type === "business" || i.seller_type === "private" ? i.seller_type : "unknown",
      serial_source: i.serial ? "feed" : undefined,
      serial_confidence: i.serial ? 1 : undefined,
    }));
  },
};
