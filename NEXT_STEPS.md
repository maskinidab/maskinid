# Next steps

Updated **2026-10-14 evening**, after the closed pilot, the admin area, the public site and the three environments
(ADR 0034–0036). Start a new session with: *"Läs CLAUDE.md, NEXT_STEPS.md och PROGRESS.md och fortsätt."*
Claude's own memory lives on the laptop only – everything a session on another computer needs is in this file,
`PROGRESS.md`, the ADRs and `docs/runbooks/go-live.md` + `docs/runbooks/environments.md`.

---

## Where things stand (2026-10-14, 18:45)

| | State |
|---|---|
| **Branches** | `dev` → `staging` → `main`. All three carry the same code (PR #7 and #8 merged to `main`). **Work on `dev`.** |
| **Production Supabase** `ogpqatvgamzgwwhgtlcr` | Migrations up to `20261014000006`. Scheduler on (pg_cron, pg_net, cron secret). **Still in demo mode** – pilot not switched on. Only user: maskinidab@gmail.com. |
| **Staging Supabase** `okgwcmgjdvtmbgjhvwwt` | Serves **both demo and dev**. Demo seed, scheduler on. Functions set to send real e-mail, but no `RESEND_API_KEY` yet, so mail is only logged. |
| **Website** (Vercel project `maskinid-site`) | ✅ Live on https://www.maskinid.se (`maskinid.se` redirects there). Builds from `main` only, always against production. |
| **App, prod** (Vercel project `maskinid`) | https://maskinid.vercel.app. Public pages redirect to maskinid.se. `app.maskinid.se` attached but DNS not working yet. |
| **Demo** | https://maskinid-demo.vercel.app (branch `staging`). `demo.maskinid.se` attached, DNS pending. |
| **Dev** | https://maskinid-dev.vercel.app (branch `dev`). `dev.maskinid.se` attached, DNS pending. |
| **DNS at Loopia** | `@` A `216.198.79.1` ✅, `www` CNAME ✅, Resend records ✅, e-mail (MX/SPF) untouched ✅. `app`/`demo`/`dev` CNAMEs added but **Loopia still serves the old `*` wildcard** (zone not republished since 17:55). |
| **Resend** | Domain `maskinid.se` added, DNS records visible. Verify in Resend, API key not created/stored yet. |
| **GitHub environments** | `staging`: all variables set (see `docs/runbooks/environments.md` §4). `production`: **no variables yet**. Secret `RESEND_API_KEY` missing in both. |
| **Vercel plan** | Hobby – deliberately, no Pro. Everything is set up to work on Hobby. |

---

## Setting up another computer (e.g. at home)

1. **Code**: `git clone https://github.com/maskinidab/maskinid.git` (or `git pull`), `git checkout dev`, `npm ci`.
2. **GitHub CLI**: `gh auth login` as **maskinidab**, then `gh auth refresh -h github.com -s workflow` (needed to
   push changes in `.github/workflows`). If git picks another GitHub account, push with
   `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`.
3. **Claude Code MCP servers** – add them in a terminal in the repo folder *before* starting `claude`, then run
   `/mcp` inside Claude Code to log in:
   ```
   claude mcp add --transport http supabase-maskinid-staging "https://mcp.supabase.com/mcp?project_ref=okgwcmgjdvtmbgjhvwwt"
   claude mcp add --transport http supabase-maskinid-prod "https://mcp.supabase.com/mcp?project_ref=ogpqatvgamzgwwhgtlcr&read_only=true"
   claude mcp add --transport http vercel https://mcp.vercel.com
   claude mcp add --transport http resend https://mcp.resend.com/mcp
   ```
   Log in to Supabase with the **maskinidab** account (not TradeMatch). Production is read-only on purpose: changes
   to production go through CI only.
4. **Vercel without MCP**: `npx vercel login` (device code), then e.g.
   `MSYS_NO_PATHCONV=1 npx vercel api /v9/projects/maskinid --scope maskinid` (the `MSYS_NO_PATHCONV` is for Git Bash).
5. **Database tests locally** need PostgreSQL 16 on port 54322 (`README.md`). Without Docker:
   `npm i embedded-postgres@16.14.0-beta.17` in a scratch folder, `initdb` + `pg_ctl start -o "-p 54322"`, then
   `TZ=UTC npm run test:db` (the import test `08_imports` fails on Windows only; it passes in CI).

---

## Pick up here – in this order

1. **Loopia DNS.** Check in the DNS editor that the `*` row (194.9.94.85/86) is really gone. Check from a terminal:
   `nslookup nonexistent123.maskinid.se ns1.loopia.se` must say *Non-existent domain*. When it does, `app`, `demo`
   and `dev` resolve to Vercel; press **Refresh** on them in Vercel and certificates are issued. If nothing happens
   within an hour, ask Loopia's support to republish the zone.
2. **Remove `maskind.se`** (typo, the domain does not exist) from Vercel → Domains if it is still listed.
3. **Resend**: Domains → `maskinid.se` → *Verify DNS Records*. Create an API key (*Sending access*, domain
   `maskinid.se`) and store it **yourself** as secret `RESEND_API_KEY` in GitHub → Settings → Environments →
   `staging` **and** `production`. Never paste it in a chat.
4. **Supabase Auth, both projects** (dashboard → Authentication), per `docs/runbooks/go-live.md` §3 and
   `docs/runbooks/environments.md` §5: *Confirm email* on, SMTP via Resend (`smtp.resend.com`, 465, user `resend`,
   password = the API key), Swedish templates. URL configuration with today's addresses:
   - production: Site URL `https://maskinid.vercel.app`, redirect `https://maskinid.vercel.app/**` (later `https://app.maskinid.se/**`);
   - staging: Site URL `https://maskinid-demo.vercel.app`, redirects `https://maskinid-demo.vercel.app/**`,
     `https://maskinid-dev.vercel.app/**`, `https://*-maskinid.vercel.app/**` (later demo./dev.maskinid.se).
5. **Switch production to the closed pilot**: set the GitHub `production` variables from `go-live.md` §2
   (`DEMO_MODE=false`, `MOCK_IDENTITY=true`, `REQUIRE_ORG_APPROVAL=true`, `OPERATOR_EMAIL=maskinidab@gmail.com`,
   the `*_PROVIDER=mock` set, `EMAIL_FROM`, `PUBLIC_APP_URL=https://maskinid.vercel.app` for now; **not**
   `APP_ORIGIN`). Then GitHub → Actions → Deploy → Run workflow → target `production` → approve. That run also
   makes maskinidab@gmail.com superadmin.
6. **First login as operator in production** (https://maskinid.vercel.app): Demo-BankID, then the app asks for
   two-factor (authenticator app) – required for the operator outside demo mode. Then **Admin** – the overview
   should say *Pilotläge*.
7. **Test the pilot end to end** (`go-live.md` §5): sign up with another e-mail → confirmation mail arrives from
   `noreply@maskinid.se` → apply → appears under Admin → Organisationer + mail to the operator → approve → the
   applicant gets mail and can use the app. Check Admin → E-postlogg and Admin → Jobb.
8. **Operator on demo too**: sign up maskinidab@gmail.com on https://maskinid-demo.vercel.app, then run Deploy with
   target `staging` (makes it superadmin there; dev shares the same accounts).
9. **Vercel Analytics**: Analytics tab → Enable, on both `maskinid` and `maskinid-site`.
10. **When `app.maskinid.se` works**: set `VITE_APP_URL=https://app.maskinid.se` in both Vercel projects
    (Production), GitHub `production` `PUBLIC_APP_URL=https://app.maskinid.se`, Supabase production URLs; redeploy.
    Same for demo/dev (`PUBLIC_APP_URL` in GitHub `staging`, Supabase staging URLs).

**Remember**
- Work on `dev`; promote `dev` → `staging` → `main` (PRs). `dev` shares demo's backend: don't push to `dev` during a demo.
- Reset demo: GitHub → Actions → **Reseed demo** → type `demo`. It refuses production.
- `npm run test:staging` walks rounds 8–13 on demo; round 12 needs an unused bank-financed machine
  (`R12_SERIAL`, reseed first).
- QR labels now carry `https://maskinid.se/m/…` (`VITE_SITE_URL`), so labels printed from production are final.

---

## Older notes (2026-10-10) – mostly done, kept for reference

### 0. Run Rikard's second round on staging ⚠️

Thirteen points, landed as ADR 0029–0033 and seven migrations (`20261013000001`–`20261013000007`). `docs/TESTGUIDE.md`
rounds **8–13** are the script; the e2e suite covers all of it against the in-browser database, but the in-browser
stub is more forgiving than real Supabase, so click through at least these:

1. **Finanssnurran** (`nordmaskin@demo.se` → Förbehåll → Lägg in finansiering manuellt → `Nordic Finance (demo)`):
   submitting with no agreement number must be refused, and 1 250 000 / 250 000 / 200 000 / 60 mån / 6,45 % must
   show **16 709 kr**. Then log in as `syd@demo.se` and confirm the **amounts are not visible** there.
2. **Lösenbeskedet** (runda 12): the dealer must be able to *open* it, and the bank must get **"Spärren släppt"**
   instead of a permission error.
3. **Inbytestest** (`nordmaskin@demo.se` → Inbytestest → `JCB3CX04278`), and that Daglig kontroll, Uthyrning,
   Bränsle & klimat and Förare are gone from that menu while `berg@demo.se` still has all four.
4. **Samtycket** (`lena@demo.se` searches `JCB3CX04278` → sees **Belånad**, no history → Begär full historik →
   `berg@demo.se` approves in the inbox with Demo-BankID → history appears, amounts still do not).
5. **Priserna**: logged out, no price link in the header, the footer or `/for/handlare`, and `/pricing` redirects.

The migrations need a reseed to show the new demo data (Nordic Finance, the machine with filled-in terms, the
rentals moved to Bergs Schakt) — `docs/TESTGUIDE.md` section 5 has the procedure.

**`staging-walkthrough.mjs` is stale.** It predates this round and clicks Daglig kontroll and Uthyrning in the
dealer view, which are no longer there. Either update it or run `npm run test:e2e` instead.

### 1. Try the financing round on staging, then take it to production

Push to `staging` deploys automatically on green CI. Click through this before the demo — the in-browser stub is
more forgiving than real Supabase, so green CI is not the same as "it works on staging":

1. `nordmaskin@demo.se` → **Inbyte** → try all three entries (scan the label, photograph the serial, type the
   serial) on the same machine.
2. That machine is bank-financed → **Begär inbyte** → log in as the lender → the case is in the **Inbox**, not
   just under the bell → answer with a payoff statement → back as Nordmaskin, the statement is there with its
   validity date and can be opened.
3. Upload proof of settlement as Nordmaskin → the lender approves → the block is released → the trade-in goes
   through.
4. **Sälj** → pick `DNB Finans (demo)` → the machine reads **"Belåning anmäld" immediately**, before the buyer
   does anything → `dnb@demo.se` sees it in the inbox and confirms → "Belånad". Repeat with Santander.
5. **Bifoga dokument** on the financing tab → upload a bank order → the fields fill in → pick `LF Finans (demo)`,
   which is **not** a customer → the financing is registered anyway. Then sign up a new account on LF Finans'
   organisation number (`516406-0120`) → the claim path appears → the machines are already there.
6. **Export** a machine with a destination country → scan its QR → the card lives and says "EXPORTERAD till …" →
   search the serial → found → re-import it.
7. As a plain company account (`berg@demo.se`): only **Bifoga dokument** on the financing tab, no manual form.

Then: one PR `staging` → `main`, all five checks green, merge, and approve the gated production deploy. It carries
the five new migrations and the new `ocr-financing-document` function.

### 2. Delete the orphan `invite-user` function from production ⚠️

`supabase/functions/invite-user/` was prototype-era code that existed in no commit but was **deployed by hand to
production**. Nothing in the app calls it (the real path is the `invite_member` / `accept_invite` RPCs), and it
references `organizationId`/`isAdmin`, which are not in today's schema. The local folder has been removed so it
cannot be deployed; a copy is kept in `supabase/.temp/removed/` if you want to look at it.

Production still runs it. Remove it so staging and production match:

```bash
SUPABASE_ACCESS_TOKEN=… npx supabase functions delete invite-user --project-ref ogpqatvgamzgwwhgtlcr
```

After that both projects should report **27** functions (26 plus the new `ocr-financing-document`).

### 3. Document reading needs two secrets, and production is still in demo mode ⚠️

"Bifoga dokument" reads bank orders and leasing agreements with Claude — but **only when the Edge Function is not
in demo mode**. `createAdapters` (`packages/shared/src/adapters/index.ts:28`) reads
`const demo = (env.DEMO_MODE ?? "true") !== "false"`, i.e. it **defaults to demo when the variable is unset**, and
line 43 then picks `mockOcr` regardless of whether an API key is present. So an API key on its own changes
nothing; you need both:

```bash
npx supabase secrets set ANTHROPIC_API_KEY=… DEMO_MODE=false --project-ref ogpqatvgamzgwwhgtlcr
```

The function accepts PDFs up to `RULES.maxUploadBytes` (25 MB) and sends them as Anthropic `document` blocks.

Worth knowing while you are there: `DEMO_MODE` is seeded as `'true'` into `public.app_config` by
`20260927000001_extensions.sql:185` — a **migration**, not the seed — so the *database* side of production is in
demo mode too. That means mock BankID, mock company lookup and `provider = 'mock'` signatures. That is harmless
for an empty pre-launch register, and it is what lets you demo against production if you ever want to, but it
must be turned off before anyone registers a real machine:

```sql
update public.app_config set value = to_jsonb(false) where key = 'DEMO_MODE';
```

This is pre-existing, not something the financing round changed.

### 4. Move Vercel off the Hobby plan ⚠️

Still open. Hobby is licensed for non-commercial use only — no company sites, no revenue-generating products.
MaskinID is commercial with investor demos planned, and Vercel does enforce this. Upgrade to Pro before showing
it outside the team. Pro also unlocks Password Protection, which is the right answer for the point below.

### 5. Re-close staging once the demos are done

Deployment protection is **off**, so staging (and the staging Supabase behind it) is reachable by anyone with the
link. The data is fictitious so the exposure is low, but it should not stay open indefinitely:

```bash
curl -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}' \
  "https://api.vercel.com/v9/projects/prj_h5GAQqDCcOCghPFW0J34RJ6MBHzT?teamId=team_SIw1DPrpj9dEM3C1gfCd7f8M"
```

Better once on Pro: password-protect it, so testers need a shared password but not a Vercel account.

### 6. Production is public and empty

`https://maskinid.vercel.app` serves to anyone and points at the empty production database. Fine for now, but
decide before launch whether it should be protected until there is real data and a custom domain.

### 7. Finish the frontend performance work

The Lighthouse budget stays at **0.75** and the measurement is trustworthy (3 samples per page, median). CPU is
not the problem — total blocking time is 10–20 ms, layout shift ~0.03. The whole loss is time to first paint, from
~511 kB of JavaScript ahead of the first render. Largest remaining levers:

- **Route-level code splitting** so the public pages (`/`, `/security`, `/pricing`, `/stolen`, `/r/:reg`) do not
  download the signed-in app.
- **Keep the backend barrel off public pages.** `apps/web/src/lib/backend/index.ts` statically imports both
  `./local` (the in-browser PGlite backend) and `./supabase`, so a Supabase build still bundles PGlite. Making
  `createLocalBackend` a dynamic import would drop it entirely — needs async backend init, so not a one-liner.

Measure: `npm run build && npm run preview -w @maskinid/web -- --host 127.0.0.1 --port 4173`, then
`npm run lighthouse -- --url http://127.0.0.1:4173`.

### 8. Smaller loose ends

- **`docs/BACKEND.md` is stale.** It still describes the prototype architecture, including the `invite-user`
  function and a 9-table schema. Either rewrite it against today's schema or delete it; `docs/WORKFLOW.md` and
  `docs/SPEC.md` are the live documents.
- **Custom domain** is not set up. `APP_ORIGIN`/`PUBLIC_APP_URL` in `.env` claim `https://maskinid.se`, which does
  not point at Vercel.
- **`.env.prod-backup.local`** is the original `.env` from before local dev was pointed away from production.
  Delete it once you are happy.
- **Region mismatch**: staging is `eu-west-1` (Ireland), production `eu-north-1` (Stockholm). Harmless, but
  staging latency is not representative.
- **Bank API integration.** The REST surface and webhooks now cover the whole payoff and financing flow
  (`POST /encumbrances/request`, `/payoffs*`, `payoff.*` webhook events), so a bank *can* automate it. Which bank
  does, and how, is a conversation to have with them — nothing bank-specific is built.

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
| Lender | `bank@demo.se`, `finans@demo.se` | Demo Bank Finans, Nordisk Maskinfinans |
| | `dnb@demo.se`, `santander@demo.se` | DNB Finans (demo), Santander Consumer (demo) |
| | `nordic@demo.se` | **Nordic Finance (demo)** `516401-3038` — the fifth lender, holds the machine with filled-in financing terms (`CAT0D606695`) |
| | *(no account)* | **LF Finans (demo)** `516406-0120` and **BNP Paribas Leasing (demo)** `516401-9845` exist only in the mock company register, so you can register financing against them and then claim the account |
| Insurer | `forsakring@demo.se` | Demo Försäkring |
| Authority | `polisen@demo.se`, `tull@demo.se` | Polisen, Tullverket |
| Operator | `admin@demo.se`, `verifier@demo.se` | MaskinID Sverige AB |
| Other | `kontroll@demo.se`, `marknad@demo.se`, `tillverkare@demo.se` | Inspection, Marketplace, Volvo CE |

Good demo path: sign in as `berg@demo.se`, grant a consignment to Nordmaskin AB, then sign in as
`nordmaskin@demo.se` to accept it and watch the machine appear in their stock. For the financing story, follow the
seven steps under point 1 above; for everything from Rikard's second round, `docs/TESTGUIDE.md` rounds 8–13.

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

Both Supabase projects share the database password, held as `SUPABASE_DB_PASSWORD` in each GitHub environment.
`SUPABASE_DB_URL` must use the **pooler** host (runners are IPv4-only; `db.<ref>.supabase.co` is IPv6-only) —
staging `aws-1-eu-west-1`, production `aws-0-eu-north-1`, port 5432, `!` percent-encoded as `%21`.
