# PROGRESS – arbetslogg

Läs `CLAUDE.md` (inkl. "Projektbeslut"), denna fil och relevant §-avsnitt i `docs/SPEC.md` innan du fortsätter.
Status: ✅ klart · 🔄 pågår · ⬜ ej påbörjat

**Bygget är komplett (2026-09-27): alla 27 steg är klara och testerna gröna.** Antaganden som bör bekräftas finns i
`docs/OPEN_QUESTIONS.md`; vägvalen i `docs/adr/`.

## Miljö i byggcontainern
- Docker-registret är inte nåbart ⇒ `supabase start` fungerar inte här. Lokal Postgres 16:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg/data -o '-p 54322 -k /tmp/pg' -l /tmp/pg/log start"`
  (initdb första gången: `initdb -D /tmp/pg/data -A trust -U postgres`). `npm run test:db` skapar databasen `maskinid`.

## Steg
| # | Steg | Status | Anteckning |
|---|---|---|---|
| 1 | Grund: monorepo, CI, lokal DB, 0001–0002, shared (regnr, APP_NAME, flaggor) | ✅ | npm workspaces (ADR 0001); events/hashkedja skapad redan här (ADR 0004) |
| 2 | Organisationer & användare | ✅ | notiser, e-postkö, webhooks/api_keys-tabeller skapade här (infrastruktur) |
| 3 | Maskiner, identifierare, märken | ✅ | + modellkatalog, adaptrar (alla 7) i packages/shared |
| 4 | Events & audit (verify_chain, anchor-events) | ✅ | |
| 5 | Förbehåll, ägarbyten, flaggor | ✅ | §16 p.3–5, 9, 10 (skanningsdelen i steg 6) |
| 6 | Dokument, åtkomstlogg, delningslänkar | ✅ | §16 p.10 (skanning) och p.11 (rate limit) |
| 7 | Verifiering & konflikter | ✅ | + ägarrättelse (fyra ögon, 14 dagar), Inbox |
| 8 | Frontend – skal | ✅ | lokalt läge = PGlite i webbläsaren (ADR 0011) |
| 9 | Frontend – publikt | ✅ | |
| 10 | Frontend – kärnflöden | ✅ | Ägarbevis-PDF i steg 19 |
| 11 | Import | ✅ | ADR 0012 (parsning i webbläsaren, en signatur per finansiärsimport) |
| 12 | Flotta | ✅ | Jobben schemaläggs i steg 26 (pg_cron) |
| 13 | Handlare | ✅ | |
| 14 | Roller/portaler | ✅ | |
| 15 | API & webhooks | ✅ | ADR 0013 |
| 16 | Marknadsbevakning | ✅ | §16 p.16, ADR 0014; operatörsdashboard i steg 17 |
| 17 | Operatörsadmin | ✅ | ADR 0015 |
| 18 | PDF:er & e-post | ✅ | §10, §13 |
| 19 | Seed & demo | ✅ | §17, ADR 0016 |
| 20 | Redskap, förare, daglig kontroll, bränsle/klimat | ✅ | tolkat, ADR 0017 |
| 21 | Fullmakter, kommission, risksignaler, koncern | ✅ | tolkat, ADR 0018 |
| 22 | Tips, stöldlista, hjälpcenter, support, juridik, kontosäkerhet, "Visa som" | ✅ | tolkat, ADR 0019 |
| 23 | Betalning (Stripe testläge) | ✅ | tolkat, ADR 0020 |
| 24 | Statistik, dataexport, push, sandbox, partial search, merge | ✅ | tolkat, ADR 0021 |
| 25 | Integrationsadaptrar (NFC, telematik, TS, Larmtjänst), publika sidor | ✅ | ADR 0022 |
| 26 | Drift | ✅ | ADR 0023 |
| 27 | Kvalitet: e2e, a11y, Lighthouse, README | ✅ | ADR 0024 |

## Logg
- **Steg 1** – Repo omstrukturerat till `apps/web`, `apps/ingest`, `packages/shared`. Specdokumenten ligger i `docs/`.
  `packages/shared`: `APP_NAME`, feature flags, regler, regnr (Luhn mod 32, blandade grupper), identifierare, orgnr.
  Migrationer: prototypen flyttad till `legacy` (ADR 0005), extensions/app-schema/app_config, alla enums, events med
  hashkedja + append-only + Merkle-ankare. Testrigg: `npm run test:db` (10 tester), `npm test` (enhetstester).
- **Steg 2** – Migration `orgs_users`: organizations (enskild firma krypterad med pgcrypto, nyckel i Vault/app.secrets,
  maskerad visning), profiles (personnummer endast som saltad hash), memberships (inbjudningstoken hashad), operator_roles,
  company_lookups (mock i DEMO_MODE), notifications + preferences, email_outbox, api_keys, api_requests, webhooks,
  webhook_deliveries. Hjälpfunktioner i `app`: current_org_ids, is_member_of, has_org_type (pending ⇒ owner-rätt),
  is_operator, require_actor (verifierad identitet, MFA utanför demo, API-nycklar), notify_*, enqueue_webhook.
  RPC: my_context, create_org (owner auto-godkänd efter uppslag), update_org, get_org, search_orgs, invite_member,
  accept_invite, suggested_orgs, request_membership, members, verify_identity (mock), record_identity_verification
  (service), approve/suspend_org, notiser. Säkerhetsfynd åtgärdat: PUBLIC hade EXECUTE på nya funktioner ⇒ global
  `alter default privileges revoke execute … from public` + test som låser exponerade funktioner (99_function_exposure).
  Prototypens Edge Function invite-user borttagen (ersätts av invite_member + send-email i steg 18).
- **Steg 3** – Migration `machines`: machine_models, machines (alla tekniska fält §4.2), machine_identifiers (unik slot
  `unique_active` via triggers – skrotad/exporterad frigör serienummer), ownerships, label_batches, labels (role, medium),
  conflicts, oem_records, vtr_lookups. `app.create_machine` (kärnan för registrering/import/nyförsäljning): dubblett ⇒
  `disputed` + conflict + notiser, fabriksdata förifyller + `factory_data_confirmed`, VTR-mock med ägarkategori-varning,
  ägare via orgnr ⇒ platshållar-org + inbjudan. RPC: register_machine, utkast (save/list/delete), check_identifier,
  update_machine, bind_label (återanvändning ⇒ label_reuse-konflikt, ersättning revokerar), revoke_label, order_labels,
  print_label_batch, list_labels, public_machine_card (exakt §5.3-fält), lookup_machine (rollfiltrerad vy), get_machine,
  list_machines, lookup_vehicle_registry, lookup_oem, search_models. Säkerhet: firmatecknarkontroll före
  auto-godkännande/övertag av org (ADR 0009). NULL-säkra behörighetskontroller (`… is not true`).
  Adaptrar (`packages/shared/src/adapters`): IdentityProvider/SignatureProvider (BankID via OIDC-broker, id_token
  RS256-verifiering), CompanyLookup (Roaring), VehicleRegistryLookup (Transportstyrelsen, konfigurerbar), TheftRegistrySync
  (Larmtjänst), Ocr (mock; Anthropic i steg 10), Email (Resend/console); `createAdapters(env)` tvingar mock i DEMO_MODE.
