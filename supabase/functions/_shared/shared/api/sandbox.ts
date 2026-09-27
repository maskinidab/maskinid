/**
 * API sandbox (step 24, ADR 0021). Keys created as sandbox (mk_test_…) are answered from this fixed dataset by the
 * api-v1 function and never reach the register: nothing is stored, no webhooks fire, nothing is billed. Every response
 * carries `"sandbox": true` (arrays: on every item) and the header `MaskinID-Sandbox: true`. The machines cover the scenarios an integration must handle.
 */
import { regCheckChar } from "../regnr.ts";
import type { ApiRequest, Route } from "./routes.ts";

const reg = (payload: string) => payload + regCheckChar(payload);

export interface SandboxMachine {
  id: string; reg_number: string; serial: string; make: string; model: string; year: number; category: string;
  status: "active" | "stolen" | "disputed" | "scrapped";
  scenario: "clean" | "financed" | "stolen" | "disputed" | "scrapped";
  financing: { type: string; holder: string; start_date: string } | null;
  flags: { type: string; raised_at: string }[];
}

export const SANDBOX_MACHINES: SandboxMachine[] = [
  { id: "5a4db0c0-0000-4000-8000-000000000001", reg_number: reg("T5T2AB"), serial: "SBXCLEAN0001", make: "Volvo", model: "EC220E", year: 2021,
    category: "excavator_tracked", status: "active", scenario: "clean", financing: null, flags: [] },
  { id: "5a4db0c0-0000-4000-8000-000000000002", reg_number: reg("T5T2AF"), serial: "SBXFINANCED02", make: "Caterpillar", model: "950 GC", year: 2020,
    category: "wheel_loader", status: "active", scenario: "financed", financing: { type: "leasing", holder: "Sandbox Finans AB", start_date: "2025-03-01" }, flags: [] },
  { id: "5a4db0c0-0000-4000-8000-000000000003", reg_number: reg("T5T2AS"), serial: "SBXSTOLEN0003", make: "Kubota", model: "KX080-4", year: 2019,
    category: "excavator_tracked", status: "stolen", scenario: "stolen", financing: null, flags: [{ type: "stolen", raised_at: "2026-08-14T06:00:00Z" }] },
  { id: "5a4db0c0-0000-4000-8000-000000000004", reg_number: reg("T5T2AD"), serial: "SBXDISPUTE04", make: "Liebherr", model: "R 926", year: 2018,
    category: "excavator_tracked", status: "disputed", scenario: "disputed", financing: null, flags: [{ type: "disputed", raised_at: "2026-07-02T09:30:00Z" }] },
  { id: "5a4db0c0-0000-4000-8000-000000000005", reg_number: reg("T5T2AX"), serial: "SBXSCRAP0005", make: "JCB", model: "3CX", year: 2009,
    category: "backhoe", status: "scrapped", scenario: "scrapped", financing: null, flags: [] },
];

export interface SandboxResponse { status: number; body: unknown }

const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[\s-]/g, "");

function find(value: unknown): SandboxMachine | undefined {
  const q = norm(value);
  return SANDBOX_MACHINES.find((m) => m.reg_number === q || m.serial === q || m.id === String(value));
}

function machineView(m: SandboxMachine) {
  return { sandbox: true, id: m.id, reg_number: m.reg_number, make: m.make, model: m.model, year: m.year, category: m.category, status: m.status,
    identifiers: [{ type: "serial", value: m.serial, verified: true }], verification_level: m.scenario === "clean" ? 2 : 1,
    flags: m.flags.map((f) => ({ ...f, status: "active" })), financing: { has_active: !!m.financing, active: m.financing } };
}

function checkResult(m: SandboxMachine | undefined, orgName: string, now: string) {
  if (!m) return { found: false, performed_at: now, performed_by: orgName };
  return { found: true, machine_id: m.id, reg_number: m.reg_number, make: m.make, model: m.model, year: m.year, status: m.status,
    has_active_financing: !!m.financing, financing: m.financing, flags: m.flags, risk_signals: m.scenario === "clean" ? [] : [{ type: m.scenario }],
    owner_org_name: "Sandbox Ägare AB", owner_org_number: "559999-0000", verification_level: m.scenario === "clean" ? 2 : 1,
    performed_at: now, performed_by: orgName };
}

