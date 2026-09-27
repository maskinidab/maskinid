# 0004 – Migration naming and order

**Context.** SPEC §14 names migrations `0001_extensions … 0014_indexes` by topic, CLAUDE.md asks for one migration per
build step, and the repository already had timestamped Supabase migrations (`20260926000001–3`) applied to the live
project. Committed migrations are never edited.

**Decision.** New migrations are timestamped `20260927NNNNNN_<topic>.sql` so the Supabase CLI applies them after the
prototype. Topics follow SPEC names where they exist. Because every RPC must write an event (rule 3), the events table
and hash chain (SPEC's `0006_events_audit`) are created right after the enums, before organisations and machines.
RLS policies, RPCs, triggers and indexes live in the migration of the step that introduces the table rather than in
separate 0011–0014 files, so that no table is ever committed without RLS (rule 1).

**Consequences.** `supabase db reset` and `npm run db:reset` apply the same ordered list.
