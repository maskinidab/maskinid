# Next steps

Handover from the session on 2026-09-27/28, where staging was created and the pipeline was wired up.
Day-to-day instructions live in **[docs/WORKFLOW.md](docs/WORKFLOW.md)** — this file is only what is
still open.

---

## Pick up here

### 1. Check whether PR #2 merged itself

https://github.com/maskinidab/maskinid/pull/2 — `staging` → `main`, with **auto-merge enabled**.

At the end of the session four of five checks were green (including Lighthouse); the e2e job was still
running. GitHub merges the PR by itself if e2e passes and leaves it open if it fails.

```bash
gh pr view 2 -R maskinidab/maskinid --json state,mergedAt
gh run list -R maskinidab/maskinid -b main -L 3
```

- **If it merged**: CI runs on `main`, then Deploy **pauses for your approval** ("Review deployments" on
  the run). Approving it applies migrations to production. Production schema and functions are already
  up to date, so this run should be a no-op that proves the pipeline end to end.
- **If it did not merge**: read the e2e failure before anything else, see the note below.

### 2. Decide what to do about `invite-user` ⚠️

`supabase/functions/invite-user/index.ts` is **untracked locally and deployed live on production**, but
exists in no commit and nothing in the app calls it. It was deployed by hand at some point before this
session. Production therefore runs 27 functions where staging runs 26.

This is exactly the drift the pipeline exists to prevent: a live production function that cannot be
reviewed, reproduced or rolled back. Two ways out:

- **Keep it** — commit the file, and the next deploy ships it to both environments (versioned, reviewable).
- **Drop it** — delete it from production and remove the local file:
  ```bash
  SUPABASE_ACCESS_TOKEN=… npx supabase functions delete invite-user --project-ref ogpqatvgamzgwwhgtlcr
  ```

Leaving it as-is is the one option worth avoiding.

### 3. Watch the e2e runtime on CI

The suite runs serially now (`workers: 1`), which locally completes **30/30 in 5 minutes**. On the last CI
run it was still going at ~25 minutes. Two possible reasons, worth confirming from the log:

- the runner is simply slower than this machine and 15–25 min is its normal serial time, or
- a test failed and burned time on its two retries.

If it is the second, that test is a real bug — retries only hide timing blips, and a test that fails all
three attempts has failed for a reason. The job budget is `timeout-minutes: 60`, so there is headroom
either way, but a 25-minute suite is slow enough to be worth splitting `dealer.spec.ts` (one test that
walks registration → import → labels → sale with financier → ownership certificate).

### 4. Finish the frontend performance work

You chose to keep the Lighthouse budget at **0.75** and fix the app rather than lower the bar. The
measurement is now trustworthy (3 samples per page, median), so optimisation can actually be verified.

What the numbers say: CPU is not the problem — total blocking time is 10–20 ms and layout shift is ~0.03.
The entire loss is **time to first paint**: FCP 3.2 s, LCP 4.0–5.0 s, caused by **~511 kB of JavaScript
ahead of the first render** (was 635 kB before the i18n fix).

Remaining ideas, largest first:

- **Route-level code splitting.** The public pages (`/`, `/security`, `/pricing`, `/stolen`, `/r/:reg`)
  should not download the signed-in app. Check what the entry chunk actually pulls in.
- **Keep the backend barrel off public pages.** `apps/web/src/lib/backend/index.ts` statically imports
  *both* `./local` (the in-browser PGlite backend) and `./supabase`, so a Supabase build still bundles the
  PGlite path. Making `createLocalBackend` a dynamic import would drop it from Supabase builds entirely —
  this needs async backend init, so it is not a one-liner.
- `Feedback.tsx` was already pointed at the leaf `errors` module rather than the barrel. It changed
  nothing measurable (tree-shaking had it covered) but stops the barrel creeping back in.

Measure with: `npm run build && npm run preview -w @maskinid/web -- --host 127.0.0.1 --port 4173` then
`npm run lighthouse -- --url http://127.0.0.1:4173` (add `--samples 1` for a quick, noisy read).

### 5. Smaller loose ends

- **`main` had no CI history before this.** The previous run on `main` (27 Sep) was red, and Deploy had
  never once succeeded. The first green production deploy will be the real proof.
- **Staging is behind Vercel SSO** (`all_except_custom_domains`). Fine while it is just you; turn it off
  in Vercel project settings if you need to show staging to someone without a Vercel account — worth
  doing before an investor demo.
- **Custom domains** are not set up on Vercel. `APP_ORIGIN`/`PUBLIC_APP_URL` in `.env` say
  `https://maskinid.se`, which does not point at Vercel yet.
- **`.env.prod-backup.local`** is the original `.env` from before it was pointed away from production.
  Delete it once you are happy.
