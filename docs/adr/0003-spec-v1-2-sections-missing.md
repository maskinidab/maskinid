# 0003 – SPEC v1.2 §20–§21 not available

**Context.** CLAUDE.md and the kickoff prompt refer to `docs/SPEC.md` v1.2 and to §20.1–§20.17 and §21 (tools, drivers,
daily checks, fuel/climate, powers of attorney, risk signals, groups, tips, public theft list, help centre, support,
legal documents, account security, payments, statistics, data export, push, sandbox, merge, public pages, operations,
e2e points 18–26). The SPEC file provided is v1.1 and ends at §19. The product owner decided (2026-09-26) that steps
20–27 are built from the descriptions in CLAUDE.md.

**Decision.** Each of steps 20–27 is implemented from the one-line description in CLAUDE.md, choosing the safest
reasonable interpretation, consistent with the rest of the SPEC (RLS, RPC-only writes, events, i18n, no amounts in the
register – prices for our own services are allowed and always shown excl. VAT with VAT separately). Every assumption is
listed in `docs/OPEN_QUESTIONS.md` so it can be checked against v1.2 when it is available.

**Consequences.** When v1.2 arrives, compare it against OPEN_QUESTIONS.md and adjust with new migrations.
