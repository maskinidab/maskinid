# Next steps

Handover from the session on 2026-09-27/28, where staging was created, the pipeline was wired up and the
first release went out. Day-to-day instructions live in **[docs/WORKFLOW.md](docs/WORKFLOW.md)** — this
file is only what is still open.

---

## Where things stand

| | State |
|---|---|
| Production Supabase | ✅ 92 tables, 26 Edge Functions, health green, **no data** |
| Staging Supabase | ✅ same schema, demo seed, 26 functions, logins working |
| `main` | ✅ PR #2 merged (`750aed6`) |
| Vercel production | ✅ https://maskinid.vercel.app — **public**, serves the empty production register |
| Vercel staging | ✅ https://maskinid-git-staging-maskinid.vercel.app — **public since tonight**, demo data |
| Pipeline | ✅ CI on both branches, `main` protected, production deploy needs approval |

---

## Pick up here

### 1. Approve the production deploy — it is waiting right now

CI on `main` passed in full, **including e2e**, so the merge that bypassed the check turned out fine. The
production Deploy is **paused on your approval**: run `36360758403`, status `waiting` since 00:03 UTC.

https://github.com/maskinidab/maskinid/actions/runs/36360758403 → "Review deployments" → approve.

It applies migrations that are already applied, so it should be a clean no-op — which is the point: the
first end-to-end proof of the pipeline on a run where a mistake costs nothing. The branch → environment
mapping is confirmed working (CI on `staging` deployed staging automatically; CI on `main` is gated).

One CI defect was found and fixed while checking this: `supabase/setup-cli@v1` with `version: latest`
resolves the release over the unauthenticated GitHub API and failed one staging deploy with "rate limit
exceeded". Both workflows now pin `2.118.0`. **That fix is on `staging` and still needs merging to `main`.**

### 2. Decide what to do about `invite-user` ⚠️

`supabase/functions/invite-user/index.ts` is **untracked locally and deployed live on production**, but
exists in no commit and nothing in the app calls it. It was deployed by hand before this session.
Production runs 27 functions where staging runs 26.

This is exactly the drift the pipeline exists to prevent: a live production function nobody can review,
reproduce or roll back. Either:

- **Keep it** — commit the file so it is versioned and deploys to both environments, or
- **Drop it**:
  ```bash
  SUPABASE_ACCESS_TOKEN=… npx supabase functions delete invite-user --project-ref ogpqatvgamzgwwhgtlcr
  ```

### 3. Move Vercel off the Hobby plan ⚠️

The team is on **Hobby**, which Vercel licenses for non-commercial use only — no company sites, no
revenue-generating products. MaskinID is commercial with investor demos planned. Vercel does enforce this
and can suspend the project. Upgrade to Pro before showing it to anyone outside the team.

Pro also unlocks **Password Protection**, which is the right answer for the point below.

### 4. Re-close staging once the demo is done

Deployment protection was **turned off** tonight so people could test without a Vercel account. Staging is
now reachable by anyone with the link — including the staging Supabase behind it. The data is entirely
fictitious, so the exposure is low, but it should not stay open indefinitely.

Put it back with:

```bash
curl -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}' \
  "https://api.vercel.com/v9/projects/prj_h5GAQqDCcOCghPFW0J34RJ6MBHzT?teamId=team_SIw1DPrpj9dEM3C1gfCd7f8M"
```

Better once on Pro: password-protect it instead, so testers need a shared password but not a Vercel account.

### 5. Production is public and empty

`https://maskinid.vercel.app` serves to anyone and points at the empty production database. Anyone who
finds it sees a working app with nothing in it. Fine for now, but decide before launch whether it should
be protected until there is real data and a custom domain.

### 6. e2e runtime — resolved, but keep an eye on it

Resolved: CI on `main` finished the whole run in **5m42s including e2e**, matching the 5 minutes the
serial suite takes locally. The 17–25 minute runs earlier were the two-worker config thrashing, not a slow
runner. Nothing to do unless it creeps back up.

If it ever does, `dealer.spec.ts` is the one to split — a single test covering registration → import →
labels → sale with financier → ownership certificate, and the one that used to hit the timeout.

### 7. Finish the frontend performance work

