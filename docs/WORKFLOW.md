# How to work on MaskinID

Everything about running the app locally, what staging and production are, how code and schema travel
between them, and what the pipeline does. If you read one thing, read **[The two golden rules](#the-two-golden-rules)**.

---

## The environments

| | Local | Staging | Production |
|---|---|---|---|
| Git branch | whatever you are on | `staging` | `main` |
| Frontend | `localhost:5173` | `maskinid-git-staging-maskinid.vercel.app` | Vercel production |
| Database | in-browser demo DB, **or** staging | Supabase `okgwcmgjdvtmbgjhvwwt` (eu-west-1) | Supabase `ogpqatvgamzgwwhgtlcr` (eu-north-1) |
| Data | demo seed | demo seed (real tables) | real data |
| Deploys | – | automatic on green CI | automatic on green CI, **after you approve** |

Staging and production have **identical schema**: 92 tables, 59 enums, 519 database functions,
2 storage buckets, 26 Edge Functions. Only the data differs.

---

## The two golden rules

### 1. Every schema change is a migration file. Never click it into the dashboard.

The pipeline copies schema from staging to production by replaying the SQL files in
`supabase/migrations/` with `supabase db push`. It does **not** compare databases.

Anything you create by clicking around in the Supabase dashboard exists only in that one project, is
invisible to git, and will **never** reach production. Staging and prod then drift apart silently.

This covers **all** of it — tables, columns, enums, RLS policies, database functions, triggers, indexes,
storage buckets, cron jobs. All of it is SQL in a migration file.

```bash
# create a migration
supabase migration new add_service_intervals
# edit supabase/migrations/<timestamp>_add_service_intervals.sql, then test locally:
npm run db:reset        # rebuilds the local DB from every migration + seed
npm run test:db         # RLS and RPC tests
```

Never edit a migration that is already committed — write a new one that changes it. A migration that has
run on production can't be rewritten, only followed up.

Edge Functions are the exception: they are plain files in `supabase/functions/<name>/index.ts`, and the
pipeline deploys **every** folder there automatically. Just commit them.

### 2. Schema flows forward. Data never syncs.

`staging → main` carries schema and functions. It never copies rows. Production's data is its own, and
staging's demo seed stays in staging. That separation is deliberate — don't try to bridge it.

---

## Working locally

### Pick your backend

Your **git branch and your backend are unrelated**. Being on the `staging` branch does not point the app
at staging — the `VITE_DATA_SOURCE` variable does.

```bash
npm run dev           # in-browser demo database (PGlite). No backend, no internet, instant reset.
npm run dev:staging   # local frontend → staging Supabase (real tables, demo data)
```

- **`npm run dev`** is the default and what you want most of the time. The whole register runs as
  Postgres compiled to WebAssembly inside the browser tab. Refresh with a clean context and you get a
  fresh copy of the demo data. Nothing you do can affect a real database.
- **`npm run dev:staging`** reads `.env.staging.local` and talks to the staging Supabase project over the
  network. Use it when you need real Edge Functions, real storage, real auth, or to reproduce something
  that only happens against a real backend.

**Pointing local dev at production is not set up, on purpose.** If you ever truly need it, edit `.env` by
hand and change it back immediately. `.env` originally shipped pointing at production, which meant
`npm run dev` was editing live data — it is now set to `local`. The old file is kept as
`.env.prod-backup.local`.

### Demo logins

Every seeded account uses the password `demo1234`. Examples: `berg@demo.se` (machine owner),
`nordmaskin@demo.se` (dealer). These exist in the in-browser demo DB *and* in staging.

### Resetting the local database

```bash
npm run db:reset      # drops, replays all migrations, reloads the demo seed
npm run db:types      # regenerate TypeScript types from the schema
```

---

## Running the checks locally

These are exactly what CI runs, so a green local run usually means a green pipeline.

```bash
npm run lint          # oxlint
npm run typecheck     # tsc across every package
npm test              # 115 unit tests (vitest)
npm run test:db       # RLS and RPC tests against a real Postgres
npm run check:functions   # deno type-check + tests for Edge Functions
npm run build         # production build
npm run test:e2e      # 30 Playwright tests, full product flows
npm run test:a11y     # accessibility subset only
npm run lighthouse    # performance/a11y/SEO budgets (needs a build + preview running)
```

**The e2e suite always uses the in-browser demo database**, whatever your `.env` says — the Playwright
config pins `VITE_DATA_SOURCE=local`. That is deliberate: the tests must be hermetic. It also means a
`.env` pointing at Supabase can't silently break the suite.

A full e2e run takes 15–30 minutes. To run one file while working:

```bash
npx playwright test --config e2e/playwright.config.ts e2e/mandates.spec.ts --project=desktop
```

Lighthouse locally needs a built app and a preview server:

```bash
npm run build && npm run preview -w @maskinid/web -- --host 127.0.0.1 --port 4173 &
npm run lighthouse -- --url http://127.0.0.1:4173
```

---

## The pipeline

### Push to `staging`

1. **CI** runs five jobs in parallel: lint/typecheck/unit/build, RLS+RPC tests twice (local Supabase and
   plain Postgres), the Playwright e2e suite, and the Lighthouse budgets.
2. If CI is green, **Deploy** runs against the `staging` environment: applies migrations
   (`supabase db push`), deploys all 26 Edge Functions, repoints scheduled jobs, and smoke-tests
   `/functions/v1/health`.
3. **Vercel** builds the branch independently and publishes it to
   `maskinid-git-staging-maskinid.vercel.app`, wired to staging Supabase.

Staging deploys need no approval. Break it freely — that's what it's for.

### Merging to `main`

`main` is protected. You **cannot** push to it directly.

1. Open a PR from `staging` → `main`. All five CI checks must pass; the branch must be up to date.
2. Merge. No approving review is required (you're the only maintainer), but green checks are.
3. CI runs again on `main`. When green, **Deploy pauses and waits for your approval** — GitHub will show
   "Review deployments" on the run. Approve it and production migrations + functions go out.
4. Vercel builds `main` to the production URL.

### Migrations must be backward compatible

Vercel and the database deploy run **in parallel**. The new frontend can go live a few seconds before the
new schema does. So never rename or drop in one step:

> add the new column → deploy → backfill → start using it → only much later remove the old one.

### Rollback

- **Frontend**: Vercel → Deployments → promote the previous one.
- **Edge Functions**: re-run Deploy from the previous commit (`workflow_dispatch`).
- **Database**: write a new forward migration that reverts it. Point-in-time restore is for data loss
  only, never to undo a schema change.

---

## Where the settings live

**GitHub environment secrets** (Settings → Environments), one set per environment:

| Secret | staging | production |
|---|---|---|
| `SUPABASE_PROJECT_REF` | `okgwcmgjdvtmbgjhvwwt` | `ogpqatvgamzgwwhgtlcr` |
| `SUPABASE_ACCESS_TOKEN` | ✓ | ✓ |
| `SUPABASE_DB_PASSWORD` | ✓ | ✓ |
| `SUPABASE_DB_URL` | pooler, port 5432 | pooler, port 5432 |

`SUPABASE_DB_URL` must use the **pooler** host (`aws-…pooler.supabase.com`), not `db.<ref>.supabase.co` —
GitHub runners are IPv4-only and the direct host is IPv6-only. Note staging is on `aws-1-eu-west-1` while
production is on `aws-0-eu-north-1`. Special characters in the password must be percent-encoded (`!` → `%21`).

**GitHub repository variables** feed the Lighthouse job and point at **staging**, because production has no
data and the machine-card page would 404: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`LIGHTHOUSE_REG`.

**Vercel environment variables** (project `maskinid`, team Maskinid):

- **Production** target → production Supabase
- **Preview** target → staging Supabase (covers the `staging` branch *and* every PR preview)

Each has `VITE_DATA_SOURCE=supabase`, `VITE_DEMO_MODE=false`, the Supabase URL and publishable key, plus
`SUPABASE_URL`/`SUPABASE_ANON_KEY` for the `api/pdf.ts` serverless function.

### Do not install the Supabase→Vercel or Supabase→GitHub integrations

Both are actively harmful here and are intentionally left off:

- **Supabase→Vercel** binds *one* Supabase project to *one* Vercel project and writes env vars into
  every target. It would overwrite the production/preview split above and point staging at production.
- **Supabase→GitHub** exists to drive Preview Branches (a Pro-plan feature this project doesn't have) and
  can apply migrations itself — competing with `deploy.yml` for the same database.

`deploy.yml` is the single path to both databases. Keep it that way.

---

## Gotchas worth knowing

- **Vercel does not wait for CI.** It deploys on push, independently of GitHub Actions. Branch protection
  on `main` is what stops a red commit reaching production — don't disable it.
- **Staging is behind Vercel SSO.** The URL redirects to a login unless you're signed in to Vercel. That's
  the team default; it can be turned off if you need to share the link.
- **The demo register is 7.5 MB** and lives in `public/demo-db`. A `postbuild` step removes it from
  Supabase builds so it isn't shipped to Vercel. It fails the build on CI if removal fails, and only warns
  locally (Windows keeps the directory locked while OneDrive syncs).
- **Only Swedish is bundled.** English (~160 kB) is fetched on first use. `i18n.changeLanguage` is wrapped
  so callers can't switch to a dictionary that hasn't loaded.
- **Never commit `.env`.** It's gitignored, along with anything matching `*.local`.

---

## Quick reference

```bash
npm run dev              # local + demo database
npm run dev:staging      # local + staging Supabase
npm run db:reset         # rebuild local DB from migrations + seed
npm run lint && npm run typecheck && npm test    # fast pre-push check
npm run test:e2e         # full Playwright suite (15–30 min)
supabase migration new <name>                    # start a schema change

gh run list -b staging                           # pipeline status
gh run watch <id>                                # follow a run
```

| Thing | Where |
|---|---|
| Staging Supabase | https://supabase.com/dashboard/project/okgwcmgjdvtmbgjhvwwt |
| Production Supabase | https://supabase.com/dashboard/project/ogpqatvgamzgwwhgtlcr |
| Staging site | https://maskinid-git-staging-maskinid.vercel.app |
| Actions | https://github.com/maskinidab/maskinid/actions |

See also `docs/runbooks/deploy.md` for the release checklist and `CLAUDE.md` for the project rules.
