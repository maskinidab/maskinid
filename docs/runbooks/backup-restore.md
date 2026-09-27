# Backup and restore

## What exists
- **Supabase daily backups** (7–30 days depending on plan) and **Point-in-Time Recovery** (production, retention 7 days).
- **Weekly drill** (`backup-drill.yml`): a logical dump of production is restored into a throw-away container and
  verified with `scripts/verify-restore.mjs` (migrations, whole event chain, RLS on every table, data present, latest
  anchor equals the published one). The dump is deleted on the runner; nothing is uploaded.
- **Event anchors**: each day's Merkle root is published outside the database (anchor-events), so a restored copy can
  be proven identical to what was published.

## Restore after data loss (PITR)
1. Declare an incident (incident.md). Stop writes if the loss is ongoing: Admin → Feature flags, or pause the app in
   Vercel with a maintenance page.
2. Find the last good point in time (Admin → Händelselogg, Supabase logs).
3. Supabase → Database → Backups → Point in time → restore **to a new project** (never over production first).
4. Verify the new project: `DATABASE_URL=<new> node scripts/verify-restore.mjs --reference-url <prod url> --anon-key <anon>`.
5. If the loss is limited, copy the missing rows back with SQL under four eyes; else switch the app to the restored
   project (update `VITE_SUPABASE_URL`/keys in Vercel, Edge Function secrets, `FUNCTIONS_BASE_URL`), then run
   `select app.schedule_jobs()`.
6. Events written after the restore point exist in no copy – list them from the anchors/logs and inform affected
   organisations.

## Monthly
Run `backup-drill.yml` manually after major migrations and record the result in the operations log.