The Lighthouse budget stays at **0.75** and the measurement is now trustworthy (3 samples per page,
median), so optimisation can finally be verified.

CPU is not the problem — total blocking time is 10–20 ms, layout shift ~0.03. The whole loss is
**time to first paint**: FCP 3.2 s, LCP 4.0–5.0 s, from **~511 kB of JavaScript ahead of the first render**
(635 kB before the i18n fix). Largest remaining levers:

- **Route-level code splitting** so the public pages (`/`, `/security`, `/pricing`, `/stolen`, `/r/:reg`)
  do not download the signed-in app.
- **Keep the backend barrel off public pages.** `apps/web/src/lib/backend/index.ts` statically imports both
  `./local` (the in-browser PGlite backend) and `./supabase`, so a Supabase build still bundles PGlite.
  Making `createLocalBackend` a dynamic import would drop it entirely — needs async backend init, so not a
  one-liner.

Measure: `npm run build && npm run preview -w @maskinid/web -- --host 127.0.0.1 --port 4173`, then
`npm run lighthouse -- --url http://127.0.0.1:4173` (`--samples 1` for a quick, noisy read).

### 8. Smaller loose ends

- **Custom domain** is not set up. `APP_ORIGIN`/`PUBLIC_APP_URL` in `.env` claim `https://maskinid.se`,
  which does not point at Vercel.
- **`.env.prod-backup.local`** is the original `.env` from before local dev was pointed away from
  production. Delete it once you are happy.
- **Region mismatch**: staging is `eu-west-1` (Ireland), production `eu-north-1` (Stockholm). Harmless,
  but staging latency is not representative.
- **Demo accounts table** below is not in `docs/WORKFLOW.md` yet — worth moving there.

---

## Demo accounts (staging and the local demo database)

**Password for every account: `demo1234`.** Signing uses Demo-BankID — just click "Signera".

| Role | Account | Org |
|---|---|---|
| Machine owner | `berg@demo.se` | Bergs Schakt & Entreprenad (admin) |
| | `platschef@berg.demo.se` | same org (member) |
| | `lena@demo.se`, `kommun@demo.se` | Lena Grävmaskin, Kommunfastigheter Väst |
| Dealer | `nordmaskin@demo.se` | Nordmaskin AB (admin) |
| | `saljare@nordmaskin.demo.se` | same org (member) |
| | `verkstad@nordmaskin.demo.se` | same org (**readonly**) |
| | `syd@demo.se`, `norr@demo.se` | Entreprenadcenter Syd, Skogsmaskiner Norr |
| Financier | `bank@demo.se`, `finans@demo.se` | Demo Bank Finans, Nordisk Maskinfinans |
| Insurer | `forsakring@demo.se` | Demo Försäkring |
| Authority | `polisen@demo.se`, `tull@demo.se` | Polisen, Tullverket |
| Operator | `admin@demo.se`, `verifier@demo.se` | MaskinID Sverige AB |
| Other | `kontroll@demo.se`, `marknad@demo.se`, `tillverkare@demo.se` | Inspection, Marketplace, Volvo CE |

Good demo path: sign in as `berg@demo.se`, grant a consignment to Nordmaskin AB, then sign in as
`nordmaskin@demo.se` to accept it and watch the machine appear in their stock. The three Nordmaskin
accounts (admin / member / readonly) are useful for showing that permissions differ.

---

## What changed in this session

### Backend

- **Created `maskinid-staging`** (`okgwcmgjdvtmbgjhvwwt`, eu-west-1). Supabase *branching* needs Pro, so
  staging is a separate project. All 32 migrations, the demo seed, and all 26 Edge Functions.
- **Rebuilt production.** It was still running the old 9-table prototype schema — the step 1–27 build had
  never deployed, because CI went red on 27 Sep and Deploy was skipped. Its migration history was also
  stamped with different versions than the repo's files, so `supabase db push` would have failed. Dropped
  `public`, replayed all 32 migrations, deployed all 26 functions. The `maskinidab@gmail.com` auth user
  survived (dropping `public` does not touch `auth.users`); the old org and profile rows did not.
- Both projects now report identical structure: 92 tables, 59 enums, 519 database functions, 2 storage
  buckets. No ERROR-level security advisories.

### The login bug (fixed)

