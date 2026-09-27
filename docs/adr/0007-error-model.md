# 0007 – Error model

**Context.** SPEC §12/§16 refer to errors by code (`FORBIDDEN`, `ACTIVE_ENCUMBRANCE_EXISTS`). SPEC §16.4 also requires
that a blocked second encumbrance still creates a `conflicts` row, notifications and a webhook – which an exception
would roll back.

**Decision.**
- `app.raise(code, detail)` raises with `message = code`, `detail = JSON` and a PostgREST status SQLSTATE
  (`PT401/403/404/409/422/429`), so HTTP status and client handling follow from the code.
- Outcomes that must persist side effects but not the requested change (double encumbrance, duplicate identifier)
  are **returned**, not raised: `{ "ok": false, "error": "ACTIVE_ENCUMBRANCE_EXISTS", "conflict_id": … }`. No partial
  write of the requested object happens; `api-v1` maps such results to `409`.

**Consequences.** Clients treat both raised errors and `ok:false` results as errors (see `apps/web/src/lib/api`).
