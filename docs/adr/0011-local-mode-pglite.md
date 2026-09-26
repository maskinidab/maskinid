# 0011 – Local mode: the real database in the browser

**Context.** The prototype ran without a backend on a hand-written in-browser mock, which would have to duplicate every
rule of SPEC §4–§11. The README promises "up and running in 10 minutes" and the demo must work anywhere.

**Decision.** `VITE_DATA_SOURCE=local` (default) runs the same migrations and demo seed in PGlite in the browser. A
pre-built, gzipped data directory (`apps/web/scripts/demo-db.mjs`, versioned by a hash of stubs+migrations+seed) is
downloaded once and kept in IndexedDB. RPCs run with the same roles and JWT claims as PostgREST, so RLS and every
authorisation check are the real ones. Auth (password, magic link shown in the UI, TOTP) and Edge Functions are
emulated with the same mock adapters the server uses in DEMO_MODE. `VITE_DATA_SOURCE=supabase` uses supabase-js.

**Consequences.** One code path for business rules. The local demo downloads ~6 MB once. Public pages served from
Supabase stay light because PGlite is only loaded in local mode.