- **Steg 4** – RLS på events (kategori per roll: finansiär ser förbehåll/ägarbyte/flagga, försäkring flaggor, tidigare
  ägare fram till sin överlåtelse), get_machine_history (tidslinje), list_org_events, admin_list_events,
  admin_verify_chain, anchor_compute (vägrar ankra bruten kedja + critical-notis), anchor_mark_published. Edge Function
  `anchor-events` (GitHub-publicering av anchors/YYYY-MM-DD.txt). Edge-infrastruktur: `_shared/http.ts`, `_shared/db.ts`,
  `_shared/shared` (synkad kopia av packages/shared, `npm run sync:functions`, CI kontrollerar), `deno check` i CI.
- **Steg 5** – Migration `encumbrances_transfers_flags`: signatures (text byggs server-side på användarens språk,
  bunden till action+subjekt+parametrar, engångs, bankid krävs utanför demo), encumbrances (partiellt unikt index
  = max ett aktivt finansieringsförbehåll), transfers (10-dagarsregeln, ett öppet per maskin, e-postinbjudan med token),
  flags (status härleds med prioritet stolen>blocked>disputed), check_receipts (K-ÅÅÅÅ-NNNNNN, resultat-hash).
  RPC: start_signature, complete_mock_signature, record_signature (service, personnummer-hash måste matcha kontot),
  register/request/confirm/reject/release_encumbrance, request_encumbrance_release, transfer_encumbrance_holder +
  accept_encumbrance_transfer, initiate_transfer, request_trade_in/approve_trade_in, approve_transfer_financier
  (släpp/överför till köpare/neka), accept_transfer, cancel_transfer, get_transfer, raise_flag/clear_flag,
  deregister_machine (märken revokeras, serienummer frigörs), perform_check(+_batch ≤500), list/get receipts,
  private_financing_status (privatperson ser bara ja/nej). Konflikt vid dubbelt förbehåll returneras (ADR 0007) med
  conflict-rad, critical-notis till holder, notis till ägare och webhook `encumbrance.conflict`.
  Integritetsfynd: `registered_by` gav evig insyn efter försäljning ⇒ bara under första ägarperioden (ADR 0010).
- **Steg 6** – Migration `documents_access`: documents (privat bucket `documents`, uppladdning bara till reserverad
  sökväg via storage-policy, sha256 i eventet, status scanning/clean/infected), publik bucket `machine-photos` för
  primärfoto, access_log partitionerad per månad (RLS även på partitioner), share_links (token hashad, visas en gång),
  rate limit-tabell. RPC: create_document_upload, finalize_document, list_documents, authorize_document_download,
  set_document_visibility, archive_document, set_primary_photo, scan_label, list_access_log (myndighetsläsningar
  dolda för ägaren som standard, operatör alltid dold), log_public_scan (30/min + 300/dag per IP ⇒ PT429; stulen ⇒
  critical-notis med ungefärlig plats + webhook machine.scanned), report_sighting ("Jag har sett maskinen"),
  create/list/revoke_share_link, get_share_view (maskinrapport: historik, förbehåll ja/nej + holder, dokument ≥
  verifiers). Edge Functions: scan-log, share-view, document-url (5 min), av-scan (JPEG EXIF-strippning + VirusScanner
  ClamAV/mock). `packages/shared/image.ts` (EXIF-strippning), VirusScanner-adapter.
- **Steg 7** – Migration `verification_conflicts`: verification_requests (nivå 1 kräver faktura/köpeavtal + skyltfoto,
  nivå 2 kräver matchning skylt ↔ registrerat serienummer, märke knyts), partnerkö (dealer/inspector/financier ≤ nivå
  1) och operatörskö, needs_info-rundgång, verify_on_site (inbyte), list_verification_partners ("Boka verifiering"),
  konflikter (list/resolve: keep_existing/keep_new/dismiss, report_ownership_dispute), owner_corrections med fyra ögon
  (två olika operatörer signerar) + 14 dagars invändningstid (disputed under tiden, jobb apply_due_corrections),
  get_inbox ("Väntar på mig"). Säkerhetsfynd: NULL-osäkra behörighetskontroller i decide/claim_verification och i
  committade get_transfer (e-postöverlåtelse läsbar för alla) ⇒ rättade + regressionstest + statisk kontroll i
  99_function_exposure som stoppar mönstret `if not (… _org_id = …)`.
- **Steg 8** – Frontend-skal: datalager `lib/backend` (Supabase eller lokal PGlite med samma migrationer + seed,
  emulerad auth/magisk länk/TOTP-MFA och Edge Functions), TanStack Query-hooks, i18next (sv standard, en; 770+ nycklar,
  paritets-/tonalitetstester, `scripts/i18n-check.mjs`, `scripts/i18n-set.mjs`), AuthProvider/OrgContext
  (`/o/:orgSlug/...`), layouter (publik; app med rollgrupperad sidomeny, org-växlare, global sök Ctrl/Cmd+K,
  inkorgsräknare, notisklocka, DEMO-banner, mobil bottennav med central Skanna). Komponenter: RegNumber,
  VerificationBadge, MachineStatusBadge, FinancingBadge, StatusBanner, Timeline, ScanButton/ScannerView (@zxing),
  SerialInput (live dubblettkoll + fabriksdata), CompanyLookupField, DocumentDropzone (EXIF-strippning, sha256,
  reserverad sökväg, av-scan), MachineCard, MachinePhoto, ReceiptCard, SignatureProvider (Demo-BankID/BankID),
  DataTable (sök/filter/CSV, kort på mobil), Dialog, Tabs, Skeleton, EmptyState. Sidor: login (demokonton),
  signup, callback, invite, onboarding (Demo-BankID + org med uppslag, typer, PuB-avtal), profil (+MFA), översikt,
  inkorg, notiser, inställningar (org/medlemmar/notiser). Demo-seed del 1 (§17: alla organisationer/konton, 60 maskiner
  med scenarier, 200 märken). `apps/web/scripts/demo-db.mjs` bygger demodatabasen. Migration `frontend_support`
  (get_signature_status, list_org_events visar externa aktörer som organisation, demo_shortcuts).
- **Steg 9** – Publika sidor: startsida (uppslag på regnr med kontrolltecken utan databasanrop, skanna, värde per
  aktör, demogenvägar i DEMO_MODE), `/m/:code` + `/r/:reg` via scan-log (exakt §5.3-kortet, noindex, röd helskärm vid
  stöld med 114 14, "Jag har sett maskinen" med samtycke till plats, offline: senast kända status), `/s/:token`
  (maskinrapport, dokumentnedladdning med token), `/scan`, `/verify` (privatperson med BankID ser bara ja/nej),
  `/security` (hashformel, ankare med verifiering, drift/utträdesklausul, ansvarsfull rapportering, security.txt), `/how`.
