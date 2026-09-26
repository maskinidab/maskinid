# 0013 – Public API as a thin gateway over the same RPCs

**Context.** SPEC §12 describes a REST API with scopes, idempotency and webhooks. Duplicating authorisation in a
separate API layer would let the API and the web app drift apart.

**Decision.**
- `api-v1` (Edge Function) resolves `Authorization: Bearer mk_live_…` by SHA-256 (`resolve_api_key`, rate limit per
  key and minute), checks the route's scope, and calls the route's RPC as `service_role` with header
  `x-maskinid-api-key-id`. `app.require_actor` then treats the key as its organisation, RPCs check scopes again with
  `app.require_scope`, and events are written with `actor_type = api`. Every authenticated-callable function is also
  granted to `service_role` (`app.grant_api_access()`, test in `99_function_exposure`).
- One route table in `packages/shared/src/api/routes.ts` drives routing and the OpenAPI 3.1 document on `/api-docs`.
- Idempotency-Key on POST stores the first response for 24 hours (per key); a different body with the same key is 409.
- Accepting a transfer always needs a person with BankID: the API answers 202 with `signing_url` (ADR 0010).
- Webhooks: HMAC-SHA256 over `t.body` in `MaskinID-Signature`, 5 retries with backoff (1 min … 12 h), manual
  redelivery; URLs must be https to public hosts (SSRF guard in the database and no redirects in the dispatcher).
  The secret is shown once and kept only to sign.
