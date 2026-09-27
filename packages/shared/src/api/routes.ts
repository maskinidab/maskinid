/**
 * Public REST API v1 (SPEC §12): one table drives both the api-v1 Edge Function (routing, scope check, RPC call)
 * and the OpenAPI 3.1 document on /api-docs, so the two cannot drift apart.
 */
export type Scope = "machines:read" | "machines:write" | "checks:write" | "encumbrances:write" | "transfers:write" | "flags:write"
  | "webhooks:manage" | "inspections:write" | "oem:write";

export const SCOPES: Scope[] = ["machines:read", "machines:write", "checks:write", "encumbrances:write", "transfers:write", "flags:write",
  "webhooks:manage", "inspections:write", "oem:write"];

export interface ApiRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  orgId: string;
}

export interface Route {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string; // /machines/:id
  scope: Scope;
  rpc: string;
  summary: string;
  args(r: ApiRequest): Record<string, unknown>;
  /** Response status on success (default 200). */
  status?: number;
  body?: Record<string, { type: string; description?: string; required?: boolean }>;
  queryParams?: string[];
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));

export const ROUTES: Route[] = [
  { method: "GET", path: "/machines/lookup", scope: "machines:read", rpc: "lookup_machine", summary: "Exact lookup by reg number, serial, PIN or VIN.",
    queryParams: ["reg", "serial", "pin", "vin", "road_reg"],
    args: (r) => ({ p_org_id: r.orgId, p_query: r.query.reg ?? r.query.serial ?? r.query.pin ?? r.query.vin ?? r.query.road_reg ?? "" }) },
  { method: "GET", path: "/machines/search", scope: "machines:read", rpc: "partial_search",
    summary: "Partial search (≥ 5 characters of a serial or reg number) for lenders, insurers, dealers and inspection bodies. Masked results.",
    queryParams: ["q"], args: (r) => ({ p_org_id: r.orgId, p_query: r.query.q ?? "" }) },
  { method: "GET", path: "/machines/:id", scope: "machines:read", rpc: "get_machine", summary: "Machine as your role sees it.",
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: r.params.id }) },
  { method: "GET", path: "/machines/:id/events", scope: "machines:read", rpc: "get_machine_history", summary: "Role-filtered history.",
    queryParams: ["limit", "before_seq"],
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: r.params.id, p_limit: Number(r.query.limit ?? 200), p_before_seq: r.query.before_seq ? Number(r.query.before_seq) : null }) },
  { method: "POST", path: "/checks", scope: "checks:write", rpc: "perform_check", summary: "Financing check with receipt.", status: 201,
    body: { query: { type: "object", description: "{ type: reg|pin|serial|vin|road_reg|any, value }", required: true }, purpose: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_query: r.body.query ?? r.body, p_purpose: str(r.body.purpose) }) },
  { method: "POST", path: "/checks/batch", scope: "checks:write", rpc: "perform_check_batch", summary: "Up to 500 checks.", status: 201,
    body: { queries: { type: "array", required: true }, purpose: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_queries: r.body.queries ?? [], p_purpose: str(r.body.purpose) }) },
  { method: "POST", path: "/machines", scope: "machines:write", rpc: "register_machine", summary: "Register a machine. Returns reg_number.", status: 201,
    body: { identifiers: { type: "array", required: true }, make: { type: "string", required: true }, model: { type: "string", required: true },
      category: { type: "string", required: true }, year: { type: "integer" }, owner_org_number: { type: "string" }, label_code: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_data: r.body }) },
  { method: "PATCH", path: "/machines/:id", scope: "machines:write", rpc: "update_machine", summary: "Limited fields: hour_meter, description, color.",
    body: { hour_meter: { type: "integer" }, description: { type: "string" }, color: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: r.params.id,
      p_patch: Object.fromEntries(Object.entries(r.body).filter(([k]) => ["hour_meter", "description", "color"].includes(k))) }) },
  { method: "POST", path: "/machines/:id/hours", scope: "machines:write", rpc: "record_hours", summary: "Report the hour meter.", status: 201,
    body: { hours: { type: "integer", required: true }, at: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: r.params.id, p_hours: Number(r.body.hours), p_at: str(r.body.at) ?? undefined }) },
  { method: "POST", path: "/machines/:id/labels/bind", scope: "machines:write", rpc: "bind_label", summary: "Bind a label code.",
    body: { code: { type: "string", required: true }, role: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: r.params.id, p_code: str(r.body.code), p_role: str(r.body.role) ?? "primary" }) },
  { method: "POST", path: "/encumbrances", scope: "encumbrances:write", rpc: "register_encumbrance", status: 201,
    summary: "Register an encumbrance (financier). 409 ACTIVE_ENCUMBRANCE_EXISTS if another is active.",
    body: { machine_id: { type: "string", required: true }, type: { type: "string", required: true }, contract_ref: { type: "string" },
      start_date: { type: "string" }, end_date: { type: "string" }, notes: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: str(r.body.machine_id), p_type: str(r.body.type), p_contract_ref: str(r.body.contract_ref),
      p_start_date: str(r.body.start_date) ?? undefined, p_end_date: str(r.body.end_date), p_notes: str(r.body.notes) }) },
  { method: "POST", path: "/encumbrances/:id/confirm", scope: "encumbrances:write", rpc: "confirm_encumbrance", summary: "Confirm a pending encumbrance.",
    args: (r) => ({ p_org_id: r.orgId, p_encumbrance_id: r.params.id }) },
  { method: "POST", path: "/encumbrances/:id/release", scope: "encumbrances:write", rpc: "release_encumbrance", summary: "Release (holder only).",
    body: { reason: { type: "string" } }, args: (r) => ({ p_org_id: r.orgId, p_encumbrance_id: r.params.id, p_reason: str(r.body.reason) }) },
  { method: "POST", path: "/transfers", scope: "transfers:write", rpc: "initiate_transfer", summary: "Start a transfer; the buyer signs in the app.", status: 201,
    body: { machine_id: { type: "string", required: true }, buyer: { type: "object", description: "{ org_id | org_number | email }", required: true },
      sale_date: { type: "string" }, new_financing: { type: "object" } },
    args: (r) => {
      const b = (r.body.buyer ?? {}) as Record<string, unknown>;
      return { p_org_id: r.orgId, p_machine_id: str(r.body.machine_id), p_sale_date: str(r.body.sale_date) ?? undefined, p_to_org_id: str(b.org_id),
        p_to_org_number: str(b.org_number), p_to_email: str(b.email), p_new_financing: r.body.new_financing ?? null };
    } },
  { method: "POST", path: "/transfers/:id/accept", scope: "transfers:write", rpc: "accept_transfer",
    summary: "Accept as buyer. Needs a personal BankID signature: returns 202 with signing_url.",
    args: (r) => ({ p_org_id: r.orgId, p_transfer_id: r.params.id }) },
  { method: "POST", path: "/transfers/:id/approve", scope: "transfers:write", rpc: "approve_transfer_financier", summary: "Financier decision.",
    body: { decision: { type: "string", description: "release | transfer_to_buyer | reject", required: true } },
    args: (r) => ({ p_org_id: r.orgId, p_transfer_id: r.params.id, p_decision: str(r.body.decision) }) },
  { method: "POST", path: "/transfers/:id/cancel", scope: "transfers:write", rpc: "cancel_transfer", summary: "Cancel or decline.",
    body: { reason: { type: "string" } }, args: (r) => ({ p_org_id: r.orgId, p_transfer_id: r.params.id, p_reason: str(r.body.reason) }) },
  { method: "POST", path: "/flags", scope: "flags:write", rpc: "raise_flag", summary: "Raise a flag (stolen needs a police report number).", status: 201,
    body: { machine_id: { type: "string", required: true }, type: { type: "string", required: true }, reference: { type: "string" },
      description: { type: "string" }, occurred_at: { type: "string" }, location: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: str(r.body.machine_id), p_type: str(r.body.type), p_reference: str(r.body.reference),
      p_description: str(r.body.description), p_occurred_at: str(r.body.occurred_at), p_location_text: str(r.body.location) }) },
  { method: "POST", path: "/flags/:id/clear", scope: "flags:write", rpc: "clear_flag", summary: "Clear a flag.",
    body: { reason: { type: "string", required: true } }, args: (r) => ({ p_org_id: r.orgId, p_flag_id: r.params.id, p_reason: str(r.body.reason) }) },
  { method: "POST", path: "/inspections", scope: "inspections:write", rpc: "record_inspection", summary: "Record an inspection (inspection body).", status: 201,
    body: { machine_id: { type: "string", required: true }, performed_at: { type: "string", required: true }, result: { type: "string", required: true },
      valid_until: { type: "string" }, type: { type: "string" }, certificate_no: { type: "string" } },
    args: (r) => ({ p_org_id: r.orgId, p_machine_id: str(r.body.machine_id), p_data: r.body }) },
  { method: "POST", path: "/oem/records", scope: "oem:write", rpc: "submit_oem_records", summary: "Manufacturer delivery data (up to 10 000 rows).", status: 201,
    body: { rows: { type: "array", required: true } }, args: (r) => ({ p_org_id: r.orgId, p_rows: r.body.rows ?? [] }) },
  { method: "POST", path: "/webhooks", scope: "webhooks:manage", rpc: "create_webhook", summary: "Create a webhook; the secret is returned once.", status: 201,
    body: { url: { type: "string", required: true }, event_types: { type: "array" } },
    args: (r) => ({ p_org_id: r.orgId, p_url: str(r.body.url), p_event_types: r.body.event_types ?? [] }) },
  { method: "GET", path: "/webhooks", scope: "webhooks:manage", rpc: "list_webhooks", summary: "List webhooks.", args: (r) => ({ p_org_id: r.orgId }) },
  { method: "DELETE", path: "/webhooks/:id", scope: "webhooks:manage", rpc: "delete_webhook", summary: "Delete a webhook.",
    args: (r) => ({ p_org_id: r.orgId, p_webhook_id: r.params.id }) },
];

