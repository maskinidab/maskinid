# CLAUDE.md — regler för Claude Code i detta repo

Du bygger **Maskinpass** (arbetsnamn), ett register för tunga arbetsmaskiner. `docs/SPEC.md` (v1.2) är sanningskällan. Läs den helt innan du skriver kod. **Hela scopet byggs i ett sammanhängande bygge: ingen MVP, ingen fas 1, inget "kan byggas senare".** Ordningen nedan är en arbetsordning (säkerhetsgrunden först), inte en leveransplan. Fråga inte om saker som specen redan svarar på; anta defaults i SPEC §18 och skriv en ADR när du väljer.

**Uthållighet:** kontexten komprimeras i långa sessioner och tidiga instruktioner kan försvinna. Därför: (1) `PROGRESS.md` i repo-roten är din arbetslogg – uppdatera den efter varje avslutat steg med vad som är klart, vad som pågår och nästa steg; (2) efter komprimering eller ny session: läs `CLAUDE.md`, `PROGRESS.md` och relevant §-avsnitt i SPEC innan du fortsätter; (3) avsluta aldrig ett steg med en fråga till användaren om du kan gå vidare – gå vidare.

## Hårda regler (bryts aldrig)
1. **RLS på varje tabell, default deny.** En ny tabell utan `enable row level security` + policies får inte committas.
2. **Klienten skriver aldrig direkt i registertabeller.** All skrivning via Postgres RPC (`security definer`, `set search_path = public`, auktorisation kontrollerad inuti med `auth.uid()`). `revoke all on function ... from public; grant execute ... to authenticated;`
3. **`events` är append-only och hashkedjad.** Triggers som förbjuder UPDATE/DELETE. Varje RPC som ändrar registerdata skriver minst ett event i samma transaktion.
4. **Ett aktivt finansieringsförbehåll per maskin.** Partiellt unikt index + explicit kontroll i RPC med konfliktrad, notiser och webhook. Aldrig tyst överskrivning.
5. **Inga belopp i registret.** Inga fält för köpeskilling, lånebelopp eller restskuld.
6. **Personnummer lagras aldrig i klartext.** Enskild firmas orgnr krypteras (pgcrypto) och maskeras i UI. BankID-personnummer endast som hash.
7. **Inga hårdkodade UI-strängar.** Allt via i18n (sv + en).
8. **Varje RLS-policy och varje RPC har ett test** i `supabase/tests` som körs i CI mot lokal Supabase med en testanvändare per roll (anon, owner_a, owner_b, dealer, financier_a, financier_b, insurer, authority, inspector, operator).
9. **Produkten kallas aldrig** "Svenska Maskinregistret", "nationella registret" eller "officiella registret". `APP_NAME` är en konstant i `packages/shared/src/config.ts`.
10. **Externa tjänster bakom adaptrar** med mock-implementation: `IdentityProvider` (bankid|mock), `SignatureProvider` (bankid|mock), `CompanyLookup` (roaring|mock), `VehicleRegistryLookup` (transportstyrelsen|mock), `TheftRegistrySync` (larmtjanst|mock), `Ocr` (anthropic|mock), `Email` (resend|console). `DEMO_MODE=true` ⇒ mock överallt och synlig "DEMO"-banner.

## Stack (ändra inte)
pnpm-monorepo · Vite + React 18 + TS · Tailwind + shadcn/ui · React Router · TanStack Query · react-hook-form + zod · i18next · vite-plugin-pwa · Supabase (Postgres, Auth, Storage, Edge Functions/Deno, pg_cron) · Playwright (e2e) · Vitest · GitHub Actions · Sentry.
Repo-layout enligt SPEC §14. Supabase-typer genereras till `packages/shared/src/database.types.ts` efter varje migration (`supabase gen types`).

