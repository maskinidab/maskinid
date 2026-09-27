# 0008 – Test database

**Context.** CLAUDE.md requires RLS/RPC tests against local Supabase. Some build environments have no Docker registry
access, so `supabase start` is unavailable there.

**Decision.** `npm run test:db` (Vitest + `pg`) runs against `DATABASE_URL`. Locally without Docker it creates a fresh
database on a plain PostgreSQL with `supabase/tests/stubs/supabase-stubs.sql` (roles anon/authenticated/service_role with
Supabase's default grants and BYPASSRLS for service_role, `auth.uid()` from `request.jwt.claims`, minimal `storage`).
CI runs the same suite twice: against `supabase db start && supabase db reset` (fidelity) and against plain
PostgreSQL 16 (parity with local runs). Tests act as one fixture user per role and run in rolled-back transactions.

**Consequences.** SQL must work on Supabase Postgres 15–17, plain Postgres 16 and PGlite (browser demo).
