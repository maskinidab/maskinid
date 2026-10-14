# 0034 – The closed pilot: real accounts and e-mail, Demo-BankID, every organisation approved by hand

**Context.** The product owner wants production open for real sign-ups and real e-mail now, before there is a BankID
broker agreement. Every account type (owner/entreprenör, dealer, lender, insurer, authority, …) must be able to apply,
confirm its e-mail, and then wait until MaskinID (maskinidab@gmail.com) has approved it. Production ran in demo mode,
which turned out to be one switch for three unrelated things:

1. mock identity and signatures – `verify_identity`, `complete_mock_signature` and `consume_signature` refuse mock
   outside demo, so turning demo off made every sign-up impossible;
2. demo shortcuts – the mock company register, everyone a signatory, auto-approval of owner-only organisations;
3. the yellow DEMO banner.

The investigation also found that **no scheduled job had ever run in any environment** (no pg_cron, no pg_net, no
`cron_secret`, and `email-send` rejected the scheduler's call at the gateway), so no e-mail was ever sent; that a
*pending* organisation could already act as an owner; and that nobody could become the first operator outside the seed.

**Decision.**
- Two new flags in `app_config`, both off by default so staging, tests and the demo behave as before:
  `MOCK_IDENTITY` (Demo-BankID allowed without demo mode) and `REQUIRE_ORG_APPROVAL` (every new organisation is
  `pending` and can do nothing until approved). Production runs `DEMO_MODE=false` with both on. With mock identity
  nobody is verified by BankID, so the operator's review is the safeguard; the two are meant to be used together.
- A pending organisation is excluded from `app.current_org_ids()` and refused by `app.require_actor`
  (`ORG_NOT_APPROVED`, status `pending`), so it reads and writes nothing. `my_context` still lists it, and the app shows
  a waiting screen instead of the app.
- No auto-approval while approval is required. Claiming a load-bearing placeholder goes to review instead of needing a
  signatory, and the claimant sees none of its data until approved.
- Without a company-lookup provider, `lookup_company` answers `manual: true` and the applicant types the name; the
  organisation is stored with `lookup_source = 'manual'` and the admin page tells the operator to check it.
- `reject_org` turns down an application: stored as `suspended` (every existing check treats that as closed) plus
  `rejected_at` and the reason, which the applicant's screen shows. The operator can still approve later.
- E-mail: the operators on a new application, the applicant on received, approved and rejected (warning severity,
  so `notify_user` sends it under default preferences).
- Two-factor: outside demo mode an approved lender, authority or operator needs an `aal2` session. The app now shows a
  set-up screen (the existing `MfaSection`) instead of failing every request with `MFA_REQUIRED`.
- `app.bootstrap_operator(email)` makes a signed-up user the superadmin of the operator organisation (creating it in an
  empty database). Service role only; called by the deploy pipeline from the environment variable `OPERATOR_EMAIL`.
- The scheduler: migration `20261014000005` enables pg_cron and pg_net where offered, `app.ensure_cron_secret()` creates
  the secret once, and the deploy pipeline copies it to the functions' `CRON_SECRET` so no person handles it.
- Per-environment settings live in the GitHub environment, not in migrations: variables `DEMO_MODE`, `MOCK_IDENTITY`,
  `REQUIRE_ORG_APPROVAL`, `OPERATOR_EMAIL`, the `*_PROVIDER` choices, `EMAIL_FROM`, `PUBLIC_APP_URL`, `APP_ORIGIN`;
  secrets `RESEND_API_KEY`, `ANTHROPIC_API_KEY`. The deploy applies only what is set.
- The admin area gets what the pilot needs: Konton (every user, e-mail confirmed, identity, two-factor, organisations),
  Långivare (every lender incl. not-yet-connected banks, with financings and open payoffs), E-postlogg, Revisionslogg,
  and the overview shows the mode the register runs in. Looking at a person is audited.

**Consequences.** Production can take real applicants without BankID, at the cost of manual review of each one.
When a broker agreement exists, setting `MOCK_IDENTITY=false` and `IDENTITY_PROVIDER=bankid` switches identity to
BankID without code changes; `REQUIRE_ORG_APPROVAL` can stay on as long as MaskinID wants to vet every customer.
Supabase's own sign-up and login e-mails are not covered by Resend through this code: production needs custom SMTP and
e-mail confirmation turned on in the Supabase Auth settings (`docs/runbooks/go-live.md`).
