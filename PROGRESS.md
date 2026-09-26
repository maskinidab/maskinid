# PROGRESS – arbetslogg

Läs `CLAUDE.md` (inkl. "Projektbeslut"), denna fil och relevant §-avsnitt i `docs/SPEC.md` innan du fortsätter.
Status: ✅ klart · 🔄 pågår · ⬜ ej påbörjat

## Miljö i byggcontainern
- Docker-registret är inte nåbart ⇒ `supabase start` fungerar inte här. Lokal Postgres 16:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg/data -o '-p 54322 -k /tmp/pg' -l /tmp/pg/log start"`
  (initdb första gången: `initdb -D /tmp/pg/data -A trust -U postgres`). `npm run test:db` skapar databasen `maskinid`.

## Steg
| # | Steg | Status | Anteckning |
|---|---|---|---|
| 1 | Grund: monorepo, CI, lokal DB, 0001–0002, shared (regnr, APP_NAME, flaggor) | ✅ | npm workspaces (ADR 0001); events/hashkedja skapad redan här (ADR 0004) |
| 2 | Organisationer & användare | ⬜ | |
| 3 | Maskiner, identifierare, märken | ⬜ | |
| 4 | Events & audit (verify_chain, anchor-events) | ⬜ | tabell + kedja + ankare klara i steg 1; kvar: Edge Function + integration |
| 5 | Förbehåll, ägarbyten, flaggor | ⬜ | |
| 6 | Dokument, åtkomstlogg, delningslänkar | ⬜ | |
| 7 | Verifiering & konflikter | ⬜ | |
| 8 | Frontend – skal | ⬜ | |
| 9 | Frontend – publikt | ⬜ | |
| 10 | Frontend – kärnflöden | ⬜ | |
| 11 | Import | ⬜ | |
| 12 | Flotta | ⬜ | |
| 13 | Handlare | ⬜ | |
| 14 | Roller/portaler | ⬜ | |
| 15 | API & webhooks | ⬜ | |
| 16 | Marknadsbevakning | ⬜ | |
| 17 | Operatörsadmin | ⬜ | |
| 18 | PDF:er & e-post | ⬜ | |
| 19 | Seed & demo | ⬜ | |
| 20 | Redskap, förare, daglig kontroll, bränsle/klimat | ⬜ | tolkas från CLAUDE.md (ADR 0003) |
| 21 | Fullmakter, kommission, risksignaler, koncern | ⬜ | tolkas från CLAUDE.md |
| 22 | Tips, stöldlista, hjälpcenter, support, juridik, kontosäkerhet, "Visa som" | ⬜ | tolkas från CLAUDE.md |
| 23 | Betalning (Stripe testläge) | ⬜ | tolkas från CLAUDE.md |
| 24 | Statistik, dataexport, push, sandbox, partial search, merge | ⬜ | tolkas från CLAUDE.md |
| 25 | Integrationsadaptrar (NFC, telematik, TS, Larmtjänst), publika sidor | ⬜ | |
| 26 | Drift | ⬜ | |
| 27 | Kvalitet | ⬜ | |

## Logg
- **Steg 1** – Repo omstrukturerat till `apps/web`, `apps/ingest`, `packages/shared`. Specdokumenten ligger i `docs/`.
  `packages/shared`: `APP_NAME`, feature flags, regler, regnr (Luhn mod 32, blandade grupper), identifierare, orgnr.
  Migrationer: prototypen flyttad till `legacy` (ADR 0005), extensions/app-schema/app_config, alla enums, events med
  hashkedja + append-only + Merkle-ankare. Testrigg: `npm run test:db` (10 tester), `npm test` (enhetstester).