- **Steg 10** – Kärnflöden i appen: maskinlista (omfång ägda/brukade/registrerade åt kund/tidigare, sök, filter,
  CSV, påbörjade utkast), maskinsida med flikar (Översikt, Historik, Dokument, Förbehåll, Åtkomst) och rollstyrda
  åtgärder: sälj/överlåt (orgnr-uppslag eller e-post, ny finansiering), dela (länk visas en gång, stäng), uppdatera
  uppgifter, höj verifieringsnivå (partnerlista), koppla märke (skanna), registrera/släpp/bekräfta förbehåll, begär
  frisläppning, anmäl stöld/flagga (myndighet: beslag/spärr/utredning), ta bort flagga, avregistrera (signering).
  Registreringswizard i fyra steg (§6.2): foto av skylt ⇒ `ocr-nameplate` (Claude, fält för fält), live
  dubblettkoll + fabriksdata, modellkatalog, maskinfoto, ägare/annan ägare med inbjudan, förbehållsförfrågan,
  märke, autosparat utkast, klar-sida. Ägarbytessida `/transfers/:id` (köpare signerar, finansiär släpper/överför/nekar,
  säljare avbryter, inbyte godkänns). Finansieringskontroll (en eller CSV ≤500, skannat märke ⇒ regnr), kvitto-PDF
  (pdf-lib), kvittoarkiv, "Registrera förbehåll" från resultatet, `/encumbrances/new`, `/report-error` och
  `/transfer-request` (dubblettträff i SerialInput). Publik `/receipt`: vem som helst med kvitto bekräftar det med
  kvittonummer + SHA-256 (`verify_check_receipt`). Edge Functions: `bankid-identify` och `bankid-sign` (OIDC-broker,
  HMAC-signerad state, ingen öppen redirect), `company-lookup` (Roaring, rate limit per användare, signatärer hashas),
  `ocr-nameplate`/`ocr-listing-images`/`import-map` (Claude med strukturerad JSON-utdata, mock i DEMO_MODE).
  Migration `frontend_flows`: kontroll med typ "any" matchar även MaskinID-regnr, `verify_check_receipt`,
  `rate_limit_check`. Fynd: lokalt demoläge tappade skrivningar vid omladdning (databasen skrevs aldrig klart till
  IndexedDB) ⇒ fullständig synk efter laddning + efter varje transaktion, markör för komplett kopia.
  Webbläsartestat: registrering (mobil), sälj → köpare signerar (Demo-BankID), finansiär kontrollerar + registrerar
  förbehåll, kvitto-PDF.
- **Steg 11** – Import (§6.5): migration `imports` (imports/import_rows med RLS, `create_import` validerar rad för
  rad i databasen – obligatoriska fält, identifierarformat, dubbletter i filen och mot registret med regnr, kategori
  från fritext sv/en eller modellkatalogen, orgnr, förbehållsregler – `import_commit` en subtransaktion per rad,
  `import.committed`-event, `get_import`/`list_imports`). Finansiärsimport: nya maskiner registreras hos kunden,
  befintliga får förbehållet (`encumber_existing`), en signatur för hela importen, aldrig överskrivning (konflikt +
  notiser om ett annat förbehåll hunnit registreras). Signaturtexter för nya åtgärder via `app.sigtext_<åtgärd>`.
  Webb: `/import` i fyra steg (fil/klistra in, kolumnmappning via `import-map`, förhandsgranskning med fel,
  "Importera bara giltiga rader", felrapport-CSV, mall, tidigare importer), `lib/tabular.ts` (CSV-autodetektering,
  XLSX via read-excel-file). Webbläsartestat: handlare 20 rader (2 fel ⇒ 18 maskiner), finansiär med signering.
- **Steg 12** – Flotta (§7.1, §4.6): migration `fleet` med projects/machine_assignments, maintenance_entries
  (timavläsning endast uppåt utom som rättelse, event per avläsning), inspections (ackrediterat kontrollorgan skriver
  direkt, ägaren med protokoll; historiken följer maskinen; publikt "Besiktigad t.o.m." bara om ägaren valt det),
  reminders (service på datum/timmar, besiktning, försäkring, leasing-/förbehållsslut, uthyrningsslut; notiser
  60/30/7/0 dagar via `app.run_reminder_notifications`, måndagsdigest via `app.enqueue_weekly_digest`),
  insurance_policies (relation `insurer`, badge bara för ägare/försäkring/myndighet), rentals (nyttjanderätt av typ
  rental i registret, påverkar aldrig finansieringskontrollen, relation `lessee`), flott-/upphandlingsrapport och
  projektlista (live, delningslänk, ögonblicksbild med F-nummer + SHA-256 verifierbar på `/receipt`, PDF i
  webbläsaren), `report_grants` (beställare/`client` följer rapporten read-only), `list_partner_orgs` (katalog för
  finansiärer/försäkringsbolag/beställare i väljare – `search_orgs` gav tomt för tom sökning, vilket gjorde
  finansiärsväljarna i steg 10 tomma). Webb: fliken Service på maskinsidan (timmar + graf, projekt, påminnelser,
  servicelogg, besiktningar, försäkring), `/fleet` (att göra, projekt, rapport, beställare, publikt
  besiktningsmärke, "Rapportera timmar" via skanning), `/rentals`, `/client-reports`, `/inspections/new`
  (kontrollorgan), delad rapport på `/s/:token`, dokument som följer med vid ägarbyte, kolumnerna projekt och nästa
  åtgärd i maskinlistan.
- **Steg 13** – Handlare (§6.3, §7.2): migration `dealer` – `sell_machine` (ägarbyte som köparen godkänner med
  BankID; nyförsäljning från lager kräver faktura och ger nivå 2/`new_sale` + första försäljning när köparen
  godkänt, via `app.after_transfer_completed`), `set_stock_status` (lager/inbyte/demo), `list_sales`,
  `list_customers` (byggs av försäljningar och registreringar), leads (tabell med RLS, `submit_lead` via Edge
  Function `lead` med IP-hash och rate limit, samtycke, webhook `lead.created`, rensning efter 24 månader),
  `public_ad_card` (maskinkort + säljande handlare bara medan maskinen är i lager), `trade_in_lookup` (historik och
  förbehåll inkl. innehavare för handlaren vid inbyte). Webb: `/stock` (flikar, Sälj, annons-QR-PDF, lagerlapp,
  dela rapport, lagerstatus), `/sales/new`, `/trade-in` (skanna ⇒ begär inbyte), `/leads`, `/customers`, `/labels`
  (beställ märken, batcher, märkeslista), publik `/ad/:reg` med "Kontakta säljaren". Fynd: demoseedens
  organisationsnummer klarade inte kontrollsiffran så uppslag i UI misslyckades ⇒ rättade + test.