Every demo account failed on staging with a 500, *"Database error querying schema"* — not a wrong
password. The seed inserts into `auth.users` without `created_at`, `updated_at` or the token columns, and
on a real Supabase project those have **no defaults**, so all 19 users had NULL. GoTrue scans
`created_at`/`updated_at` into a non-nullable `time.Time` and the token columns into non-nullable strings,
so the row never decodes and login fails before the password is checked.

It never appeared locally because the stub `auth.users` in `supabase/tests/stubs/supabase-stubs.sql`
defaults all six, so the browser demo database and the e2e suite were always fine. Staging rows were
repaired in place and the seed is fixed. **Worth remembering: the in-browser stub is more forgiving than
real Supabase — click through staging before a demo, do not just trust green CI.**

### Pipeline

- `deploy.yml` maps branch → environment: green CI on `staging` deploys staging, green CI on `main`
  deploys production.
- GitHub `staging` environment created; all four secrets on **both** environments. There were previously
  **no secrets at all**, so Deploy could never have worked even on a green build.
- `main` protected: PR required, all five checks, no force pushes. `production` requires your approval.
- Repository variables point the Lighthouse job at **staging**, since production has no data and
  `/r/<reg>` would 404.

### Vercel

- Project `maskinid` created in the **Maskinid** team, linked to the repo, `main` as production branch.
  12 environment variables: **Production** → production Supabase, **Preview** (the `staging` branch and
  every PR preview) → staging Supabase.
- The Supabase→Vercel and Supabase→GitHub integrations are **deliberately not installed**. The first would
  flatten the production/preview split and point staging at production; the second competes with
  `deploy.yml` for the same database.

### CI fixes

- **Lighthouse had never measured anything.** `npm run preview -- --port 4173` lost the flag through the
  workspace indirection, and `wait-on` polled `localhost`, which resolves to `::1` first on the runners
  while vite preview listens on IPv4.
- **e2e was over-parallelised, not flaky.** A different test failed each run — `mandates`, then `dealer`,
  then `authority` — each failing all three attempts. Every test boots a full Postgres (WASM) in the
  browser, and two at once thrash a two-core runner. Serial: 30/30 in 5 min, against 17–23 min and a
  failure.
- **The Lighthouse budget was unmeasurable.** Identical code scored `/pricing` 82 then 62, and `/` 73, 81
  then 56 — swings wider than the 0.75 budget. Now sampled 3× per page and judged on the median.
- `demoDbVersion()` hashes migration paths with forward slashes so the version matches on Windows and Linux.

### Frontend

- Only Swedish is bundled; English (~160 kB) is fetched on first use. Critical path 635 → 511 kB.
- Supabase builds no longer ship `public/demo-db` (7.5 MB) to Vercel.
- `npm run dev:staging` added.
- **`.env` was pointing local dev at production** (`VITE_DATA_SOURCE=supabase` + the prod URL), so
  `npm run dev` was talking to the live database. Now defaults to the in-browser demo DB.

---

## Reference

| | |
|---|---|
| Production Supabase | `ogpqatvgamzgwwhgtlcr` · eu-north-1 · [dashboard](https://supabase.com/dashboard/project/ogpqatvgamzgwwhgtlcr) |
| Staging Supabase | `okgwcmgjdvtmbgjhvwwt` · eu-west-1 · [dashboard](https://supabase.com/dashboard/project/okgwcmgjdvtmbgjhvwwt) |
| Production site | https://maskinid.vercel.app |
| Staging site | https://maskinid-git-staging-maskinid.vercel.app |
| Vercel project | `maskinid` (`prj_h5GAQqDCcOCghPFW0J34RJ6MBHzT`), team Maskinid (`team_SIw1DPrpj9dEM3C1gfCd7f8M`) |
| Actions | https://github.com/maskinidab/maskinid/actions |

Both Supabase projects share the database password, held as `SUPABASE_DB_PASSWORD` in each GitHub
environment. `SUPABASE_DB_URL` must use the **pooler** host (runners are IPv4-only; `db.<ref>.supabase.co`
is IPv6-only) — staging `aws-1-eu-west-1`, production `aws-0-eu-north-1`, port 5432, `!` percent-encoded
as `%21`.