- **Region mismatch**: staging is `eu-west-1` (Ireland), production `eu-north-1` (Stockholm). Harmless for
  staging, but it means staging latency is not representative.

---

## What changed in this session

### Backend

- **Created `maskinid-staging`** (`okgwcmgjdvtmbgjhvwwt`, eu-west-1, free plan). Supabase *branching* was
  not an option — it needs Pro — so staging is a separate project. Applied all 32 migrations, loaded the
  demo seed, deployed all 26 Edge Functions. Health green.
- **Rebuilt production.** It was still running the old 9-table prototype schema; the step 1–27 build had
  never been deployed because CI went red on 27 Sep and Deploy was skipped. Its migration history was also
  stamped with different versions than the repo's files, so `supabase db push` would have failed. Dropped
  `public`, replayed all 32 migrations, deployed all 26 functions. The `maskinidab@gmail.com` auth user was
  preserved (dropping `public` does not touch `auth.users`); the old org and profile rows are gone.
- Both projects now report identical structure: 92 tables, 59 enums, 519 database functions, 2 storage
  buckets. No ERROR-level security advisories.

### Pipeline

- `deploy.yml` maps branch → environment: green CI on `staging` deploys staging, green CI on `main`
  deploys production.
- GitHub `staging` environment created; **all four secrets set on both** environments. There were
  previously **no secrets at all**, so Deploy could never have worked even with green CI.
- `main` is protected: PR required, all five checks must pass, no force pushes. `production` requires
  your approval (self-review allowed, since you are the only maintainer).
- Repository variables point the Lighthouse job at **staging**, because production has no data and
  `/r/<reg>` would 404.

### Vercel

- Project `maskinid` created in the **Maskinid** team and linked to the repo; `main` is the production
  branch. 12 environment variables: **Production** → production Supabase, **Preview** (the `staging`
  branch and every PR preview) → staging Supabase.
- The Supabase→Vercel and Supabase→GitHub integrations are **deliberately not installed**. The first would
  flatten the production/preview split and point staging at production; the second competes with
  `deploy.yml` for the same database. Both were connected during the session and then disconnected.

### CI fixes

- **Lighthouse had never measured anything.** `npm run preview -- --port 4173` lost the flag through the
  workspace indirection, and `wait-on` polled `localhost`, which resolves to `::1` first on the runners
  while vite preview listens on IPv4.
- **e2e was over-parallelised, not flaky.** A different test failed on each run — `mandates`, then
  `dealer`, then `authority` — each failing all three attempts. Every test boots a full Postgres (WASM) in
  the browser and two at once thrash a two-core runner. Serial: 30/30 in 5 minutes locally, against
  17–23 minutes and a failure with two workers.
- **The Lighthouse budget was unmeasurable.** Identical code scored `/pricing` 82 then 62, and `/` 73, 81
  then 56 — swings wider than the 0.75 budget itself. Now sampled 3× per page and judged on the median,
  with individual samples printed.
- `demoDbVersion()` hashes migration paths with forward slashes so the demo database version matches on
  Windows and Linux.

### Frontend

- Only Swedish is bundled; English (~160 kB) is fetched on first use. `changeLanguage` is wrapped so no
  caller can switch to a dictionary that has not loaded. Critical path 635 → 511 kB.
- Supabase builds no longer ship `public/demo-db` (7.5 MB) to Vercel. Enforced on CI, warning only locally
  (Windows keeps the directory locked while OneDrive syncs).
- `npm run dev:staging` added.
- **`.env` was pointing local dev at production** (`VITE_DATA_SOURCE=supabase` + the prod URL), so
  `npm run dev` was talking to the live database. Now defaults to the in-browser demo DB, as
  `.env.example` always intended.

---

## Reference

| | |
|---|---|
| Production Supabase | `ogpqatvgamzgwwhgtlcr` · eu-north-1 · [dashboard](https://supabase.com/dashboard/project/ogpqatvgamzgwwhgtlcr) |
| Staging Supabase | `okgwcmgjdvtmbgjhvwwt` · eu-west-1 · [dashboard](https://supabase.com/dashboard/project/okgwcmgjdvtmbgjhvwwt) |
| Staging site | https://maskinid-git-staging-maskinid.vercel.app (Vercel SSO) |
| Vercel project | `maskinid`, team Maskinid |
| Actions | https://github.com/maskinidab/maskinid/actions |
| Demo logins | any seeded address, e.g. `berg@demo.se` / `demo1234` |

Both Supabase projects share the database password, held as `SUPABASE_DB_PASSWORD` in each GitHub
environment. `SUPABASE_DB_URL` must use the **pooler** host (runners are IPv4-only; `db.<ref>.supabase.co`
is IPv6-only) — staging `aws-1-eu-west-1`, production `aws-0-eu-north-1`, port 5432, with `!`
percent-encoded as `%21`.