- **Steg 14** – Roller (§7.4, §7.5, §9.2): migration `roles` – watchlist (bevakning med notis via trigger på events,
  aldrig till den som orsakade händelsen), `list_portfolio` (finansiär: förbehåll, försäkringsbolag: försäkringar),
  `list_alerts`, försäkringskrav på verifieringsnivå + länk för skadeanmälan (visas för ägaren),
  `authority_search` (delsök ≥ 4 tecken, loggas), `list_flags` (med senaste skanning), beredskapsexport
  (aggregat per län/kategori/viktklass, inga ägaruppgifter), registerutdrag (U-nummer + SHA-256, inga
  personnummer, verifierbart på `/receipt`), tillverkarens leveransdata (`submit_oem_records`, matchning mot
  registrerade maskiner). Webb: `/portfolio`, `/alerts`, `/watchlist`, `/verify` + `/verify/:id` (granskning med
  underlag, nivå 2 kräver skyltavläsning), `/bookings`, `/search`, `/flags`, `/export-check`, `/exports`, `/oem`,
  registerutdrag-PDF och skadeanmälan på maskinsidan.
- **Steg 15** – API & webhooks (§12): migration `api` – API-nycklar (visas en gång, SHA-256, scopes, sandlåda, rate
  limit per nyckel/minut), `resolve_api_key`, `log_api_request`, idempotens (24 h), `api_usage`, webhooks (https
  till publika värdar, hemlighet visas en gång, händelsefilter, test, leveranslogg, "Skicka igen", 5 försök med
  backoff via `claim_webhook_deliveries`/`record_webhook_result`), `badge_data`, API-paritet (service_role kan köra
  allt som inloggade kan). Edge Functions: `api-v1` (routing från delad routetabell, scope-kontroll, 409 vid dubbelt
  förbehåll, 202 + signing_url för ägarbyte), `webhook-dispatch` (HMAC-SHA256-signatur), `badge` (SVG, 5 min cache,
  noindex). Delad `packages/shared/src/api/routes.ts` driver även OpenAPI 3.1 på `/api-docs`. Webb: Inställningar →
  API och webhooks.

- **Steg 16** – Marknadsbevakning (§8): migration `market` – `market_sources` (kill switch, villkorsstatus, config
  utan hemligheter), `market_runs`, `market_observations` (säljare bara för företag; enskild firma lagras som privat;
  `raw` rensas rekursivt från personfält), `market_alerts` (sex typer, en öppen per typ/maskin), matchning på
  serienummer (≥ 0,85), notiser + webhook till ägare/långivare/flaggare/bevakare, stöldflagga i efterhand kontrollerar
  aktiva annonser, kandidater → förifyllda utkast, `claim_ocr_candidates` för bild-OCR, gallring efter 24 mån.
  Annonspris visas aldrig i registret. Worker `apps/ingest`: connector-interface, Mascus, Blocket, generisk
  handlarwebbplats (sitemap + JSON-LD), partnerflöde; robots.txt + ≥ 2 s/domän; sanering i workern och igen i
  databasen; CLI + GitHub Actions-schema (`ingest.yml`). Webb: "Senast sedd till salu hos …" på maskinsidan,
  kandidatpanel på Maskiner. Demo-seed: stulen CAT 950 GC i annons + tre kandidater för Nordmaskin.
- **Steg 17** – Operatörsadmin (§9 `/admin`, §2.4): migration `operator_admin` – `operator_audit` (append-only,
  varje supportsök/uppslag/ändring loggas), `admin_overview`, `admin_list_orgs`/`admin_get_org`/`admin_set_org_types`
  (godkännandekö, begränsa roller), märkesbatcher (lista, tryckfil med koder, skickad/avbruten), `admin_api_usage`,
  `admin_support_search` (org, användare, maskin via regnr/serienummer), funktionsflaggor (`admin_set_config`,
  superadmin, event + audit), `admin_system_health` (kedja, ankare, webhooks, e-post, marknad), `admin_market_overview`.
  Webb under `/o/<operatör>/admin/*` (+ `/admin/*`-omdirigering): översikt, organisationer, verifieringskö,
  konflikter, rättelser (fyra ögon med BankID), märkesbatcher, händelselogg + ankarverifiering, marknadsbevakning
  (larm, källor med kill switch, körningar), API-användning, supportsök, flaggor, systemhälsa + operatörslogg.
- **Steg 18** – PDF:er & e-post (§10, §13): migration `documents_email` – numrerade, hashade ögonblicksbilder för
  ägarbevis (B-, ägare eller säljande handlare inom 30 dagar) och maskinrapport (R-, ägare eller via delningslänk
  `buyer_report`), `verify_report` för alla typer inkl. "ersatt" när ägaren bytts, nytt ägarbevis + e-post vid varje
  genomfört ägarbyte, köparrapporten får timmar/service/besiktningar och döljer interna händelser,
  `claim_email_outbox`/`record_email_result` (lease, backoff, 5 försök). Delad e-postrenderare
  (`packages/shared/src/email`) med mallar sv/en för notis, inbjudan, ägarinbjudan, ägarbyte, veckodigest, ägarbevis
  och SMS-text; Edge Function `email-send`. Webb: gemensam PDF-layout (ID-band, dokumentnummer, QR, kontrolltext +
  SHA-256 på varje sida), ägarbevis/maskinrapport på maskinsidan, efter registrering och efter ägarbyte, maskinrapport
  på delningssidan, `/verify-document`, e-postingångar `/go?to=` och `/transfer/:id` (även för köpare utan konto).
- **Steg 19** – Seed & demo (§17): kompletterat med projekt (Bergs, 2 st), 2 uthyrda maskiner, timmar varje vecka,
  service, besiktningar, kontroller från båda finansiärerna, 31 publika skanningar i 11 orter (stulen maskin skannad i
  Norrköping), 150 marknadsobservationer (1 stulen matchad, 2 med samma serienummer hos olika säljare), 400+ händelser
  över 30 dagar med 30 publicerade ankare (ADR 0016). Test `00_seed_data` kontrollerar §17-siffrorna. Demo-manuset
  körs i webbläsaren (skanning, stöldnotis, sälj → ägarbevis-PDF, kontroll + blockerat andra förbehåll, inbyte, import,
  marknadskandidater) – staging kräver driftsättning (steg 26).
- **Steg 20** – Redskap, förare, daglig kontroll, bränsle/klimat (tolkat, ADR 0017): migration `equipment_operators` –
  `operational_status` på maskinen, redskap med monteringshistorik, förare (utan personnummer) med behörigheter och
  utgångsvarning, maskin–förare-koppling, inbyggda och egna checklistor, daglig kontroll (kritiskt fel ⇒ ur drift +
  notis, ren kontroll häver), bränsle/el-logg, klimatrapport per period/maskin/projekt med emissionsfaktorer i
  `app_config` och verifierbar C-ögonblicksbild. Webb: Daglig kontroll (mobil, stora knappar, historik, mallar),
  Redskap, Förare, Bränsle & klimat (+ PDF), Drift-sektion på maskinens Service-flik, "Ur drift" i listan och på
  maskinsidan. Seed: redskap, förare, kontroller (en med fel), 8 veckors tankningar för Bergs.