export function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const rp = route.path.split("/").filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i]!.startsWith(":")) params[rp[i]!.slice(1)] = decodeURIComponent(parts[i]!);
      else if (rp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

/** HTTP status for an application error code (ADR 0007). */
export function statusForCode(code: string): number {
  if (code === "NOT_AUTHENTICATED") return 401;
  if (["FORBIDDEN", "IDENTITY_NOT_VERIFIED", "ORG_NOT_APPROVED", "MFA_REQUIRED", "SCOPE_MISSING"].includes(code)) return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "RATE_LIMITED") return 429;
  if (code.endsWith("_EXISTS") || code.includes("CONFLICT") || code.startsWith("MACHINE_") || code.startsWith("TRANSFER_") || code === "IDEMPOTENCY_CONFLICT") return 409;
  return 422;
}

export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const p = r.path.replace(/:(\w+)/g, "{$1}");
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string", format: "uuid" } }))
      .concat((r.queryParams ?? []).map((q) => ({ name: q, in: "query", required: false, schema: { type: "string" } })) as never[]);
    const body = r.body ? { required: true, content: { "application/json": { schema: { type: "object",
      required: Object.entries(r.body).filter(([, v]) => v.required).map(([k]) => k),
      properties: Object.fromEntries(Object.entries(r.body).map(([k, v]) => [k, { type: v.type, ...(v.description ? { description: v.description } : {}) }])) } } } } : undefined;
    (paths[p] ??= {})[r.method.toLowerCase()] = {
      summary: r.summary, operationId: r.rpc, security: [{ bearer: [] }], "x-scope": r.scope,
      ...(params.length ? { parameters: params } : {}), ...(body ? { requestBody: body } : {}),
      responses: { [String(r.status ?? 200)]: { description: "OK" }, 401: { $ref: "#/components/responses/Error" }, 403: { $ref: "#/components/responses/Error" },
        404: { $ref: "#/components/responses/Error" }, 409: { $ref: "#/components/responses/Error" }, 422: { $ref: "#/components/responses/Error" },
        429: { $ref: "#/components/responses/Error" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "MaskinID API", version: "1.0.0", description: "Bearer API key per organisation, scopes per key, Idempotency-Key on POST. Webhooks are signed with HMAC-SHA256 (header MaskinID-Signature: t=<unix>,v1=<hex of HMAC(secret, t + '.' + body)>)." },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      responses: { Error: { description: "Error", content: { "application/json": { schema: { type: "object", properties: { code: { type: "string" }, detail: { type: "object" } } } } } } },
    },
    paths,
  };
}
