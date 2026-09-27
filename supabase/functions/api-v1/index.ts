// Edge Function: api-v1 (SPEC §12) – REST gateway. Authorization: Bearer <api key>. The key is resolved by its SHA-256,
// then the route's RPC runs as service_role with header x-maskinid-api-key-id, so the database applies exactly the same
// authorisation, scopes and event logging as for the web app. Idempotency-Key on POST replays the first response.
// Sandbox keys (mk_test_) are answered from the fixed test dataset in shared/api/sandbox.ts and never reach the register.
import { matchRoute, statusForCode } from "../_shared/shared/api/routes.ts";
import { sandboxHandle } from "../_shared/shared/api/sandbox.ts";
import { serviceClient } from "../_shared/db.ts";
import { corsHeaders, ipHash, json, preflight, sha256Hex } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

const PREFIX = /^.*?\/api-v1(?:\/v1)?/;

Deno.serve(withSentry("api-v1", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const started = Date.now();
  const url = new URL(req.url);
  const path = url.pathname.replace(PREFIX, "") || "/";
  const ip = await ipHash(req);
  let keyId: string | null = null;
  const done = async (status: number, body: unknown, extra: Record<string, string> = {}) => {
    if (keyId) {
      await serviceClient().rpc("log_api_request", { p_api_key_id: keyId, p_endpoint: path.replace(/[0-9a-f-]{36}/g, ":id"), p_method: req.method,
        p_status: status, p_latency_ms: Date.now() - started, p_ip_hash: ip,
        p_error_code: status >= 400 ? String((body as { code?: string })?.code ?? "") : null });
    }
    return json(status, body, extra);
  };

  if (path === "/" || path === "/openapi.json") {
    return Response.redirect(`${Deno.env.get("APP_ORIGIN") ?? "https://maskinid.se"}/api-docs`, 302);
  }
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(mk_(?:live|test)_[0-9a-f]{48})$/)?.[1];
  if (!token) return json(401, { code: "NOT_AUTHENTICATED" }, { "WWW-Authenticate": "Bearer" });
  const svc = serviceClient();
  const k = await svc.rpc("resolve_api_key", { p_key_hash: await sha256Hex(token) });
  if (k.error || !k.data?.ok) {
    const code = k.data?.error ?? "NOT_AUTHENTICATED";
    return json(statusForCode(code), { code }, code === "RATE_LIMITED" ? { "Retry-After": "60" } : {});
  }
  keyId = k.data.id as string;
  const orgId = k.data.org_id as string;

  const m = matchRoute(req.method, path);
  if (!m) return done(404, { code: "NOT_FOUND", detail: { path } });
  if (!(k.data.scopes as string[]).includes(m.route.scope)) return done(403, { code: "SCOPE_MISSING", detail: { scope: m.route.scope } });

  let body: Record<string, unknown> = {};
  if (req.method === "POST" || req.method === "PATCH") {
    const text = await req.text();
    if (text.length > 1_000_000) return done(413, { code: "PAYLOAD_TOO_LARGE" });
    try { body = text ? JSON.parse(text) : {}; } catch { return done(400, { code: "INVALID_JSON" }); }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return done(400, { code: "INVALID_JSON" });
  }

  if (k.data.sandbox) {
    const r = sandboxHandle(m.route, { method: req.method, params: m.params, query: Object.fromEntries(url.searchParams), body, orgId });
    return done(r.status, r.body, { ...corsHeaders(), "Cache-Control": "no-store", "MaskinID-Sandbox": "true" });
  }

  const idem = req.method === "POST" ? req.headers.get("idempotency-key") : null;
  const reqHash = idem ? await sha256Hex(`${req.method} ${path} ${JSON.stringify(body)}`) : "";
  if (idem) {
    const prev = await svc.rpc("api_idempotency_get", { p_api_key_id: keyId, p_key: idem, p_request_hash: reqHash });
    if (prev.data?.conflict) return done(409, { code: "IDEMPOTENCY_CONFLICT" });
    if (prev.data) return done(prev.data.status, prev.data.body, { "Idempotency-Replayed": "true" });
  }

  const args = Object.fromEntries(Object.entries(m.route.args({ params: m.params, query: Object.fromEntries(url.searchParams), body, orgId }))
    .filter(([, v]) => v !== undefined));
  const client = serviceClient({ "x-maskinid-api-key-id": keyId });
  const { data, error } = await client.rpc(m.route.rpc, args);

  let status = m.route.status ?? 200;
  let out: unknown = data;
  if (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? "") ? error.message : "INTERNAL";
    let detail: unknown;
    try { detail = error.details ? JSON.parse(error.details) : undefined; } catch { detail = error.details; }
    if ((code === "SIGNATURE_REQUIRED" || code === "SIGNATURE_REQUIRES_USER") && m.route.rpc === "accept_transfer") {
      // A person must sign with BankID: hand back a link to the transfer in the app (SPEC §12).
      status = 202;
      out = { code: "SIGNATURE_REQUIRED", signing_url: `${Deno.env.get("APP_ORIGIN") ?? "https://maskinid.se"}/o/${k.data.org_slug}/transfers/${m.params.id}` };
    } else {
      if (code === "INTERNAL") console.error("api-v1", m.route.rpc, error.message);
      status = code === "INTERNAL" ? 500 : statusForCode(code);
      out = { code, ...(detail ? { detail } : {}) };
    }
  } else if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
    // Handled conflicts come back as { ok: false, error } (ADR 0007), e.g. ACTIVE_ENCUMBRANCE_EXISTS ⇒ 409 with the holder.
    const d = data as { error: string; [k: string]: unknown };
    status = statusForCode(d.error);
    out = { code: d.error, ...Object.fromEntries(Object.entries(d).filter(([key]) => !["ok", "error"].includes(key))) };
  }
  if (idem && status < 500) await svc.rpc("api_idempotency_put", { p_api_key_id: keyId, p_key: idem, p_request_hash: reqHash, p_status: status, p_response: out ?? null });
  return done(status, out ?? null, { ...corsHeaders(), "Cache-Control": "no-store" });
}));
