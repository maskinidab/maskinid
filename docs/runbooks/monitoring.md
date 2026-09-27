# Monitoring

| Signal | Where | Alert |
|---|---|---|
| Web errors | Sentry (web project), PII scrubbed in `beforeSend` | Sentry issue alert → e-mail/Slack |
| Edge Function errors | Sentry (edge project) via `_shared/sentry.ts` | same |
| Uptime | `functions/v1/health` (200 = ok, 503 = failing jobs or no DB) and the web app | `uptime.yml` every 10 min + external monitor |
| Scheduled jobs | Admin → Schemalagda jobb; `jobs.consecutive_failures` | 3 failures in a row ⇒ notification `job.failing` to superadmins |
| Event chain | job `verify-chain` nightly | break ⇒ `chain.broken` (critical) – see incident.md |
| E-mail / webhooks backlog | `health_check()` fields `email_backlog`, `webhook_backlog` | uptime check fails when jobs fail |
| Public status | `/status` | – |

## When a job fails
1. Admin → Schemalagda jobb shows the last error and the last five runs.
2. HTTP jobs: check the function logs in Supabase (Edge Functions → Logs) and Sentry.
3. Fix, then "Kör nu" (superadmin). A success resets the failure counter.
4. A paused job stays paused across deploys until resumed.

## Targets
Availability 99.9 % per month (SPEC §11.5). Checks and public scans p95 < 500 ms.