- **Steg 21** – Fullmakter/kommission, risksignaler, koncern (tolkat, ADR 0018): migration `mandates_risk_groups` –
  fullmakt och kommission med BankID-signatur, accept, återkallelse och behörigheter (sälja/se/drift); ombudet kan
  påbörja ägarbyte med ägaren som säljare, kommissionsmaskiner i handlarens lager; risksignaler i kontrollresultat och
  kvitto; bevakning efter kontroll (30/90/180 dagar); koncern (en nivå, moderbolaget läser dotterbolagens maskiner);
  avdelningar med filter. Webb: Fullmakter-sida + dialog från maskinsidan, Kommission-flik i lagret, risksignaler och
  "Bevaka maskinen" på kontrollen, Inställningar → Koncern/Avdelningar, Koncernöversikt. Seed: kommission
  Bergs → Nordmaskin, avdelningar hos Bergs, Skogsmaskiner Norr som dotterbolag till Nordmaskin.
- **Steg 22** – Migration `support_legal`: tips (Edge Function `tip`, anonymt, rate limit, notis till ägare/flaggare,
  operatören vidarebefordrar till myndighet), publik stöldlista `/stolen` (opt-in per stöldflagga, `set_flag_public`,
  inga ägaruppgifter), hjälpcenter `/help` (10 artiklar sv/en i `packages/shared/src/help`), support (ärenden i appen
  `/o/:slug/support`, kontaktformulär `/contact` via Edge Function `support`, operatörskö, e-postmall `support_reply`),
  versionerade juridiska dokument `/legal/:key` med acceptansspärr (LegalGate) och admin-publicering, säkerhetslogg och
  "logga ut från alla enheter" på profilen, "Visa som organisation" (skrivskyddat 30 min, skäl, audit, notis till
  kundens admin, banner). Seed `50_support.sql`. Tester: `18_support_legal` + seedkontroller. ADR 0019, öppna frågor 16–19.
- **Steg 23** – Migration `billing`: prislista och planer (gratis, handlare, finansiär, försäkring, marknadsplats, offert,
  icke-publik offentlig plan), förbrukning mäts med triggers på kontroller, API-anrop, registerutdrag och märkesbeställningar,
  månadsfakturor i efterskott (`close_billing_period`, idempotent) med moms separat, notis + e-postmall `invoice`.
  `Payments`-adapter (Stripe testläge | mock) med Checkout, kundportal, fakturaposter och signaturverifierade webhooks;
  Edge Functions `billing`, `stripe-webhook`, `billing-sync`. Webb: `/pricing`, Inställningar → Betalning (plan,
  förbrukning, faktureringsuppgifter, fakturor med PDF och demobetalning), Admin → Betalning (priser, planer, stäng
  period, markera betald/makulera), pris vid märkesbeställning. Seed `55_billing.sql`. Tester `19_billing`, adapter- och
  hjälpfunktionstester. ADR 0020, öppna frågor 20–22.
- **Steg 24** – Migration `stats_export_push_merge`: publik statistik med undertryckta små celler + daglig ögonblicksbild,
  exakt statistik för operatören, miljötabell som CSV; export av organisationens data och av egna personuppgifter (JSON,
  utan hemligheter); webbpush (VAPID + aes128gcm med Web Crypto, `PushSender`-adapter, kö via trigger på notiser,
  Edge Function `push-send`, service worker, lokal pump i demon, push-inställning per org); rättning: "alla notiser"
  (`['*']`) skickade ingen e-post; API-sandlåda med fasta testmaskiner i gatewayn, ej debiterad; delsökning (≥ 5 tecken,
  maskerat, `GET /machines/search`); sammanslagning av dubbletter med flytt av data och sammanslagen historik. Webb:
  `/statistics` och Admin → Statistik (diagram enligt dataviz-metoden), Inställningar → Data och export, Profil →
  Push-notiser och Mina uppgifter, Kontroll → Delsökning, sammanslagning i konfliktkön, sandlådeavsnitt på `/api-docs`.
  Seed `95_statistics.sql`. Tester `20_stats_export_push_merge`, sandlåde-, webpush- och push-texttester. ADR 0021.
- **Steg 25** – Migration `integrations`: NFC-märken (beställning, chipregistrering via Web NFC, varning för kopierat
  märke vid skanning), telematik (ISO 15143-3/AEMP 2.0 för CareTrack, Komtrax, Trackunit; krypterade inloggningar,
  matchning på serienummer, timmätare uppåt, senaste position, larm när stulen maskin rapporterar position),
  Transportstyrelsen (Edge Function `vtr-lookup` + uppslag i registreringsguiden), Larmtjänst (utkö från stöldflaggor,
  inkommande anmälningar matchas men flaggar aldrig automatiskt, granskning i Admin → Stöldregister), `/status`.
  Edge Functions `telematics-sync`, `theft-sync`, `vtr-lookup`; `scan-log` kontrollerar NFC-chip. Webb: Inställningar →
  Integrationer, position på maskinsidan, NFC i skanning och märkessidan, publika sidor `/for/:segment`, `/about`,
  `/integrations`, `/status`. Rättning: tidslinjetexten för rapporterade timmar. Runbook `docs/runbooks/integrations.md`.
  Seed `60_integrations.sql`. Tester `21_integrations`, telematikadapter. ADR 0022, öppna frågor 27–30.
- **Steg 26** – Migration `operations`: jobbtabell + körhistorik, `app.schedule_jobs()` till pg_cron, SQL-jobb via
  `app.run_job` och Edge Functions via pg_net med `x-cron-secret`, larm efter tre misslyckanden, Admin → Schemalagda jobb.
  Nya jobb: tillfälliga registreringar (påminnelse + avregistrering), stulen > 24 mån, dagliga/veckovisa
  notissammanfattningar (ny e-postmall), nattlig verifiering av händelsekedjan, städning; `health_check` och `/status`
  visar jobbhälsa. PDF i Vercel Node-funktion `api/pdf.ts` (samma generatorer och RPC:er som webben). Sentry i alla
  Edge Functions (`_shared/sentry.ts`) med gemensam skrubbning (`packages/shared/src/scrub.ts`), Edge Function `health`.
  GitHub Actions: `deploy.yml` (staging automatiskt, produktion med godkännande), `uptime.yml`, `backup-drill.yml` med
  `scripts/verify-restore.mjs`. Komplett `.env.example`, `vercel.json` med säkerhetsheaders. Runbooks: setup, deploy,
  monitoring, backup-restore, incident, secrets. Tester `22_operations`, server-PDF, skrubbning. ADR 0023.
