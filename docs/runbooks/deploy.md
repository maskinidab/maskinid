# Deploy

- **Never** run migrations against staging or production from a laptop. Everything goes through `.github/workflows/deploy.yml`.
- **Staging**: automatic after CI is green on `main`.
- **Production**: Actions → Deploy → Run workflow → `production`. A reviewer approves the environment. Deploy during
  office hours, not Fridays after 14:00.
- **Web app**: Vercel builds every PR (preview) and `main` (production). Merge the database change first; the web app
  must work with both the old and the new schema during the rollout (add columns, backfill, then use; never rename in
  one step).

## Before merging a migration
1. `npm run test:db` green locally and in CI (both jobs).
2. The migration never edits an earlier migration file (CLAUDE.md).
3. New tables have RLS and policies/grants; new functions are listed in `99_function_exposure` if anon/service-only.
4. Long-running changes (index on a big table): use `create index concurrently` in a separate migration.

## Rollback
- **Web**: Vercel → Deployments → promote the previous deployment.
- **Edge Functions**: re-run Deploy on the previous commit (workflow_dispatch from that ref).
- **Database**: write a new forward migration that reverts the change. Point-in-time restore is for data loss only
  (backup-restore.md), never to undo a schema change on a live system.
