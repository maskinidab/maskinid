# Architecture Decision Records

Short records of decisions where the specification was ambiguous, contradicted the existing code base, or where
the product owner decided otherwise. Format: context → decision → consequences. Newest last.

| # | Decision |
|---|---|
| [0001](0001-build-on-existing-codebase.md) | Build on the existing code base: npm workspaces, React 19, profile CSS instead of pnpm/React 18/Tailwind/shadcn |
| [0002](0002-maskinid-brand-over-spec-design.md) | MaskinID graphic profile and name override SPEC §10 |
| [0003](0003-spec-v1-2-sections-missing.md) | SPEC v1.2 §20–§21 not available – steps 20–27 interpreted from CLAUDE.md |
| [0004](0004-migration-naming.md) | Migration naming and order |
| [0005](0005-retire-prototype-schema.md) | Retire the prototype schema into `legacy`, migrate data, drop it |
| [0006](0006-event-hash-chain.md) | Event hash covers all columns; seq assigned under an advisory lock |
| [0007](0007-error-model.md) | Error model: stable codes, PostgREST status codes, conflicts returned (not raised) |
| [0008](0008-test-database.md) | Database tests on plain PostgreSQL with Supabase stubs, and on local Supabase in CI |
| [0009](0009-signatory-proof.md) | Signatory proof before an organisation is auto-approved or claimed |
| [0010](0010-signatures-api-and-registrant-access.md) | Signature rules incl. API keys; registering org sees a machine only during the first ownership period |
| [0011](0011-local-mode-pglite.md) | Local mode runs the real database in the browser (PGlite) |
| [0012](0012-import-parsing-and-batch-signature.md) | Import: parsing in the browser, one signature per batch |
| [0013](0013-api-gateway-over-rpc.md) | Public API as a thin gateway over the same RPCs |
| [0014](0014-market-ingest-structured-data.md) | Market ingest reads structured data only; privacy guard rails in worker and database |
| [0015](0015-operator-admin-and-audit.md) | Operator admin in the operator org; append-only operator audit |
| [0016](0016-demo-timeline-in-seed.md) | Demo seed spreads events over 30 days and anchors them |
| [0017](0017-fleet-operations.md) | Attachments, operators, daily checks and fuel as fleet data |