- **Steg 27** – E2E-svit i `e2e/` (Playwright, kör mot demodatabasen i webbläsaren, en ny databas per test, inga
  omkörningar): §16 p.13 handlare (registrering → godkännande → import 20/18 → märken → försäljning med långivare →
  köparen godkänner → förbehåll bekräftas → ägarbevis-PDF), p.14 ägare, p.15 långivare, p.16 stöld, p.17 myndighet;
  tolkade p.18–26: daglig kontroll/ur drift, kommission, stöldlista + tips, support + villkor + "Visa som", betalning,
  statistik + dataexport, sandlådenyckel, telematik, driftstatus; mobil (Pixel 7) och axe (WCAG 2.1 AA) på 21 sidor.
  30 tester gröna. Lighthouse-skript (`npm run lighthouse`, produktionsbygge: tillgänglighet 100, prestanda 83–87).
  CI-jobb `e2e` och `lighthouse`. Sviten hittade och rättade: krasch i åtkomstloggen, OCR-värden som försvann i
  guiden, fel enumvärde för OCR-identifierare, verifieringsförfrågan utan underlag, dubbelkodad telematik i
  webbläsarläget, flikar med `aria-controls` mot saknade paneler (nu även piltangenter/Home/End med fokus), layoutskift
  i sidfoten (prestanda 59 → 85), och ett säkerhetsfel: "Visa som organisation" kunde skapa supportärenden i
  organisationens namn ⇒ migration `view_as_read_only` (skrivspärr via `require_actor` + triggrar, `VIEW_AS_READ_ONLY`).
  `/status` visar schemalagda jobb. README omskriven: uppstart på 10 minuter. ADR 0024, öppna frågor 34–37.

## Produktion som stängd pilot, admin och webbplats/app (2026-10-14)

Produktägarens beslut: riktiga konton och riktig e-post nu, Demo-BankID tills ett BankID-avtal finns, och MaskinID
(maskinidab@gmail.com) godkänner varje organisation. Webbplatsen och appen delas i samma repo. ADR 0034 och 0035,
migrationer `20261014000004`–`6`, runbook `docs/runbooks/go-live.md`.

- **Pilotläge** (`MOCK_IDENTITY`, `REQUIRE_ORG_APPROVAL`, båda av som standard). En väntande organisation ser och gör
  ingenting; appen visar en väntesida, och ett avslag visar skälet. Ingen automatisk godkänning, placeholder-övertag
  går till granskning, företagsnamn skrivs för hand när det inte finns något register och flaggas för operatören.
  `reject_org`, e-post till operatörer och sökande, tvåstegsverifiering som egen sida för långivare, myndigheter och
  operatören. `app.bootstrap_operator` gör `OPERATOR_EMAIL` till superadmin via deploy.
- **Inga schemalagda jobb hade någonsin körts** (ingen pg_cron, pg_net eller cron-hemlighet, och `email-send` nekades av
  gatewayen) – ingen e-post skickades i någon miljö. Rättat; deploy kopierar hemligheten till funktionerna.
- **Deploy** sätter flaggor, funktionsinställningar och hemligheter per GitHub-miljö.
- **Admin**: Konton, Långivare, E-postlogg, Revisionslogg, pilotstatus på översikten.
- **Webbplats** `apps/site` (maskinid.se) byggs ur appens källkod med bara de publika sidorna; appen på app.maskinid.se.
  QR-koder och delningslänkar byggs alltid med webbplatsens adress. Utan `VITE_SITE_URL`/`VITE_APP_URL` beter sig allt
  som förut (lokalt, e2e). Röktestad mot staging: startsida, maskinkort, stöldlista och vidarekoppling till appen.
- **Kvar för produktägaren** (runbooken): Resend-domän och nyckel, GitHub-miljövariabler, Supabase Auth (SMTP,
  e-postbekräftelse, URL:er), två Vercel-projekt och DNS, och `gh auth refresh -s workflow` för att kunna pusha
  ändringar i `.github/workflows`.

## Kontroll av runda 8–13 på staging (2026-10-14)

Produktägaren såg att Nordic Finance saknade konto och att en åtkomstbegäran inte gick att godkänna. Tre
migrationer (`20261014000001`–`20261014000003`), tillägg i ADR 0032.

- **Staging var aldrig omseedad efter runda 8–13.** Migrationerna låg ute, men seeden körs inte av `db push`:
  `nordic@demo.se` fanns inte, och en tidigare körning av runda 2 hade flyttat `JCB3CX04278` till Nordmaskin –
  så Lenas förfrågan hamnade i Nordmaskins inkorg, inte Bergs. Omseedad via MCP: datatabellerna tömdes (de nio
  tabeller som migrationerna själva fyller – config, jobb, planer, juridik, modeller – behölls, bestämt genom att
  bygga en databas med bara migrationer i PGlite), sedan de elva seedfilerna i ordning. Guiden säger nu att runda
  10 ska köras före runda 2/12.
- **Åtkomstbegäran försvann för den som frågade** – samma knapp igen, inget som sa var den låg. Nu "Förfrågan
  skickad … väntar på ägarens godkännande" med **Dra tillbaka** i sökningen och på historikfliken.
- **Begäran avslöjade ägaren.** `request_mandate`, `list_mandates`, avslagsnotisen och en återkallelse från
  ägaren returnerade ägarens namn, som uppslaget medvetet döljer. Döljs nu tills ägaren godkänt
  (`app.mandate_hides_principal`).
- **Flottinsynen (runda 13) gick inte att se.** Ett samtycke för hela flottan gav åtkomst men ingen lista: banken
  kunde bara öppna en maskin vars regnr den redan kände till. Nytt scope `shared` i `list_machines`, "Delade med
  oss" under Maskiner, länkat från Fullmakter och Portföljen.
- **Avtalsnumret var inte obligatoriskt i praktiken.** Bankens prefix (`NF-`) fylls i, och det ensamt godtogs –
  runda 8:s "Avtalsnummer krävs." kom aldrig. Trigger på `encumbrances` + kontroll i handlarens dialog.
- **Nordics leasing saknade villkoren** som guiden lovade; seeden sätter dem nu och `00_seed_data` kontrollerar.
- **Provkörning:** `npm run test:staging` (`e2e/staging/rounds.staging.ts`) klickar igenom runda 8–13 mot
  staging – alla sex gröna 2026-10-14. De gamla `test-results/*.mjs`-skripten var otrackade i en katalog som
  Playwright tömmer och är borta; ersatta av den här.

## Rikards andra runda (2026-10-13): belopp, inbytestest, handlarvyn, behörigheter

Tretton punkter efter produktägarens andra provkörning. Sju migrationer (`20261013000001`–`20261013000007`),
ADR 0029–0033, fyra nya databastestfiler och två nya e2e-specar. Allt grönt: `lint`, `typecheck`, `test`,
`test:e2e`, `check:functions`, `i18n-check`.

- **Finansieringsvillkor för ägare och långivare (ADR 0029).** Åtta kolumner på `encumbrances`:
  `financing_amount`, `down_payment`, `residual_value`, `amortization_months`, `interest_rate` plus de uträknade
  `monthly_cost`, `total_credit_amount` och flaggan `terms_overridden`. Hård regel 5 är **smalnad, inte slopad**:
  ingen köpeskilling, ingen restskuld, `payoff_requests` fortfarande beloppsfri. Villkoren ligger i ett **eget**
  JSON-objekt (`app.encumbrance_terms_json`), aldrig på `encumbrance_json`s `p_full` – som är sant även för
  operatör och myndighet. `26_financing_terms.test.ts` går igenom varje serialiseringsväg.
  - Den väg som nästan missades: `transfers.new_financing` lagras ordagrant och `transfer_json` returnerade den
    rått, medan `open_transfer` visas för myndighet och för handlare vid inbyte. `app.open_new_financing`
    strippar nu beloppen ur överlåtelseraden i samma transaktion som de kopieras till förbehållet.
  - **Finanssnurran:** annuitet med restvärde, i `packages/shared/src/financing.ts` och igen som
    `app.annuity_monthly`, eftersom `register_encumbrance` är nåbar över `api-v1` utan webbläsare. Ett db-test kör
    båda över samma falltabell och jämför på öret.
  - **Avtalsnummer obligatoriskt** från alla tre dörrar (`register_encumbrance`, `request_encumbrance`,
    `app.open_new_financing`) – i RPC:erna, inte som kolumnvillkor: en `CHECK` gäller även vid `UPDATE`, och
    hade gjort det omöjligt för en bank att släppa ett förbehåll som registrerats innan kravet fanns.
  - `update_encumbrance_terms` för rättning, `list_portfolio` visar villkoren för långivaren, och OCR:n läser nu
    ut beloppen och förifyller snurran.
