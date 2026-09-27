# 0023 – Operations: jobs, server PDFs, backups, monitoring

**Context.** CLAUDE.md step 26: "Drift: jobbtabell + pg_cron, PDF via Vercel Node-funktioner, backup/PITR-verifiering,
runbooks, `.env.example`, Sentry, uptime (SPEC §21)". §21 is missing (ADR 0003). Several time-based rules had
functions but nothing that ran them, and the digest preference had no sender.

**Decision.**
- **Jobs** are rows in `jobs`; `app.schedule_jobs()` mirrors them into pg_cron (`maskinid:<name>`). SQL jobs call a
  no-argument function in schema `app` through `app.run_job`, which records every run in `job_runs`. HTTP jobs call
  Edge Functions through pg_net with the `x-cron-secret` header; responses are collected every five minutes. Three
  failures in a row notify the superadmins. Operators see and (superadmins) run or pause jobs in Admin → Schemalagda jobb.
  Where pg_cron is missing (local tests) scheduling is a no-op and jobs are tested by running them directly.
- **New jobs**: temporary registrations (reminder 30 days before, then exported), stolen > 24 months (suggestion),
  daily/weekly notification digests (new e-mail template), nightly verification of the whole event chain, partitions,
  statistics, billing close, housekeeping of short-lived technical rows (never register data or events).
- **Server PDFs** in a Vercel Node function (`api/pdf.ts`) reuse the browser generators and call the same RPCs with the
  caller's token and the anon key, so authorisation and numbering are identical; the service key is never in Vercel.
- **Backups**: Supabase PITR in production plus a weekly automated restore drill into a throw-away container verified by
  `scripts/verify-restore.mjs`; the dump never leaves the runner.
- **Monitoring**: Sentry in the web app and in all Edge Functions (dependency-free envelope client) with one shared
  scrubber for identifiers, personal numbers, e-mail and tokens; `health` endpoint (503 on failing jobs) checked by
  `uptime.yml` and an external monitor.
- **Deploys** only through `deploy.yml` (staging automatic, production with required reviewers).

**Consequences.** New environments follow `docs/runbooks/setup.md`. Cron schedules are in UTC.
