# Setting up an environment

1. **Supabase project** in region `eu-north-1` (Stockholm). Plan with Point-in-Time Recovery (Pro + PITR add-on) for
   production. Enable extensions: `pg_cron`, `pg_net`, `pgcrypto` (Database → Extensions).
2. **GitHub environment** (`staging`, `production`) with secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`. Give `production` required reviewers.
3. **Vault secrets** (SQL editor, once per project; values from a password manager, never reused between environments):
   ```sql
   select vault.create_secret('<random 32 bytes hex>', 'org_number_key');
   select vault.create_secret('<random 32 bytes hex>', 'personal_number_salt');
   select vault.create_secret('<random 32 bytes hex>', 'ip_hash_salt');
   select vault.create_secret('<random 32 bytes hex>', 'integration_key');
   select vault.create_secret('<same as CRON_SECRET>', 'cron_secret');
   ```
   The migrations also create fallback values in `app.secrets`; Vault wins when both exist. Set Vault values **before**
   the first real data is written – `org_number_key` and `integration_key` encrypt data and cannot be changed later
   without re-encryption (see secrets.md).
4. **Edge Function secrets**: everything in the Edge Functions part of `.env.example` (`supabase secrets set --env-file`).
   `DEMO_MODE=false` in production.
5. **Deploy** with the Deploy workflow (it links the project, pushes migrations, deploys functions, sets
   `FUNCTIONS_BASE_URL` and schedules the jobs). Check Admin → Schemalagda jobb: all four scheduler checks must say yes.
6. **Feature flags** in `app_config` (Admin → Feature flags): `DEMO_MODE=false`; turn on integrations when agreements
   are in place.
7. **Vercel project** from the repository: framework Vite, root `apps/web` build via `npm run build`, output
   `apps/web/dist`; env `VITE_*` and, for `api/pdf.ts`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Domain `maskinid.se`.
8. **Monitoring**: Sentry projects (web + edge), uptime secrets `HEALTH_URL` and `APP_URL`, `SLACK_WEBHOOK_URL`.
9. **Backup drill**: create a read-only database role and put its URL in `BACKUP_DRILL_DB_URL` (production environment).