let seq = 0;
const fakeId = () => `5a4db0c0-${(++seq).toString(16).padStart(4, "0")}-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;

/** Answers one API call from the sandbox dataset. */
export function sandboxHandle(route: Route, req: ApiRequest & { method: string }, opts: { orgName?: string; now?: () => Date } = {}): SandboxResponse {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const org = opts.orgName ?? "Sandbox";
  const ok = (body: Record<string, unknown>, status = route.status ?? 200): SandboxResponse => ({ status, body: { sandbox: true, ...body } });
  const list = (items: Record<string, unknown>[]): SandboxResponse => ({ status: route.status ?? 200, body: items.map((x) => ({ sandbox: true, ...x })) });
  const err = (status: number, code: string, detail?: unknown): SandboxResponse => ({ status, body: { sandbox: true, code, ...(detail ? { detail } : {}) } });
  const body = req.body ?? {};
  const byId = (id: unknown) => SANDBOX_MACHINES.find((m) => m.id === id);

  switch (route.rpc) {
    case "lookup_machine": {
      const m = find(req.query.reg ?? req.query.serial ?? req.query.pin ?? req.query.vin ?? req.query.road_reg);
      return m ? ok(machineView(m)) : err(404, "NOT_FOUND");
    }
    case "partial_search": {
      const q = norm(req.query.q);
      if (q.length < 5) return err(422, "VALIDATION", { field: "query", reason: "min_5" });
      const hits = SANDBOX_MACHINES.filter((m) => m.reg_number.includes(q) || m.serial.includes(q)).map((m) => {
        const v = m.reg_number.includes(q) ? m.reg_number : m.serial;
        const at = v.indexOf(q);
        return { id: m.id, reg_number: m.reg_number, make: m.make, model: m.model, year: m.year, category: m.category,
          flagged: m.status === "stolen" || m.status === "disputed", match_type: v === m.reg_number ? "reg" : "serial",
          match: "•".repeat(at) + q + "•".repeat(v.length - at - q.length) };
      });
      return list(hits);
    }
    case "get_machine": {
      const m = byId(req.params.id);
      return m ? ok(machineView(m)) : err(404, "NOT_FOUND");
    }
    case "get_machine_history": {
      const m = byId(req.params.id);
      if (!m) return err(404, "NOT_FOUND");
      const events = [{ seq: 1, type: "machine.registered", created_at: "2025-01-10T08:00:00Z" }];
      if (m.financing) events.push({ seq: 2, type: "encumbrance.registered", created_at: `${m.financing.start_date}T08:00:00Z` });
      for (const f of m.flags) events.push({ seq: events.length + 1, type: `flag.${f.type === "stolen" ? "stolen" : "raised"}`, created_at: f.raised_at });
      if (m.status === "scrapped") events.push({ seq: events.length + 1, type: "machine.deregistered", created_at: "2026-02-01T08:00:00Z" });
      return list(events.reverse());
    }
    case "perform_check": {
      const q = (body.query ?? body) as Record<string, unknown>;
      const m = find(q.value ?? q.reg ?? q.serial ?? q.pin ?? q.vin);
      return ok({ id: fakeId(), receipt_number: `SANDBOX-${now.slice(0, 10)}`, created_at: now, result: checkResult(m, org, now) });
    }
    case "perform_check_batch": {
      const qs = Array.isArray(body.queries) ? (body.queries as Record<string, unknown>[]) : [];
      if (qs.length > 500) return err(422, "VALIDATION", { field: "queries" });
      return list(qs.map((q) => ({ id: fakeId(), receipt_number: `SANDBOX-${now.slice(0, 10)}`,
        result: checkResult(find(q.value ?? q.reg ?? q.serial), org, now) })));
    }
    case "register_machine": {
      if (!body.make || !body.model || !body.category || !Array.isArray(body.identifiers) || !body.identifiers.length) return err(422, "VALIDATION");
      const serials = (body.identifiers as { value?: string }[]).map((i) => norm(i.value));
      const dup = SANDBOX_MACHINES.find((m) => serials.includes(m.serial));
      if (dup) return ok({ id: fakeId(), reg_number: reg("T5T2AN"), status: "disputed", conflict: { type: "duplicate_identifier", machine_id: dup.id } });
      return ok({ id: fakeId(), reg_number: reg("T5T2AN"), status: "active", verification_level: 0 });
    }
    case "update_machine": case "record_hours": case "bind_label": {
      const m = byId(req.params.id);
      if (!m) return err(404, "NOT_FOUND");
      if (m.status === "scrapped") return err(409, "MACHINE_READ_ONLY");
      return ok({ ok: true, machine_id: m.id });
    }
    case "register_encumbrance": {
      const m = byId(body.machine_id);
      if (!m) return err(404, "NOT_FOUND");
      if (m.status === "stolen") return err(409, "MACHINE_STOLEN");
      if (m.financing) return err(409, "ACTIVE_ENCUMBRANCE_EXISTS", { holder: m.financing.holder, since: m.financing.start_date });
      return ok({ id: fakeId(), machine_id: m.id, type: body.type ?? "leasing", status: "active" });
    }
    case "confirm_encumbrance": case "release_encumbrance":
      return ok({ ok: true, id: req.params.id });
    case "initiate_transfer": {
      const m = byId(body.machine_id);
      if (!m) return err(404, "NOT_FOUND");
      if (m.status === "stolen") return err(409, "MACHINE_STOLEN");
      if (m.status === "disputed") return err(409, "MACHINE_UNDER_INVESTIGATION");
      return ok({ id: fakeId(), machine_id: m.id, status: m.financing ? "awaiting_financier" : "awaiting_buyer" });
    }
    case "accept_transfer":
      return { status: 202, body: { sandbox: true, code: "SIGNATURE_REQUIRED", signing_url: "https://maskinid.se/api-docs#sandbox" } };
    case "approve_transfer_financier": case "cancel_transfer": case "clear_flag": case "delete_webhook":
      return ok({ ok: true });
    case "raise_flag": {
      const m = byId(body.machine_id);
      if (!m) return err(404, "NOT_FOUND");
      if (m.flags.some((f) => f.type === body.type)) return err(409, "FLAG_ALREADY_ACTIVE");
      return ok({ id: fakeId(), machine_id: m.id, type: body.type, status: "active" });
    }
    case "record_inspection":
      return byId(body.machine_id) ? ok({ id: fakeId(), machine_id: body.machine_id }) : err(404, "NOT_FOUND");
    case "submit_oem_records":
      return ok({ ok: true, accepted: Array.isArray(body.rows) ? body.rows.length : 0 });
    case "create_webhook":
      return ok({ id: fakeId(), url: body.url, secret: "whsec_sandbox_not_used" });
    case "list_webhooks":
      return list([]);
    default:
      return err(404, "NOT_FOUND");
  }
}
