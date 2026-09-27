# 0020 – Billing: plans, usage metering, invoices, Stripe in test mode

**Context.** CLAUDE.md step 23: "Betalning: Stripe testläge, planer, användning, märkesbeställning, fakturor, `/pricing`,
priser exkl. moms med moms separat (SPEC §20.9)". §20.9 is missing (ADR 0003). SPEC §18 said "inga betalflöden i v1
(`FEATURE_PAYMENTS=false`)" and SPEC §1 says registration is free with revenue from checks, API and subscriptions.

**Decision.**
- **Registration is always free.** Billable: checks (`check_receipts`), API calls (`api_requests`, not 5xx/429),
  register extracts and label orders. Metering is done by triggers on those tables into `usage_records`, idempotent
  per source row, so no register RPC changed.
- **Plans** (free, dealer, lender, insurer, marketplace, enterprise/quote, and a non-public `public_sector` plan with
  all prices 0 for authorities, inspection bodies and the operator). A plan has a monthly fee, included quantities and
  per-unit overrides; the rest comes from the price list. Superadmins edit prices and plans; every change is audited.
- **Amounts** are integers in öre excluding VAT; VAT (25 %, `app_config`) is computed per invoice and shown on its own
  line everywhere (pricing page, usage estimate, invoice PDF, e-mail). Rule 5 ("inga belopp i registret") is about
  register data; billing amounts live only in billing tables and never in events, receipts or machine data.
- **Invoices** are created in arrears on the 1st (`close_billing_period`, idempotent per org and period) with fee +
  usage above what is included, 30 days' terms, a notification and an `invoice` e-mail. Invoice PDFs are rendered in
  the browser like our other documents (without the register verification footer).
- **Stripe** sits behind a `Payments` adapter (stripe|mock). Subscriptions use Stripe Checkout; usage invoices are
  pushed as invoice items (`billing-sync`); webhooks are signature-verified and applied idempotently
  (`billing_events`). Only `sk_test_` keys are accepted unless `STRIPE_ALLOW_LIVE=true`. `DEMO_MODE` ⇒ mock checkout
  that activates the plan at once and a "Betala (demo)" button.
- `FEATURE_PAYMENTS` stays **false** by default as SPEC §18 says: metering, pricing and invoices work, but card
  checkout is only offered when the flag is on or in DEMO_MODE; otherwise invoices are paid by bank transfer.

**Consequences.** No hard usage limits: exceeding the included quantity is billed, never blocks a check (blocking a
lender's check could enable double financing). Seller details on invoices (`BILLING_SELLER`) must be filled in
before real invoicing.
