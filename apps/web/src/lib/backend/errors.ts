/**
 * Errors from the backend carry a stable code (e.g. FORBIDDEN, ACTIVE_ENCUMBRANCE_EXISTS) that the UI translates with
 * i18n key `errors.<CODE>` (see ADR 0007). Results with { ok: false, error } are turned into the same error.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly detail: unknown;
  readonly status: number;
  constructor(code: string, detail?: unknown, status = 400) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

const STATUS: Record<string, number> = { PT401: 401, PT403: 403, PT404: 404, PT409: 409, PT422: 422, PT429: 429, "42501": 403 };

/** Converts a Postgres/PostgREST error ({ message, code, details }) into an ApiError. */
export function fromPgError(e: { message?: string; code?: string; details?: string | null; detail?: string | null }): ApiError {
  const raw = e.details ?? e.detail ?? null;
  let detail: unknown = raw ?? undefined;
  if (typeof raw === "string") {
    try {
      detail = JSON.parse(raw);
    } catch {
      detail = raw;
    }
  }
  const message = e.message ?? "UNKNOWN";
  const code = /^[A-Z][A-Z0-9_]+$/.test(message) ? message : message.includes("permission denied") ? "FORBIDDEN" : "UNKNOWN";
  // An unexpected database error is a bug: make it visible while developing (users only see the generic message).
  if (code === "UNKNOWN" && import.meta.env?.DEV) console.error("database error:", message);
  return new ApiError(code, code === "UNKNOWN" ? { message, ...(typeof detail === "object" ? detail : {}) } : detail, STATUS[e.code ?? ""] ?? 400);
}

/** Throws if an RPC result signals a handled failure ({ ok: false, error }). */
export function unwrap<T>(result: T): T {
  const r = result as { ok?: boolean; error?: string } | null;
  if (r && typeof r === "object" && r.ok === false && typeof r.error === "string") {
    throw new ApiError(r.error, r, 409);
  }
  return result;
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}