- **Två "ingen behörighet"-fel (ADR 0030)**, samma modelleringsmiss i båda ändar av lösenflödet.
  - Handlaren kunde se att ett lösenbesked kommit men inte öppna det: den hade ingen relation till maskinen,
    eftersom `request_trade_in` lämnar överlåtelsen i `draft`. Ett lösenärendes dokument tillhör nu **ärendet** –
    dess två parter läser dess två dokument. `authorize_document_download` skiljer dessutom på behörighet och
    beredskap (`DOCUMENT_NOT_READY`), så en pågående virusskanning inte ser ut som samma fel.
  - Att släppa spärren avslutade bankens egen holder-relation i samma transaktion, så sidan bakom dialogen blev
    oläsbar. Ny relation `former_holder` i 90 dagar (medvetet **inte** i `has_full_access`), dialogerna slutar i
    ett kvitto i stället för att stänga, och `MachinePage` slutar behandla ett `NOT_FOUND` vid refetch som ett
    fel – samma buggklass gällde `deregister_machine`, `accept_transfer` och `revoke_mandate`.
- **Inbytestest och handlarvyn (ADR 0031).** Egen tabell och RPC som delar checklistkomponenten med Daglig
  kontroll: `submit_daily_check` kräver att man äger maskinen, och en inbytesmaskin är någon annans – eller inte i
  registret alls, därav `machine_id` nullable. Rör aldrig ägarens timmätare eller driftstatus, och ägaren kan
  inte läsa handlarens värdering (RLS, och eventet loggas med `machine_id = null`).
  De fyra flottmodulerna blev en per-organisation-inställning med **typhärledd default**, spärrad av
  insert-triggrar (`appRoutes` har ingen rollmetadata, så ett gömt menyval är inte ett skydd) och omställbar av
  organisationen själv under Inställningar → Moduler. De seedade uthyrningarna flyttade från Nordmaskin till
  Bergs Schakt.
- **Sök för alla kontotyper och samtycke för historiken (ADR 0032).** Det var aldrig `is_sole_trader` – ingen
  behörighetsväg läser den flaggan. Det var organisationstypen: `machine_view_extras` gav bara
  `financing`-blocket till en relation eller en partnertyp. Nu `sees_yes_no := p_org_id is not null`, så alla
  autentiserade ser *om* maskinen är belånad, medan långivarens namn och villkoren förblir smala.
  - Det är **`lookup_machine`** som öppnats, inte `perform_check`: den senare har en metringstrigger på 49 kr per
    kontroll, ger `checker`-relation i 24 timmar och föder risksignalen `many_recent_checks`. Hela ändringen är en
    `app.rate_limit_hit`-rad.
  - Samtycket är en **fullmakt**, inte en ny tabell. Nytt status `requested` – och det är en säkerhetsgräns, inte
    städning: `pending` betyder "agenten ska acceptera", och `respond_mandate` matchar `agent_org_id = actor and
    status = 'pending'`, så en agent-initierad `pending`-rad hade låtit den som frågar godkänna sin egen begäran.
    `app.can_read_event` känner nu fullmakter, nycklat på **scope** (`view` ger hela historiken, `fleet` bara
    `machine.*`), eftersom relationen `agent` sätts för `view|sell|fleet` lika.
  - Svaret på bankfrågan: **utan samtycke ser banken bara det den finansierar.** Med ett signerat, tidsbegränsat
    och återkalleligt samtycke ser den hela eller delar av flottan. Samtycke ger historiken, aldrig villkoren.
- **Priserna bort bakom `FEATURE_PRICING` (ADR 0033)**, default av och medvetet **inte** OR:ad med demoläget –
  staging kör demoläge, och det är där priserna ska vara borta. `list_plans` svarar med tom prislista i stället
  för att raisa, eftersom den är anon-grantad och anroparna indexerar `price_items` direkt. Detta är klientens
  *första* flaggläsning, så den kom med plumbing: `useFlag` (svarar direkt med default, så en länk inte blinkar)
  och `useFlagState` (rapporterar även `loading`, för när svaret styr en redirect).
- **Nordic Finance (demo)** tillagd som femte långivare, `516401-3038` / `nordic@demo.se`, med
  `financing_defaults` och ett aktivt leasingförbehåll med fullständiga villkor att visa snurran på.
- **Rättade i förbifarten:** `scripts/sync-functions-shared.mjs` kunde inte köra på en OneDrive-katalog
  (`cpSync` föll på att unlinka målet, errno 0), och `nav.ts` pekade på en `reports`-route som inte finns.


## Finansieringsrundan (2026-10-10)

Efter produktägarens provkörning inför demon för Alsike Maskin. Tretton punkter, inga krascher – kedjan
**handlare → MaskinID → bank** slöt sig inte i praktiken. Fem migrationer (`20261010000001`–`20261010000005`),
ADR 0025–0027.

- **Lösen (`payoff_requests`).** Hela samtalet mellan den som säljer/exporterar och långivaren:
  `request_payoff` → `submit_payoff_quote` → `submit_payoff_settlement` → `settle_payoff`, plus `decline_payoff`,
  `list_payoff_requests` och jobbet `expire-payoff-quotes`. **Inget beloppsfält** – summan finns bara i bankens
  bifogade PDF (ADR 0025, `CLAUDE.md` regel 5). `submit_payoff_settlement` rör inte förbehållet; spärren släpps
  bara av holder med signatur, och `settle_payoff` släpper den, stänger påminnelserna och låser upp ett väntande
  ägarbyte i samma transaktion. Tre nya `get_inbox`-kinds, så banken har en kö att beta av i stället för bara en
  klocknotis. `request_encumbrance_release` delegerar till `request_payoff` och lämnar nu ett spår.
  `request_trade_in` tar `p_request_payoff`, så långivaren hör av sig redan när handlaren startar inbytet –
  tidigare nåddes `app.open_transfer` (och notisen) inte förrän ägaren godkänt.
- **Export bevarar identiteten.** `exported_at`/`export_country`/`export_customs_ref`; `'exported'` borttaget ur
  listorna som släpper serienumret, märket revokeras inte (`label_disposition = 'kept'`), eget
  `machine.exported`-event, publika kortet säger vart maskinen gick, och ny `reimport_machine`. Rättar det
  rapporterade felet att `check_identifier` svarade "finns inte" på en exporterad maskin (ADR 0026).