## Arbetsordning inom ett enda bygge (ett steg är klart när dess tester är gröna, sedan direkt vidare)
1. **Grund:** monorepo, lint/typecheck/CI, lokal Supabase, migrationer 0001–0002 (extensions, enums), `packages/shared` med regnr-generator/validator (+ tester), `APP_NAME`, feature flags.
2. **Organisationer & användare:** migrationer 0003, RLS, RPC: `create_org`, `invite_member`, `accept_invite`, `verify_identity` (mock). Tester per roll.
3. **Maskiner, identifierare, märken:** 0004, unikhetsindex, RPC `register_machine`, `bind_label`, `public_machine_card`, `lookup_machine`. Konflikthantering vid duplikat. Tekniska fält enligt SPEC §4.2 (vikt, effekt, bränsle, utsläppssteg, lyftanordning, tillfällig registrering). `oem_records` + uppslag vid registrering. `VehicleRegistryLookup`-adapter (mock) för vägtrafikregnr. Tester.
4. **Events & audit:** 0006, triggers, hashkedja, `verify_chain()`-funktion, `anchor-events` Edge Function. Tester inkl. manipulationsdetektion.
5. **Förbehåll, ägarbyten, flaggor:** 0005, RPC `register_encumbrance`, `confirm_encumbrance`, `release_encumbrance`, `transfer_encumbrance_holder`, `initiate_transfer` (med 10-dagarsregeln för `effective_date`), `approve_transfer_financier`, `accept_transfer`, `cancel_transfer`, `raise_flag`, `clear_flag`, `deregister_machine`, `perform_check` (kvitto). Signaturkrav via `SignatureProvider`. Alla säkerhetstester i SPEC §16 punkt 1–10.
6. **Dokument, åtkomstlogg, delningslänkar:** 0007, Storage-bucket + policies, EXIF-strippning, `create_share_link`, `scan-log` Edge Function med rate limit.
7. **Verifiering & konflikter:** `request_verification`, `decide_verification`, `resolve_conflict`, köer.
8. **Frontend – skal:** auth, org-växlare, navigation (mobil bottennav + Skanna), i18n, designtokens enligt SPEC §10, komponentbiblioteket (`RegNumber`, `VerificationBadge`, `StatusBanner`, `Timeline`, `ScanButton`, `SerialInput`, `CompanyLookupField`, `DocumentDropzone`).
9. **Frontend – publikt:** `/m/:code`, `/r/:reg`, `/s/:token`, `/scan`, `/security`, landning.
10. **Frontend – kärnflöden:** registreringswizard (med `ocr-nameplate`), maskinsida med flikar, Inbox, ägarbyte, förbehåll (finansiär), kontroll + kvitto-PDF, flaggor, avregistrering, delning.
11. **Import:** `imports`/`import_rows`, `import-map` Edge Function, mappnings-UI, validering, batch-RPC `import_commit`.
12. **Flotta:** timmätare, service, påminnelser + digest, projekt, dokumentvalv, försäkring, uthyrning, **besiktning (`inspections`, inspector-org skriver direkt)**, **flott-/upphandlingsrapport (PDF + delningslänk, `client`-roll)**.
13. **Handlare:** lager, sälj-flöde (`new_sale` ⇒ nivå 2), inbyte, leads, kunder, annons-QR, märkesbeställning.
14. **Roller:** finansiärsportfölj + alerts, försäkringsportal, myndighetsportal (partiell sök, efterlysning/beslag, spärr, exportkontroll, beredskapsexport, registerutdrag), inspector-kö, `manufacturer`-portal (leveransdata via import/API), `client`-vy (delade flottrapporter).
15. **API & webhooks:** `api-v1` Edge Function, API-nycklar (hash, scopes), `api_requests`-logg, webhook-dispatch med retry, OpenAPI-spec på `/api-docs`, badge-endpoint.
16. **Marknadsbevakning:** `apps/ingest` med connector-interface + 2 riktiga adaptrar + generisk dealer-site-adapter, matchning, alerts, kandidat-flöde, admin-dashboard. Juridiska räcken enligt SPEC §8.6 i kod (privatsäljare ⇒ inga identifierande fält).
17. **Operatörsadmin:** godkännandekö, verifieringskö, konflikter, märkesbatcher, händelseutforskare + ankarverifiering, API-användning, supportsök, feature flags.
18. **PDF:er & e-post:** ägarbevis, kontrollkvitto, maskinrapport; alla e-postmallar sv/en.
19. **Seed & demo:** `seed.sql` exakt enligt SPEC §17, demo-manus fungerar end-to-end på staging.
20. **Redskap, förare, daglig kontroll, bränsle/klimat** (SPEC §20.1–20.4) inkl. `operational_status`, checklistmallar, klimatrapport-PDF.
21. **Fullmakter och kommission, risksignaler och bevakning efter kontroll, koncern/avdelningar** (SPEC §20.5–20.7).
22. **Tips, publik stöldlista, hjälpcenter, support, juridiska dokument med acceptans, kontosäkerhet, "Visa som organisation"** (SPEC §20.8, 20.10, 20.11).
23. **Betalning:** Stripe testläge, planer, användning, märkesbeställning, fakturor, `/pricing`, priser exkl. moms med moms separat (SPEC §20.9).
24. **Statistik, dataexport, push-notiser, sandbox, partial search, merge** (SPEC §20.12–20.16).
25. **Integrationsadaptrar med mock:** NFC, telematik, Transportstyrelsen, Larmtjänst (SPEC §7.8) och publika sidor (SPEC §20.17).
26. **Drift:** jobbtabell + pg_cron, PDF via Vercel Node-funktioner, backup/PITR-verifiering, runbooks, `.env.example`, Sentry, uptime (SPEC §21).
27. **Kvalitet:** Lighthouse, a11y, e2e-svit SPEC §16 punkt 13–17 och §21.7 punkt 18–26, README med uppstart på 10 minuter, `PROGRESS.md` markerad komplett.

