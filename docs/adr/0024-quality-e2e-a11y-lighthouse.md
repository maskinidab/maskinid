# 0024 – Quality: end-to-end suite, accessibility, Lighthouse, view-as is read-only

**Context.** CLAUDE.md step 27: "Kvalitet: Lighthouse, a11y, e2e-svit SPEC §16 punkt 13–17 och §21.7 punkt 18–26,
README med uppstart på 10 minuter, `PROGRESS.md` markerad komplett". §21.7 is missing (ADR 0003), so points 18–26 are
interpreted from CLAUDE.md steps 20–26.

**Decision.**
- **E2E runs against the in-browser database.** Playwright drives the real web app with the local backend (PGlite with
  all migrations and the demo seed). Each test gets a fresh browser context and therefore a fresh register, so tests
  are independent and need no Supabase stack in CI. Tests assert on the UI and, through a dev-only hook
  (`window.__maskinidTest`, only when `import.meta.env.DEV`), on database rows: events, notifications, e-mail outbox.
  The hook is never in a production bundle.
- **Coverage.** §16.13 dealer (sign-up → approval → import 20 rows/18 machines → labels → sale with lender → buyer
  accepts → lender confirms → ownership certificate PDF), §16.14 owner (OCR wizard → invoice → level 1 → share link that
  expires), §16.15 lender (check receipt, second financing blocked with conflict notices), §16.16 theft (report →
  public card → scan notice → listing alert), §16.17 authority (partial search logged, hidden from owner by default).
  Interpreted points: 18 daily check (critical fault ⇒ out of service and back), 19 consignment, 20 stolen list and
  tips, 21 support, legal acceptance and "Visa som organisation", 22 billing (VAT shown, demo payment, invoice PDF, plan
  change), 23 public statistics without small cells and data export, 24 sandbox API key and API docs, 25 telematics,
  26 status page with jobs. Plus a mobile run (Pixel 7) and axe (WCAG 2.1 AA) on 15 public and 6 signed-in pages.
- **No retries.** A failing e2e test is a bug in the product or in the test; CI does not retry.
- **Lighthouse** is measured on the production build (Supabase data source), mobile emulation: accessibility ≥ 95,
  best practices ≥ 90, SEO ≥ 90 on indexable pages, performance ≥ 75. The browser demo build ships the register
  (~20 MB) and is measured without the performance budget. Machine cards are `noindex` on purpose and have no SEO budget.
- **View-as is strictly read-only.** The suite showed that an operator viewing an organisation could create support
  tickets in its name, because view-as grants the readonly role and a few RPCs let readonly members write.
  `require_actor` now marks the transaction when access comes only from a view-as session, and triggers on `events`
  (every register write logs one) and the support tables refuse writes with `VIEW_AS_READ_ONLY`. Reads and their
  access logging still work. An operator must end the view before answering a ticket from the operator queue.

**Bugs found and fixed by the suite.** Access log tab crashed on structured locations; the registration wizard lost
accepted OCR values in a draft race; OCR identifiers used a non-existent enum value; verification requests sent no
evidence documents; the browser telematics sync double-encoded its readings; tabs pointed `aria-controls` at panels
that were not rendered; the public layout shifted its footer while lazy pages loaded (landing page performance 59 → 85); the browser
backend waited for its database to boot before answering that there was no session.

**Consequences.** `npm run test:e2e` takes about 10 minutes on one worker. New flows get a spec in `e2e/`; selectors
use roles and Swedish labels, so a changed label fails the test and the i18n check together.