- **Banker utanför MaskinID.** `app.resolve_org_by_number` generaliserar `resolve_owner_org`;
  `app.can_be_financier_holder` används **bara** där en bank *namnges* som holder, medan allt som ger makt
  fortsätter gå via `app.has_org_type` – en placeholder kan namnges men ingenting annat (ADR 0027).
  `create_org`-vakten täcker nu placeholders som bär förbehåll, `lookup_company` rapporterar `claimable`, och
  onboardingen visar claim-vägen i stället för bara "Begär åtkomst".
- **Anmäld belåning syns direkt.** `app.pending_financing` + `has_pending` i `machine_view`/`machine_list_extras`,
  tredelad `FinancingBadge`. `initiate_transfer` skapar köparens pending-förbehåll direkt (tidigare först vid
  `accept_transfer`), så banken hör av sig genast. Finansieringskontrollen svarar fortfarande strikt på *aktivt*
  förbehåll – det är bankens juridiska svar (SPEC §6.6, §16.3–4).
- **Bifoga dokument + OCR.** `Ocr.financingDocument` (inga beloppsfält i schemat), Edge Function
  `ocr-financing-document` som tar PDF via `document`-block, `encumbrances.document_ids`, och
  `AttachFinancingDialog`/`ManualFinancingDialog` – båda för handlare, bara dokumentvägen för vanliga
  företagarkonton. `match_financier` löser upp banken ur avtalet; `get_financier_profile` + `financing_defaults`
  kopplar bankens uppgifter till finansieringen automatiskt.
- **Inbyte.** `trade_in_lookup` tar `p_serial` och returnerar lösenärendet och långivarens profil. Sidan har tre
  ingångar: skanna märke, fota VIN/serienummer (`OcrCapture`), skriv serienummer – och erbjuder registrering när
  maskinen inte finns.
- **Rättade defekter i samma flöden:** `confirm_encumbrance` behandlade en överlåtelserad som en vanlig
  pending-rad och utlöste en falsk `double_encumbrance`-konflikt med `critical`-notis till den gamla banken;
  `approve_transfer_financier('release')` stängde inte påminnelserna; `cancel_transfer`/`expire_transfers`
  berättade inget för den väntande långivaren och lämnade köparens pending-förbehåll kvar. UI för
  `reject_encumbrance`, `transfer_encumbrance_holder` och `accept_encumbrance_transfer`, som aldrig anropats
  från webben.
- **API/webhooks:** `POST /encumbrances/request`, `/payoffs*`, `/machines/:id/reimport`, nya webhook-typer och
  ett `exported`-scenario i API-sandlådan.
- **Seed:** DNB Finans och Santander Consumer onboardade, LF Finans och BNP Paribas Leasing bara i
  `app.mock_companies` (så de kan namnges och sedan ta över sitt konto). Nya scenarier: finansiering mot en
  oansluten bank, två lösenärenden i olika läge, en exporterad maskin med bundet märke. 64 maskiner.
- **Tester:** `23_payoff`, `24_placeholder_financiers`, utökade `02_machines`/`00_seed_data`; e2e `payoff.spec.ts`,
  `export.spec.ts` och tillägg i `dealer.spec.ts`. Terminologin rättad till "Långivare" (ADR 0002).

## QR-märket, bankens dokumentväg och granskningens luckor (2026-10-10, efter finansieringsrundan)

- **QR på skärmen.** Ny `QrCode.tsx` (dynamiskt importerad `qrcode`, inline-SVG, så inget hamnar i den publika
  bundlen) på maskinsidan och per märke i `LabelsPage`. Hela 22-teckenskoden visas inte längre som text –
  `labelSerial()` (de sex tecken som står på dekalen) i stället, eftersom koden är bäraren i QR-URL:en.
- **Etikettark.** `labelSheet.ts`: A4 med 18 dekaler, skärmärken, QR + serie + kod i finstilt. Organisationen
  skriver ut sina oanvända märken från `LabelsPage`, operatören ett helt batch-ark bredvid den befintliga CSV:n.
  Geometrin är skärmärken och inte en gissad stans – se ADR 0028.
- **Skanna ett oanvänt märke → registrera maskinen.** Migration 0006 delar `public_machine_card`s hopslagna gren
  (`unbound_label` vs `unknown_label`) och lägger till `check_label`, så guiden kan säga "märket är ledigt" innan
  något är ifyllt. Den publika sidan erbjuder registrering; koden rider i URL:en genom `/go` och klarar både
  inloggning och onboarding. Guiden tar `?code=` och behåller den över autospar och utkaståterupptagning.
- **Tre buggar i märkeshanteringen.** Koden versaliserades på tre ställen fast alfabetet är base62 (varje typad
  eller inklistrad kod gav `LABEL_NOT_FOUND`); platshållaren beskrev ett format som aldrig funnits; och ett
  upptaget märke misslyckades **tyst** vid registrering – `bind_label` returnerar `{ok:false}` utan att raisa,
  men guiden läste aldrig svaret, så användaren fick "klart" medan ett konfliktärende gick till operatören.
- **Riktig avläsning utan att tappa Demo-BankID.** `OCR_PROVIDER=anthropic` vinner nu även när `DEMO_MODE=true`
  (`adapters/index.ts`). Tidigare krävde skarp OCR att hela demoläget slogs av, vilket samtidigt skickar
  identitetskontrollen till riktig BankID och spräcker kontoregistreringen.
- **Banken laddar upp sitt eget finansavtal** (Rikards punkt 11): `EncumbranceDialog` har OCR och uppladdning och
  skickar `p_document_ids`. Dokumentet laddas upp utan maskin-id – `create_document_upload` auktoriserar bara
  maskinbundna uppladdningar för maskinens parter, och `register_encumbrance` adopterar ett org-dokument.
- **Export av en belånad maskin** (punkt 5): `DeregisterDialog` låser submit och erbjuder "Begär lösen för
  export" i stället för att låta användaren gå in i serverfelet; när långivaren godkänt förifylls land och
  tullreferens från lösenärendet. Exporten sker fortfarande på ägarens egen signatur.
- **Lösenbesked även vid vanlig försäljning** (punkt 2, resten): `SalePage` frågar långivaren samtidigt, så
  `purpose='sale'` lever. Långivarens inkorgspost för själva ägarbytet fanns redan.
- **Bankens egna uppgifter** (punkt 6): `financing_defaults` seedas för fyra långivare och kan redigeras i en ny
  inställningsflik. Tidigare returnerade `get_financier_profile` alltid `{}`, så varje förifyllning no-oppade.
- **Tester:** `25_financing_documents_export` (4), utökad `02_machines` (6 nya, inklusive skiftlägeslåset),
  `labelSheet.test.ts` (4), e2e `labels.spec.ts` (4) plus tillägg i `export.spec.ts` och `financier.spec.ts`.
  Granskningen påstod att handlarens manuella finansiering var otestad – `dealer.spec.ts:174` täcker den.
