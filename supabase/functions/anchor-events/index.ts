// Edge Function: anchor-events (SPEC §11.4)
//
// Nightly: verifies the event hash chain, computes yesterday's Merkle root (public.anchor_compute), publishes it as
// anchors/YYYY-MM-DD.txt in a public GitHub repository and records the commit URL (public.anchor_mark_published).
// Scheduled by pg_cron / GitHub Actions with the x-cron-secret header. Without GitHub configuration (demo/staging)
// the anchor is still stored and shown on /security with a local reference.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, ANCHOR_GITHUB_REPO (owner/repo), ANCHOR_GITHUB_TOKEN
import { serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

export function anchorFileContent(a: Record<string, unknown>): string {
  return [
    `MaskinID event anchor`,
    `day: ${a.day}`,
    `first_seq: ${a.first_seq ?? ""}`,
    `last_seq: ${a.last_seq}`,
    `event_count: ${a.event_count}`,
    `merkle_root: ${a.root_hash}`,
    `chain_hash: ${a.chain_hash ?? ""}`,
    `hash: sha256(prev_hash|seq|id|type|machine_id|org_id|actor_type|actor_user_id|actor_org_id|payload|created_at)`,
    `merkle: sha256(left || right), odd levels duplicate the last node`,
    `verify: https://maskinid.se/security`,
    "",
  ].join("\n");
}

async function publishToGitHub(repo: string, token: string, day: string, content: string): Promise<string> {
  const path = `anchors/${day}.txt`;
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "maskinid-anchor" };
  const existing = await fetch(api, { headers });
  if (existing.ok) {
    const body = await existing.json();
    return body.html_url as string; // already published (idempotent)
  }
  const res = await fetch(api, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: `anchor ${day}`, content: btoa(content) }),
  });
  if (!res.ok) throw new Error(`github ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.commit?.html_url ?? body.content?.html_url;
}

Deno.serve(withSentry("anchor-events", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const url = new URL(req.url);
  const db = serviceClient();
  const day = url.searchParams.get("day") ?? undefined;
  const { data: anchor, error } = await db.rpc("anchor_compute", day ? { p_day: day } : {});
  if (error) return rpcError(error);
  if (anchor.published_at) return json(200, anchor);
  const repo = Deno.env.get("ANCHOR_GITHUB_REPO");
  const token = Deno.env.get("ANCHOR_GITHUB_TOKEN");
  let ref = `local:${anchor.root_hash}`;
  if (repo && token) ref = await publishToGitHub(repo, token, anchor.day, anchorFileContent(anchor));
  const { data, error: e2 } = await db.rpc("anchor_mark_published", { p_day: anchor.day, p_external_ref: ref });
  if (e2) return rpcError(e2);
  return json(200, data);
}));
