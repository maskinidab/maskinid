# 0036 – Three environments: dev, demo and production

**Context.** The product owner wants to work in one place, demo in another, and keep production for real data:

| | Domain | Git branch | Supabase | Data |
|---|---|---|---|---|
| Dev | dev.maskinid.se | `dev` | the staging project (shared with demo) | demo data |
| Demo | demo.maskinid.se | `staging` | the staging project | demo data, testers invited to demo accounts |
| Production | app.maskinid.se + the site on maskinid.se | `main` | the production project | real data |

Work flows dev → staging → main. A third Supabase project for dev would cost money (two free projects per
organisation), so dev shares demo's backend; the product owner chose this knowingly. Vercel stays on the Hobby plan.

**Decision.**
- CI and Deploy run for `dev` too; a push to `dev` deploys migrations and Edge Functions to the staging project, as a
  push to `staging` does. Consequence: whatever is on `dev` is live in demo's backend at once. Migrations stay
  additive, and nothing is pushed to `dev` during a demo.
- Vercel, one app project: Production (`main`) on app.maskinid.se; `staging` and `dev` as branch domains
  demo.maskinid.se and dev.maskinid.se, built with the Preview variables (staging Supabase, no site/app split). The site
  project builds `main` only (`git.deploymentEnabled`), always against production. Everything used is on Hobby.
- Demo sends real e-mail – testers are invited to it – while keeping demo data and Demo-BankID in the database:
  `FUNCTIONS_DEMO_MODE=false` turns demo mode off for the functions only. Because the demo seed and the tests use
  made-up addresses on real domains (`berg@demo.se`), `email-send` never mails `demo.se`, `e2e.se`, `acme-test.se`,
  `example.*` or reserved TLDs, in any environment (`packages/shared/src/email/recipients.ts`).
- Reseeding demo is a workflow (`Reseed demo`, type `demo` to confirm), bound to the staging environment and refusing
  the production project, instead of a CLI login and hand-run SQL. It then runs Deploy, so the scheduler secret and the
  operator are set up again.
- MaskinID's operator account (maskinidab@gmail.com) exists separately in each environment: `OPERATOR_EMAIL` per GitHub
  environment, applied by every deploy once the person has signed up there. Sessions are per domain.

**Consequences.** One shared backend for dev and demo is the price of not paying for a third project; when it starts to
hurt (a migration that cannot be additive, a demo during heavy development), create `maskinid-dev`, add a `dev` GitHub
environment and point the `dev` branch at it – no code change. The setup steps are in `docs/runbooks/environments.md`.