## Arbetssätt
- En migration per steg, aldrig redigera en committad migration – skapa ny.
- Skriv testet innan RPC:n. Kör `pnpm test:db` (Vitest mot lokal Supabase) före varje commit som rör `supabase/`.
- Committa små, beskrivande commits per steg (`feat(db): encumbrance uniqueness + conflict flow`).
- När något i SPEC är tvetydigt: välj det säkraste alternativet, skriv en ADR i `docs/adr/` och gå vidare.
- Svenska i UI-strängar och dokumentation för användare; engelska i kod, kommentarer, ADR:er och commit-meddelanden.
- Läs `docs/SPEC.md` avsnittsvis vid behov (`§`-referenserna ovan) i stället för hela filen varje gång, för att spara kontext.
- Kör aldrig destruktiva kommandon mot något annat än den lokala Supabase-instansen. Migrationer mot staging/prod går via CI.

## Projektbeslut för detta repo (gäller före stack-raden ovan)
Beslutade av produktägaren 2026-09-26, se `docs/adr/`:
- **ADR 0001:** bygg vidare på befintlig kod – npm workspaces i stället för pnpm (`npm run test:db` = `pnpm test:db`), React 19, ingen Tailwind/shadcn.
- **ADR 0002:** MaskinIDs grafiska profil (`design-system/`) och namnet MaskinID gäller före SPEC §10. Profilens termer i UI: "Belånad", "Långivare", "Försäkringsgivare", "Spärrad".
- **ADR 0003:** SPEC v1.2 §20–§21 saknas; steg 20–27 tolkas från raderna ovan, antaganden i `docs/OPEN_QUESTIONS.md`.
- Databastester: `npm run test:db` mot lokal Postgres (`DATABASE_URL`, standard port 54322) med Supabase-stubbar, eller lokal Supabase med `SUPABASE_LOCAL=1` (ADR 0008).
