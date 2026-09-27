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
| 24 | Statistik, dataexport, push, sandbox, partial search, merge | ⬜ | tolkas från CLAUDE.md |
| 25 | Integrationsadaptrar (NFC, telematik, TS, Larmtjänst), publika sidor | ⬜ | |
| 26 | Drift | ⬜ | |
| 27 | Kvalitet | ⬜ | |

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
