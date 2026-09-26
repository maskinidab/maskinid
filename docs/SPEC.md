# SPEC.md — Maskinpass (arbetsnamn)
## Digitalt register för tunga arbetsmaskiner — komplett produkt- och teknikspecifikation

Version 1.1 · 2026-09-22 (v1.0 2026-09-21; ändringar från Transportstyrelsens rapport TSG 2021-1734 m.fl. i §19 och inarbetade nedan, markerade **[v1.1]**)
Detta dokument är sanningskällan för både Claude Code och Lovable. Vid konflikt mellan detta dokument och något annat gäller detta. Bygg **hela** scopet – inga faser – men i den ordning som `CLAUDE.md` anger, eftersom säkerhetsgrunden måste ligga först.

---

## 0. Läs detta först

**Vad vi bygger.** En webbapplikation (PWA, mobil först) där varje tung arbetsmaskin i Sverige får en unik identitet (registreringsnummer + QR-märke), en verifierad ägare, en spårbar historik och en tydlig markering om det finns finansieringsförbehåll (avbetalning, leasing, uthyrning). Vem som helst kan skanna märket och se maskinens status. Handlare, finansbolag, försäkringsbolag och myndigheter får djupare vyer och verktyg. Registret ska motverka dubbelfinansiering, bedrägerier och stölder – och samtidigt vara ett riktigt bra vardagsverktyg för handlare och maskinägare.

**Tre principer som styr varje beslut**
1. **Maskinen i centrum, allt annat är händelser.** Ägarbyten, förbehåll, flaggor, verifieringar och skanningar är rader i en append-only händelselogg. Inget "ändras" i efterhand, det läggs till.
2. **Enkelt in, svårt att fuska.** Vem som helst med en godkänd organisation kan registrera en maskin på under två minuter. Men "verifierad"-status kräver att en betrodd part har kontrollerat underlag eller sett maskinen fysiskt. Verifieringsnivån syns överallt.
3. **Minsta möjliga exponering.** Publik skanning visar bara det som behövs för att bekräfta identitet och status. Allt annat kräver inloggad roll. Varje läsning av en annan organisations maskin loggas, och ägaren ser vem som tittat.

**Positionering.** Fristående, oberoende register. Registrering är gratis. Intäkter från uppslag, API och abonnemang för finansiärer, försäkringsbolag och marknadsplatser. Registret ska vara *kompatibelt*, inte exklusivt: en maskin kan bära andra registers id-nummer som externa identifierare.

**Namn.** `APP_NAME = "Maskinpass"` är ett arbetsnamn som ska gå att byta genom att ändra en konstant. Produkten får aldrig beskrivas som "Svenska Maskinregistret", "det nationella registret" eller "det officiella registret" – varken i UI, e-post, PDF eller marknadstext.

**Språk.** UI på svenska (sv) som standard, engelska (en) som sekundärspråk via i18n från dag ett. Kod, tabellnamn, enums, routes och API på engelska.

**Belopp.** Registret lagrar **inga** finansieringsbelopp, köpeskillingar eller restskulder. Det behövs inte för att stoppa dubbelfinansiering och sänker risk och tröskel för bankerna. Där priser ändå visas (marknadsbevakning) anges alltid om det är inkl. eller exkl. moms.

---

## 1. Värde per aktör

| Aktör | Det de får dag ett (även utan nätverkseffekt) | Det de får när registret växer |
|---|---|---|
| **Maskinleverantör / handlare** | Lager med QR-märkning, "Sälj maskin"-flöde som gör ägarbyte + förbehåll + ägarbevis i ett svep, inbyteskontroll, annons-QR som ger leads | Alla nya maskiner registreras vid försäljning, handlaren blir betrodd verifierare |
| **Maskinägare / entreprenör** | Gratis flottöversikt, ägarbevis-PDF, stöldskydd med QR, dokumentvalv, timmätare/service, delningslänk vid försäljning | Banker och köpare litar på ägarbeviset, snabbare finansiering |
| **Finansbolag / bank** | Sök på serienummer, registrera förbehåll, tidsstämplat kontrollkvitto, portföljvy, webhooks | Dubbelfinansiering stoppas i praktiken |
| **Försäkringsbolag** | Portfölj, stöldflaggor, verifierade maskiner (premiegrund) | Lägre skadekostnad, snabbare skadereglering |
| **Myndighet (Polis, Tull, EBM)** | Sök på serienummer/regnr, stöldflagga, export-/tullkontroll, historik | Nationell spårbarhet |
| **Marknadsplats / auktion** | "Verifierad"-badge via API/inbäddning, kontroll innan annonsering | Tryggare begagnatmarknad, färre bedrägerier |
| **Besiktnings-/kontrollföretag** | Kan verifiera maskiner fysiskt och montera märken | Blir betrodd verifieringspartner |

---

## 2. Aktörer, organisationer, roller

### 2.1 Organisationstyper (`org_type`)
`operator` (vi), `dealer` (maskinleverantör/handlare), `owner` (maskinägare), `financier` (bank/finansbolag), `insurer`, `authority` (Polis, Tull, EBM, Försvarsmakten/MSB, Arbetsmiljöverket, Transportstyrelsen), `inspector` (ackrediterat kontrollorgan/besiktning, verifieringspartner), `marketplace` (API-partner: marknadsplats, auktion, informationsförmedlare som UC/Creditsafe/Bilvision), **[v1.1]** `manufacturer` (tillverkare/generalagent som levererar fabriksdata), **[v1.1]** `client` (beställare/upphandlare: Trafikverket, kommun, byggbolag – läser projektlistor och flottrapporter som ägare delat).

En organisation kan ha **flera** typer (en handlare är också ägare av sitt lager). Modellera som `organizations.types org_type[]`.

### 2.2 Organisationsstatus (`org_status`)
`pending` → `approved` → `suspended`.
- `owner`-organisationer godkänns automatiskt när första användaren är identitetsverifierad (BankID) och organisationsnumret slagits upp.
- `dealer`, `financier`, `insurer`, `authority`, `inspector`, `marketplace` kräver manuellt godkännande av operatören (kö i admin). Tills dess har de `owner`-rättigheter.

### 2.3 Medlemsroller (`member_role`)
`admin` (bjuder in, hanterar org, alla skrivrättigheter), `member` (skriver inom orgens rättigheter), `readonly`.

### 2.4 Operatörsroller (`operator_role`)
`superadmin`, `verifier` (hanterar verifierings- och konfliktkö), `support` (läser, kan inte ändra historik).

### 2.5 Användare
Supabase Auth. Profil med `identity_verified_at` (BankID) och `identity_provider`. Krav: **all skrivning mot registret kräver identitetsverifierad användare.** I demo-läge finns en mock-BankID som sätter samma fält.

### 2.6 Rättighetsmatris (sammanfattning – fullständig RLS i §11)

| Förmåga | Publik | Owner | Dealer | Financier | Insurer | Authority | Inspector | Operator |
|---|---|---|---|---|---|---|---|---|
| Skanna QR / publik maskinsida | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Söka exakt på regnr/serienr | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Söka på delvis serienr / fritext | – | – | – | – | – | ✔ | – | ✔ |
| Registrera maskin (nivå 0) | – | ✔ egen | ✔ | ✔ (efterreg.) | – | – | ✔ | ✔ |
| Registrera vid nyförsäljning (nivå 2) | – | – | ✔ | – | – | – | – | ✔ |
| Verifiera annans maskin | – | – | ✔ | ✔ (dok.) | – | – | ✔ | ✔ |
| Se förbehåll finns (ja/nej) | – | ✔ egen | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Se vem som har förbehållet | – | ✔ egen | ✔ vid inbyte* | ✔ | – | ✔ | – | ✔ |
| Registrera/släppa förbehåll | – | – | – | ✔ | – | – | – | ✔ (korrigering) |
| Initiera ägarbyte | – | ✔ egen | ✔ egen | ✔ (leasingobjekt) | – | – | – | ✔ |
| Flagga stulen | – | ✔ egen | ✔ egen | ✔ (objekt m. förbehåll) | ✔ (försäkrad) | ✔ | – | ✔ |
| Flagga spärrad/under utredning | – | – | – | – | – | ✔ | – | ✔ |
| Se åtkomstlogg för egen maskin | – | ✔ | ✔ | – | – | – | – | ✔ |
| API-nycklar & webhooks | – | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Bulkimport | – | ✔ | ✔ | ✔ | ✔ | – | – | ✔ |
| Marknadsbevakning (dashboard) | – | egen maskin | ✔ | ✔ | ✔ | ✔ | – | ✔ |

\* Dealer ser finansiärens namn först när ägaren har initierat ett ägarbyte/inbyte till handlaren, eller delat en rapportlänk.

---

## 3. Verifieringsnivåer och maskinstatus

### 3.1 Verifieringsnivå (`verification_level` 0–2) – visas som badge överallt
| Nivå | Namn i UI | Hur den uppnås | Badge |
|---|---|---|---|
| 0 | Självregistrerad | Ägare/handlare har lagt in maskinen utan granskat underlag | Grå |
| 1 | Dokumentverifierad | Faktura/köpeavtal + foton granskade av operatör, handlare, finansiär eller inspector | Blå |
| 2 | Fysiskt verifierad | Betrodd part (dealer/inspector/operator) har sett maskinen, matchat serienummer mot skylt och monterat märket. Nyförsäljning av handlare = nivå 2 direkt | Grön |

Varje organisation kan sätta `settings.min_trusted_level` – t.ex. en finansiär som bara vill "lita på" nivå ≥1 ser tydlig varning under den nivån.

### 3.2 Maskinstatus (`machine_status`)
`draft` (påbörjad registrering), `active`, `stolen`, `blocked` (spärrad av myndighet/operatör), `disputed` (ägartvist/duplikat), `scrapped`, `exported`, `deregistered`.

Statusprioritet vid visning: `stolen` > `blocked` > `disputed` > `scrapped`/`exported`/`deregistered` > `active` > `draft`.

### 3.3 Ursprung (`machine_origin`)
`new_sale` (registrerad av säljande handlare vid nyförsäljning), `retro` (efterregistrering av befintlig maskin), `import` (bulkimport), `transfer_in` (kom in via ägarbyte till ny org).

---

## 4. Datamodell (Postgres / Supabase)

Konventioner: `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at` via trigger. Inga hårda raderingar av registerdata (endast status). Alla enums som Postgres `enum`-typer. Alla tabeller har RLS aktiverat med default deny.

### 4.1 Organisationer & användare
```
organizations
  id, types org_type[], name, org_number text unique nullable,  -- svenskt orgnr; enskild firma = personnummer → maskeras i UI (se §11.7)
  country char(2) default 'SE', vat_number, address jsonb, email, phone, website,
  status org_status default 'pending', approved_by, approved_at,
  settings jsonb default '{}',   -- min_trusted_level, notification prefs, show_authority_reads_to_owner=false
  created_at, updated_at

profiles
  user_id pk → auth.users, full_name, email, phone, locale default 'sv',
  identity_verified_at, identity_provider text,  -- 'bankid' | 'mock'
  personal_number_hash text nullable,             -- sha256+salt, aldrig klartext
  created_at

memberships
  id, org_id → organizations, user_id → auth.users, role member_role, status (invited|active|removed),
  invited_by, invite_token, invite_email, created_at   unique(org_id,user_id)

operator_roles
  user_id pk, role operator_role, granted_by, created_at
```

### 4.2 Maskiner & identitet
```
machine_models          -- modellkatalog för förifyllning
  id, make, model, category machine_category, subcategory, weight_kg, engine_kw, aliases text[],
  source (manual|imported|ml_list), created_at

machines
  id, reg_number text unique,               -- se §5.1
  model_id → machine_models nullable, make, model, variant, year int, category machine_category,
  color, description,
  -- [v1.1] tekniska fält enligt Transportstyrelsens Bilaga 1 (behövs för upphandling, miljökrav och VTR-samkörning)
  service_weight_kg int nullable, engine_power_kw numeric nullable, power_standard (iso_14396|ece_r120|sae_j1349|other) nullable,
  has_lifting_device bool default false,          -- utlöser besiktningskrav enligt AFS
  fuel_type fuel_type nullable, electric_config electric_config nullable, emission_stage emission_stage nullable,
  engine_make, engine_model, engine_type_approval_no text nullable,
  ce_marked bool nullable, ce_declaration_document_id nullable,
  registration_type (permanent|temporary) default 'permanent', valid_until date nullable, origin_country char(2) nullable,  -- tillfällig registrering av utländsk maskin
  status machine_status default 'draft',
  verification_level smallint default 0, verified_by_org_id, verified_at, verification_method (documents|physical|new_sale) nullable,
  origin machine_origin,
  owner_org_id → organizations,             -- juridisk ägare
  user_org_id → organizations nullable,     -- brukare om annan än ägare (leasing/uthyrning)
  registered_by_org_id, registered_by_user_id,
  first_sale_date, first_sale_dealer_org_id nullable,
  hour_meter int nullable, hour_meter_updated_at,
  primary_photo_path text nullable,
  created_at, updated_at

machine_identifiers
  id, machine_id, type identifier_type,     -- pin | serial | engine_serial | vin | road_reg (Transportstyrelsen) | external_registry | chassis | other
  value text, normalized_value text,        -- upper, trim, bort med mellanslag/bindestreck, O→0? NEJ: normalisera bara case/whitespace, låt OCR-steget föreslå
  source (nameplate_ocr|manual|invoice|import|api|vtr_lookup), verified bool default false, external_system text nullable,
  vtr_snapshot jsonb nullable,   -- [v1.1] senaste uppslag mot vägtrafikregistret (fordonsslag, ägarkategori, status, datum för senaste ägarbyte) – aldrig personuppgifter
  created_at
  -- partiellt unikt index: (type, normalized_value) för type in (pin,serial,vin) där maskinens status not in (scrapped,exported,deregistered)
  -- konflikt vid insert → RPC skapar rad i `conflicts` och sätter nya maskinen till 'disputed' i stället för att blockera helt

ownerships               -- historik, en rad per ägarperiod
  id, machine_id, owner_org_id, from_date, to_date nullable, acquired_via (registration|transfer|import|correction),
  transfer_id nullable, document_id nullable, created_at

labels                   -- QR-märken
  id, code text unique,                     -- 22 tecken base62 (128 bit), står i QR-URL:en
  batch_id → label_batches, machine_id nullable,
  status (printed|assigned|bound|revoked|lost), assigned_org_id nullable,
  bound_at, bound_by_user_id, revoked_at, revoked_reason, replaced_by_label_id nullable, created_at

label_batches
  id, quantity, printed_at, printer_ref, assigned_org_id nullable, created_by, created_at
```

### 4.3 Ägarbyten, förbehåll, flaggor
```
encumbrances
  id, machine_id, type encumbrance_type,     -- ownership_reservation (avbetalning m. äganderättsförbehåll) | leasing | rental | other
  holder_org_id → organizations,            -- finansiär / uthyrare
  counterparty_org_id nullable,             -- kund / leasetagare / hyrestagare
  contract_ref text, start_date, end_date nullable,  -- [v1.1] obligatoriskt för ownership_reservation (slutdatum för återtaganderätten), påminnelse till holder 30 dagar före
  transferred_from_encumbrance_id nullable,          -- [v1.1] förbehållet överlåtet från annan finansiär (kedja)
  status (pending|active|released|rejected|transferred), registered_by_user_id, signature_id nullable,
  released_at, released_by_user_id, release_signature_id, notes, created_at
  -- partiellt unikt index: (machine_id) where status='active' and type in ('ownership_reservation','leasing')
  -- ⇒ högst ETT aktivt finansieringsförbehåll per maskin. Försök nr 2 → RPC returnerar konflikt + notis till befintlig holder + rad i conflicts.

transfers
  id, machine_id, from_org_id, to_org_id nullable, to_org_number text nullable, to_email text nullable,  -- köpare som inte finns än bjuds in
  initiated_by_user_id, sale_date, reported_at default now(),
  effective_date date,   -- [v1.1] = sale_date om anmälan gjorts inom 10 dagar från sale_date, annars reported_at (motverkar bakdatering; samma regel som Transportstyrelsens förslag)
  status (draft|awaiting_buyer|awaiting_financier|completed|cancelled|expired),
  new_encumbrance_id nullable,              -- finansiering i samma flöde
  existing_encumbrance_id nullable,         -- måste släppas/godkännas av holder
  buyer_signature_id, financier_signature_id, seller_signature_id,
  invite_token, expires_at default now()+14d, completed_at, cancelled_reason, created_at

flags
  id, machine_id, type flag_type,            -- stolen (= efterlysning när raised_by är authority) | seized (beslag, endast authority) [v1.1] | blocked | under_investigation | disputed | scrapped | exported
  raised_by_org_id, raised_by_user_id, reference text (t.ex. polisanmälningsnummer), description,
  raised_at, status (active|cleared), cleared_at, cleared_by_user_id, cleared_reason, created_at
```

### 4.4 Verifiering, konflikter, kontroller
```
verification_requests
  id, machine_id, requested_level smallint, requested_by_org_id, requested_by_user_id,
  status (open|in_review|approved|rejected|needs_info), assigned_to_user_id, reviewer_org_id,
  decision_note, decided_at, created_at

conflicts
  id, type (duplicate_identifier|double_encumbrance|ownership_dispute|market_anomaly|label_reuse),
  machine_id, related_machine_id nullable, details jsonb, status (open|resolved|dismissed),
  resolved_by_user_id, resolution_note, created_at, resolved_at

check_receipts            -- finansieringskontroll med kvitto
  id, receipt_number text unique (t.ex. K-2026-000123), machine_id nullable,
  query jsonb (vad som söktes), performed_by_org_id, performed_by_user_id,
  result jsonb (ögonblicksbild: status, level, has_active_financing, flags, owner_org_name),
  pdf_path, created_at

signatures
  id, provider (bankid|mock), subject_type text, subject_id uuid, signer_user_id,
  signed_text text, signed_at, status (pending|completed|failed|cancelled), evidence jsonb, created_at
```

### 4.5 Dokument, händelser, åtkomst
```
documents
  id, machine_id nullable, org_id, type document_type,  -- invoice | purchase_agreement | financing_contract | ce_declaration | manual | insurance_policy | inspection_report | photo_nameplate | photo_machine | police_report | other
  storage_path, filename, mime, size_bytes, sha256, uploaded_by_user_id,
  visibility (owner|owner_and_financier|verifiers|public) default 'owner', created_at
  -- privat bucket `documents`, signerade URL:er 5 min

events                    -- APPEND-ONLY, hashkedjad
  seq bigserial pk, id uuid unique, machine_id nullable, org_id nullable, type text,
  actor_user_id nullable, actor_org_id nullable, actor_type (user|system|api),
  payload jsonb, prev_hash text, hash text, created_at
  -- trigger: BEFORE UPDATE/DELETE → RAISE EXCEPTION. hash = sha256(prev_hash || seq || type || payload::text || created_at)

event_anchors
  day date pk, last_seq bigint, root_hash text, published_at, external_ref text  -- se §11.4

access_log
  id, machine_id, viewer_user_id nullable, viewer_org_id nullable,
  viewer_type (public|owner|dealer|financier|insurer|authority|inspector|operator|api),
  via (web|scan|api|share_link|check), purpose text nullable,
  ip_hash text, approx_location jsonb nullable, user_agent_family text,
  visible_to_owner bool default true,   -- false för authority (om orgens setting säger så) och operator-support
  created_at

share_links
  id, machine_id, created_by_user_id, token text unique, scope (public_card|buyer_report),
  expires_at, max_views int nullable, views int default 0, revoked_at, created_at
```

### 4.6 Flotta & vardagsverktyg
```
machine_assignments      -- projekt/arbetsplats/avdelning
  id, machine_id, org_id, name, site_address, from_date, to_date nullable, created_at

maintenance_entries
  id, machine_id, type (service|repair|inspection|hour_reading|other), performed_at, hours int nullable,
  performed_by_org_id nullable, performed_by_text, notes, document_id nullable,
  next_due_at nullable, next_due_hours nullable, created_by_user_id, created_at

inspections               -- [v1.1] besiktning av ackrediterat kontrollorgan (AFS-krav för lyftanordningar: grävmaskiner, kranar, teleskoplastare m.fl.)
  id, machine_id, inspection_body_org_id → organizations (type inspector) nullable, inspection_body_name,
  type (first|periodic|revision|extraordinary), performed_at, certificate_no, result (approved|approved_with_remarks|rejected),
  remarks text, valid_until date, hours_at_inspection int, document_id, recorded_by_user_id, created_at
  -- kontrollhistoriken följer maskinen vid ägarbyte; inspector-org skriver direkt via RPC/API

reminders
  id, machine_id, org_id, type (service|inspection|insurance|lease_end|encumbrance_end|temporary_registration_end|custom), title,
  due_at nullable, due_hours nullable, status (open|done|snoozed), created_at

rentals
  id, machine_id, lessor_org_id, lessee_org_id, from_date, to_date, status (planned|active|returned|overdue),
  encumbrance_id (type rental), returned_at, created_at

insurance_policies
  id, machine_id, insurer_org_id nullable, insurer_name, policy_number, valid_from, valid_to,
  coverage (liability|machine|theft|full), status (active|expired|cancelled), document_id, created_at

watchlist                -- "bevaka serienummer"
  id, org_id, user_id, identifier_type, identifier_value, note, created_at

imports
  id, org_id, created_by_user_id, file_path, status (uploaded|mapped|validated|committed|failed),
  mapping jsonb, rows_total, rows_ok, rows_error, created_at, committed_at
import_rows
  id, import_id, row_no, data jsonb, errors jsonb, machine_id nullable, status (pending|ok|error|skipped)
```

### 4.7 Marknadsbevakning
```
market_sources
  id, key text unique, name, base_url, connector text, enabled bool, schedule_cron,
  tos_status (unknown|allowed|partner_feed|restricted), robots_ok bool, last_run_at, last_run_status, notes

market_observations
  id, source_id, listing_external_id, listing_url, first_seen_at, last_seen_at, active bool,
  category machine_category nullable, make, model, year, hours, price_amount numeric nullable, price_currency, price_vat_included bool nullable,
  location_text, seller_type (business|private|unknown),
  seller_name text nullable,          -- ENDAST om seller_type = business
  seller_org_number text nullable,    -- om uppslaget mot bolagsregister
  serial_candidate text nullable, serial_source (listing_text|image_ocr|feed) nullable, serial_confidence numeric,
  images jsonb, raw jsonb, content_hash text,
  matched_machine_id nullable, match_confidence numeric, created_at
  unique(source_id, listing_external_id)

market_alerts
  id, type (duplicate_serial_in_market|stolen_machine_listed|listed_with_active_financing|listed_after_transfer|price_anomaly|seller_not_owner),
  machine_id nullable, observation_ids uuid[], details jsonb, status (open|reviewed|dismissed|escalated),
  reviewed_by_user_id, created_at

oem_records               -- [v1.1] fabriks-/leveransdata från tillverkare och generalagenter (så startade Norge: allt sålt lästes in på individnivå)
  id, manufacturer_org_id → organizations (type manufacturer), make, model, variant, year, serial_number, normalized_serial,
  engine_make, engine_model, engine_serial, emission_stage, engine_power_kw, service_weight_kg, fuel_type,
  delivered_at date, delivered_to_dealer_org_id nullable, delivered_to_country char(2), ce_declaration_document_id nullable,
  source (api|import), matched_machine_id nullable, created_at   unique(manufacturer_org_id, normalized_serial)
  -- vid registrering slås serienummer upp här ⇒ tekniska fält förifylls och händelsen 'factory_data_confirmed' loggas
```

### 4.8 Notiser, API, webhooks
```
notifications
  id, user_id, org_id, type, title, body, link, severity (info|warning|critical), read_at, created_at
notification_preferences
  user_id, org_id, channel (inapp|email|sms), event_types text[], digest (instant|daily)

api_keys
  id, org_id, name, key_prefix (8 tecken visas), key_hash, scopes text[],  -- machines:read, machines:write, encumbrances:write, checks:write, flags:write, webhooks:manage
  rate_limit_per_min int default 60, last_used_at, created_by, revoked_at, created_at
api_requests
  id, api_key_id, endpoint, method, status_code, latency_ms, ip_hash, created_at

webhooks
  id, org_id, url, secret, event_types text[], active bool, created_at
webhook_deliveries
  id, webhook_id, event_id, attempt int, status (pending|delivered|failed), response_code, next_retry_at, created_at
```

### 4.9 Enums (fullständig lista)
- `machine_category`: excavator_tracked, excavator_wheeled, wheel_loader, backhoe, dumper, dozer, grader, roller, paver, crane_mobile, telehandler, forklift, tractor, forestry_harvester, forestry_forwarder, skidder, drill_rig, crusher, screener, generator, compressor, trailer_heavy, attachment, other
- **[v1.1]** `fuel_type`: diesel, hvo, petrol, gas, electric, hybrid, hydrogen, other, unknown
- **[v1.1]** `electric_config`: battery, cable, battery_and_cable, fuel_cell, plugin_hybrid
- **[v1.1]** `emission_stage` (EU 2016/1628 / 97/68/EG): pre_stage, stage_i, stage_ii, stage_iiia, stage_iiib, stage_iv, stage_v, zero_emission, unknown
- `identifier_type`, `encumbrance_type`, `flag_type`, `document_type`, `machine_status`, `machine_origin`, `org_type`, `org_status`, `member_role`, `operator_role` – enligt ovan.

---

## 5. Identitet: registreringsnummer och QR-märken

### 5.1 Registreringsnummer
- **Alfabet:** `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (32 tecken, inga 0/O/1/I).
- **Format:** 7 tecken = 6 slumptecken + 1 kontrolltecken (Luhn mod N, N=32). Visas som `XXX-XXXX`, lagras utan bindestreck.
- Genereras server-side vid `register_machine`. Blandad ordning av bokstäver/siffror i båda grupperna gör att det inte liknar svenska bilregnr (ABC 123 / ABC 12A).
- Inmatning i sök: acceptera med/utan bindestreck, gemener, mellanslag. Validera kontrolltecken innan uppslag → "Ogiltigt nummer" utan databasanrop.

### 5.2 QR-märket
- Fysiskt märke: manipuleringssäker (bryts vid borttagning), UV-/väderbeständigt, ~60×40 mm. Innehåll: logotyp, regnr i klartext (stort), QR-kod, litet märkes-serienummer (`label.code` sista 6 tecken).
- **QR-innehåll:** endast `https://<domän>/m/<label.code>`. Inget regnr eller serienummer i QR:n.
- Märken trycks i batcher (`label_batches`), tilldelas en organisation (`assigned`) och blir aktiva först när de knyts till en maskin (`bound`). Ett märke kan bara knytas en gång. Ersättningsmärke ⇒ gamla revokeras; skanning av revokerat märke visar "Märket är ersatt" + länk till korrekt maskin (endast om samma maskin).
- **Äkthetskontroll i skanningssidan:** visar de 3 sista tecknen i huvudserienumret + primärfoto, så att den som står vid maskinen kan jämföra med skylten. En kopierad QR på fel maskin avslöjas.
- Rekommendation: ett dolt sekundärt märke (mindre QR eller NFC) på icke-uppenbar plats, registreras som `labels.role = 'secondary'`. (Lägg till kolumn `role (primary|secondary)`.)
- **[v1.1] Placering:** primärt märke baktill, väl synligt och läsbart även under färd/last (samma princip som statens skyltförslag). Appen visar placeringsguide per kategori med bild. Foto på monterat märke sparas som `photo_label` vid nivå 2.
- Handlare kan beställa märken i appen ("Beställ 50 märken") – skapar en `label_batches`-rad med status `ordered` för operatören att trycka.

### 5.3 Publik skanningssida `/m/:code` (och `/r/:reg_number`)
Visar **utan inloggning**:
- Regnr, tillverkare, modell, årsmodell, kategori, primärfoto.
- Statusbanner: `AKTIV` (grön), `ANMÄLD STULEN` (röd, fullskärm, "Ring polisen 114 14", knapp "Jag har sett maskinen" som loggar plats med samtycke), `SPÄRRAD`, `SKROTAD`, `AVREGISTRERAD`.
- Verifieringsbadge (nivå 0/1/2) med förklaring.
- Serienummer: `••••••3K7` (3 sista tecken).
- Ägare: **bara** "Registrerad ägare finns (organisation)" – aldrig namn publikt.
- "Finansieringsförbehåll: logga in för att se" (knapp → BankID-inloggning, se §6.6).
- "Är du ägaren? Se vem som skannat" (länk till inloggning).
- Sidan är noindex, rate-limitad, loggar `access_log` (viewer_type public, via scan).

---

## 6. Kärnflöden

Alla flöden skriver via Postgres RPC-funktioner (SECURITY DEFINER, med auktorisation inuti) som i **en transaktion** validerar, skriver, loggar `events` och skapar `notifications`. Klienten skriver aldrig direkt i registertabeller.

### 6.1 Onboarding av organisation (mål: < 3 minuter)
1. Användaren skapar konto (e-post + lösenord eller magic link) → verifierar identitet med BankID (mock i demo).
2. "Skapa organisation": skriv organisationsnummer → `company-lookup` hämtar namn/adress (Bolagsverket/Roaring-adapter, mock i demo). Välj typ(er). Enskild firma flaggas och orgnr maskeras.
3. `owner` ⇒ godkänd direkt. Andra typer ⇒ `pending`, tydlig text "Vi granskar inom en arbetsdag", användaren kan redan börja lägga in maskiner (som owner).
4. Bjud in kollegor (e-post, roll). Inbjudna med `@samma-domän` föreslås automatiskt.
5. Onboarding-checklista på dashboard: "Lägg till första maskinen · Importera lista · Beställ märken · Koppla API".

**Handlare specifikt:** landningsflöde "Kom igång som handlare" som på en sida gör steg 2–5 plus "Importera lager" (drag & drop Excel/CSV/PDF-lista, AI-kolumnmappning) och "Beställ startpaket märken".

### 6.2 Registrera maskin (wizard, mål: < 2 minuter på mobil)
Steg 1 – Identitet
- Knapp "Fota maskinskylten" → Edge Function `ocr-nameplate` (Anthropic vision) returnerar förslag: tillverkare, modell, PIN/serienr, år, motornr, vikt. Användaren bekräftar fält för fält. Foto sparas som `photo_nameplate`.
- **[v1.1]** Serienumret slås samtidigt upp i `oem_records` (fabriksdata) och, om maskinen har vägtrafikregnr, i vägtrafikregistret via adaptern `VehicleRegistryLookup` (mock i demo). Träff i fabriksdata ⇒ alla tekniska fält förifylls. Träff i VTR ⇒ regnr sparas som `road_reg`, ägarkategori jämförs och varning visas om VTR-ägaren inte matchar angiven ägare.
- Alternativt manuellt. Serienummer valideras i realtid mot registret: träff ⇒ "Den här maskinen finns redan (regnr XXX-XXXX). Är det din? [Begär ägarbyte] [Rapportera fel]". Ingen dubblett skapas.
Steg 2 – Maskin
- Modell väljs ur `machine_models` (sök med alias), förifyller kategori/vikt/kW. Årsmodell, timmar, färg, foto på maskinen.
Steg 3 – Ägare & finansiering
- Ägare = min organisation (default) eller annan (orgnr → uppslag). Om annan: maskinen registreras med `owner_org_id` = den orgen och en inbjudan skickas; registrerande org blir `registered_by`.
- "Finns finansieringsförbehåll?" Ja ⇒ välj finansiär (sök bland `financier`-orgar), avtalsref, typ ⇒ skapar `encumbrances` med status `pending` som finansiären bekräftar (notis + webhook). Nej ⇒ inget.
Steg 4 – Märke
- "Skanna märket du satt på maskinen" (kamera) eller "Jag har inget märke än" (skippa, påminnelse). Skanning ⇒ `bind_label`.
Klart-sida: regnr stort, badge nivå 0, knappar "Ladda upp faktura för nivå 1", "Ladda ner ägarbevis", "Registrera nästa".
- Utkast autosparas (`status draft`), kan återupptas.

### 6.3 Nyförsäljning hos handlare (`new_sale`) ⇒ nivå 2 direkt
Samma wizard men startas från "Lager → Sälj" eller "Ny försäljning": handlaren är säljare, köparen anges (orgnr), faktura bifogas, finansiär valfri. Resultat: maskin `active`, `verification_level 2`, `verification_method new_sale`, `owner_org_id` = köparen, `first_sale_dealer_org_id` = handlaren, ägarbevis-PDF genereras och mejlas till köparen med inbjudan att logga in. Om finansiär angavs ⇒ förbehåll `pending` → finansiären bekräftar med ett klick (eller via API).

### 6.4 Efterregistrering & verifiering (nivå 0 → 1 → 2)
- Ägaren laddar upp faktura/köpeavtal/tidigare ägarbevis + skyltfoto + maskinfoto ⇒ `verification_requests` (requested_level 1).
- Kö i operatörsadmin **och** hos betrodda partner (dealer/inspector/financier som orgen valt). Granskaren ser dokumenten sida vid sida med registerdata, godkänner/avslår/begär komplettering. Godkänt ⇒ `verification_level 1`, `verified_by_org_id`.
- Nivå 2: partner (dealer/inspector) besöker maskinen, skannar märket, fotar skylten i appen (OCR-matchning mot registrerat serienummer måste stämma), bekräftar ⇒ nivå 2. Ägaren kan "Boka verifiering" – skapar förfrågan till partner i närheten (lista partner med adress; ingen kartintegration krävs i v1).

### 6.5 Bulkimport (handlare, finansiärer, ägare)
1. Ladda upp CSV/XLSX (eller klistra in text). 2. Kolumnmappning: automatiskt förslag (AI via Edge Function `import-map`) + manuell justering, mall att ladda ner. 3. Validering rad för rad: obligatoriska fält, serienummer-dubbletter (inom filen och mot registret), orgnr-format. Förhandsgranskning med fel markerade, "Importera bara giltiga rader". 4. Commit skapar maskiner (`origin import`, nivå 0) i en batch-RPC, en `events`-rad per maskin plus en `import_committed`. 5. Resultat: nedladdningsbar felrapport.
Finansiärsimport kan sätta `encumbrances` direkt (status active, holder = importerande finansiär) – det är deras egen portfölj.

### 6.6 Finansieringskontroll (finansiär, även via API)
1. Sök: regnr, PIN/serienummer, VIN eller vägtrafikregnr (exakt). Alternativt CSV med upp till 500 rader.
2. Resultat: status, nivå, ägare (namn + orgnr), **aktivt finansieringsförbehåll: JA/NEJ**, om JA: holder, typ, startdatum (belopp finns inte). Flaggor. Senaste ägarbyte. Marknadsobservationer (om maskinen är ute till försäljning just nu – viktig bedrägerisignal).
3. Varje sökning skapar `check_receipts` med kvittonummer och PDF ("Kontroll utförd 2026-09-21 14:02 av Nordea Finance, resultat: …"). Loggas i `access_log` (synligt för ägaren: "Nordea Finance kontrollerade din maskin").
4. "Registrera förbehåll" direkt från resultatet ⇒ `register_encumbrance` (signering, mock-BankID). Om aktivt förbehåll redan finns ⇒ **blockeras** med tydlig varning, `conflicts` (double_encumbrance), notis + webhook till befintlig holder, notis till ägaren. Detta är kärnfunktionen – testas hårdast.
5. Endast holder kan `release_encumbrance` (signering). Ägaren kan "Begär frisläppning" som skickar notis.
6. Ej inloggad köpare som skannat och vill veta ja/nej: BankID-inloggning som privatperson ⇒ ser "Förbehåll finns/finns inte" men aldrig holder. Loggas.

### 6.7 Ägarbyte (`transfers`)
1. Säljare (ägare eller handlare för lagermaskin) väljer maskin → "Sälj / överlåt" → anger köparens orgnr (uppslag) eller e-post om köparen saknar konto, försäljningsdatum, ev. ny finansiär för köparen (skapar pending förbehåll), bifogar köpeavtal (valfritt).
2. Om aktivt förbehåll finns: status `awaiting_financier`; holder får notis/webhook, väljer "Släpp" eller "Överför förbehållet till köparen" (leasing-övertag) eller "Neka". **[v1.1]** Vid leasing/nyttjanderätt ≥ 1 år får ny ägare inte registreras utan uthyrarens godkännande; vid kreditköp med förbehåll får förbehållet stå kvar med ny counterparty om holder väljer det. Holder kan även, oberoende av ägarbyte, **överlåta förbehållet till annan finansiär** (`transfer_encumbrance_holder`: gammal rad `transferred`, ny rad `active`, båda signerar, ägaren notifieras).
3. Köparen får notis/e-post med länk, ser maskinkort + historik + förbehåll, accepterar med signering (mock-BankID). Status `completed` ⇒ `ownerships` stängs/öppnas, `owner_org_id` byts, gammal ägare ser maskinen under "Tidigare maskiner" (read-only, historik fram till överlåtelsen), nytt ägarbevis-PDF, event `ownership_transferred`.
4. Utgår efter 14 dagar; kan avbrytas av säljaren innan köparen accepterat.
5. **Inbyte hos handlare:** samma flöde initierat av ägaren mot handlaren, eller av handlaren ("Ta emot inbyte": skanna märket, ägaren får push/e-post att godkänna). Handlaren ser holder och kan begära frisläppning som del av affären.

### 6.8 Flaggor
- **Stulen:** ägare, brukare, holder, försäkringsbolag eller myndighet flaggar. Fält: polisanmälningsnummer, datum/plats, beskrivning. Effekt: status `stolen`, publik sida i röd fullskärmsvarning, alla skanningar loggas med tidsstämpel + ungefärlig plats (om skannaren tillåter) och notifierar ägaren och flaggaren, webhook till holder/insurer, matchning mot `market_observations` startar (finns den till salu?). Ägarbyte och nya förbehåll blockeras.
- **Spärrad / under utredning:** endast myndighet/operatör. Ägarbyte blockeras, orsak visas bara för myndighet/operatör/ägare.
- **Skrotad / exporterad:** ägare (kräver signering) eller holder om förbehåll finns (ägaren notifieras). Serienummer frigörs från unikhetsindexet. Tullverket kan se `exported` med datum.
- Avflaggning: samma part som flaggade, eller myndighet/operatör. Allt loggas.

### 6.9 Avregistrering
"Avregistrera" med orsak (skrotad/exporterad/felregistrerad/militär/stulen ej återfunnen/annan). Kräver att inga aktiva förbehåll finns eller att holder godkänner. Maskinen försvinner inte, den får status och blir read-only. **[v1.1]** Märket revokeras i samma steg ("märket är förstört" eller "märket är borttaget"), så att ett avregistrerat märke aldrig kan sitta kvar på en maskin. **Tillfällig registrering** (`registration_type temporary`, utländsk maskin inne för ett projekt): giltig till `valid_until`, påminnelse 30 dagar före, förlängning eller automatisk avregistrering med status `exported`.

### 6.10 Delning
- **Delningslänk (buyer_report):** ägaren skapar tidsbegränsad länk (7/30 dagar, ev. maxvisningar) som visar en "Maskinrapport": all historik, verifieringar, förbehåll (ja/nej + holder-namn), dokument med visibility ≥ verifiers, timmar, service. Perfekt att lägga i annons. Loggas.
- **Annons-QR:** handlare genererar QR/badge ("Verifierad i Maskinpass · XXX-XXXX") för annonser; skanning ⇒ publik sida + "Kontakta säljare" (formulär → lead till handlaren, se §7.3).

### 6.11 Uthyrning
Ägare "Hyr ut" → hyrestagare (orgnr), period ⇒ `rentals` + `encumbrances(type rental)` + `user_org_id` = hyrestagaren. Hyrestagaren ser maskinen under "Hyrda maskiner" (kan rapportera timmar/skador, kan inte överlåta). Återlämning stänger båda. Förfallen hyra ⇒ påminnelse.

### 6.12 Vakt- och bevakningsflöden
- **Bevaka serienummer:** vem som helst inloggad kan lägga ett serienummer/regnr på bevakning ⇒ notis om det dyker upp i registret, i marknadsbevakning eller flaggas.
- **Skanning av stulen maskin:** se §6.8.

---

## 7. Utökade moduler ("mer än ett register")

### 7.1 Flotta (för alla ägare, gratis)
- **Mina maskiner:** kort/tabell med badge, status, timmar, plats/projekt, nästa åtgärd. Filter, sortering, sök, export CSV.
- **Maskinsida (tidslinje):** allt om maskinen i en kronologisk vy – registrerad, verifierad, förbehåll, ägarbyten, service, timavläsningar, skanningar, dokument.
- **Timmätare:** snabbinmatning (även via skanning av märket → "Rapportera timmar"). Historik och graf.
- **Service & kontroller:** logg med typ, datum, timmar, utförare, dokument. Påminnelser på datum eller timmar ("service vid 2 000 h"). Digest-e-post varje måndag med kommande.
- **[v1.1] Besiktning (kontrollorgan):** maskiner med `has_lifting_device` får ett besiktningskrav enligt Arbetsmiljöverkets föreskrifter. `inspections` fylls av ackrediterade kontrollorgan (inspector-org) direkt eller av ägaren med uppladdat protokoll. Badge "Besiktigad t.o.m. YYYY-MM" på maskinsidan och i flottrapporter, publikt om ägaren väljer. Påminnelse 60/30/7 dagar före utgång. Detta är kärnan i norska registret och det Arbeidstilsynet använder – vi bygger samma sak för Sverige.
- **[v1.1] Flott-/upphandlingsrapport:** ägaren genererar en signerad PDF (eller delningslänk) som listar maskiner med utsläppssteg, bränsle, eldrift, vikt, effekt, besiktningsstatus och verifieringsnivå – det beställare (Trafikverket, kommuner, stora byggbolag) kräver i upphandling och uppföljning. Filter per projekt. Beställare med `client`-org kan bevaka rapporten löpande (read-only). I Norge är upphandlingskravet skälet till ~80 % täckning i entreprenadsektorn.
- **Dokumentvalv:** CE-försäkran, instruktionsbok, försäkringsbrev, besiktningsprotokoll, kvitton – följer maskinen vid ägarbyte om visibility tillåter (ägaren väljer vid överlåtelse vilka dokument som följer med).
- **Projekt/arbetsplats:** tilldela maskiner till projekt, se vilka maskiner som står var. Dela projektlista med beställare (read-only länk) – beställare kräver allt oftare att maskiner är registrerade.
- **Försäkring:** registrera försäkringsbolag/nummer/giltighet; badge "Försäkrad" (endast synlig för ägare/insurer/authority).

### 7.2 Handlarverktyg
- **Lager:** alla maskiner där `owner_org_id` = handlaren, med status Lager/Såld/Inbyte/Demo. Snabbknappar: Sälj, Skapa annons-QR, Skriv ut märke-etikett, Dela rapport.
- **Sälj maskin** (§6.3/§6.7) – ett flöde för ägarbyte + finansiering + ägarbevis + faktura som dokument.
- **Ta emot inbyte:** skanna märke ⇒ full historik + förbehåll ⇒ "Begär frisläppning" ⇒ ägarbyte till handlaren. Osäker maskin (nivå 0, utan märke) ⇒ handlaren kan verifiera på plats och höja till nivå 2 som del av inbytet.
- **Leads:** skanningar via annons-QR/"Kontakta säljare" hamnar i en enkel leadlista (namn, kontakt, meddelande, maskin). Export/webhook till DMS.
- **Kunder:** lättviktigt kundregister som byggs automatiskt av försäljningar (orgnr, kontakt, maskiner sålda).
- **Team:** roller, vem sålde vad (event-baserat).
- **DMS-koppling:** API-nyckel + webhooks; dokumenterat exempel "skapa maskin vid leverans, registrera ägarbyte vid faktura".

### 7.3 Marknadsplatser & inbäddning
- `GET /embed/badge/:reg_number.svg` – badge "Verifierad nivå 2 · Ingen stöldflagga" (cachad 5 min, noindex). Klick ⇒ publik sida.
- `POST /v1/check` för marknadsplatser: innan annons publiceras kontrolleras serienummer ⇒ stulen/spärrad ⇒ neka annons.
- Partnerprogram: marknadsplats-orgar får webhooks på `flag.raised` för maskiner de listat.

### 7.4 Försäkringsbolag
Portfölj (maskiner med `insurance_policies.insurer_org_id`), stöldflaggning, skadeanmälan-länk (extern URL per bolag), export. Kan begära nivå-2-verifiering som villkor (visas som "Försäkringsbolaget X kräver verifiering").

### 7.5 Myndighetsportal
Sök på partiellt serienummer/regnr/tillverkare+modell+år, se alla flaggor, historik och åtkomstlogg (inkl. vem som skannat en stulen maskin och var). Sätt `blocked`/`under_investigation`. Export (CSV/PDF). Tullverket: "Exportkontroll" – slå upp maskin vid gräns, se förbehåll ja/nej (export med aktivt förbehåll ⇒ varning). Myndighetsläsningar döljs för ägaren om orgens setting säger det. **[v1.1]** Polisen kan sätta `stolen` (efterlysning) och `seized` (beslag); båda blockerar ägarbyte, förbehåll och avregistrering. Stulen maskin som inte återfunnits inom 24 månader ⇒ operatören får förslag om avregistrering (ägaren notifieras, 30 dagars invändningstid). **Beredskapsexport:** aggregerad rapport (antal, kategori, vikt, län) för Försvarsmakten/MSB – inga ägaruppgifter i aggregatet. **Registerutdrag:** formellt PDF-utdrag om en maskin utan personnummer, med utdragsnummer och hash.

### 7.6 Marknadsbevakning – se §8.

### 7.7 Värdeindex (byggs på §8, senare aktivering)
Aggregat per modell/år/timmar från `market_observations` ⇒ "Marknadsvärde ca X–Y kr exkl. moms (n=12 annonser senaste 6 mån)". Visas för ägare/handlare/finansiär. Byggs som materialiserad vy; UI-flagga `FEATURE_VALUATION`.

### 7.8 Senare (förberett men ej byggt i v1)
NFC-taggar (samma `labels` med `medium nfc`), telematik-integrationer (Trackunit, Volvo CareTrack, Komatsu Komtrax) för timmar/GPS, Transportstyrelsens fordonsuppgifter för traktorer, betalningar (Stripe) för rapporter/abonnemang.

---

## 8. Marknadsbevakning (ingest)

**Syfte:** registret ska känna till maskiner som *finns på marknaden* innan de är registrerade, upptäcka bedrägerisignaler och göra registrering nästan tom på inmatning ("Vi hittade din maskin – bekräfta").

### 8.1 Vad som samlas in
Per annons: källa, extern annons-id, URL, kategori, tillverkare, modell, år, timmar, pris (med moms-markering), ort, bilder, serienummer om det står i texten, säljartyp.
**Säljare lagras endast om det är ett företag** (namn + orgnr via uppslag). För privatpersoner lagras varken namn, telefon eller annan identifierande uppgift – bara annonsen och maskinen. Rå-HTML sparas inte; endast strukturerad `raw jsonb` utan personuppgifter.

### 8.2 Källor (`market_sources`, pluggbara connectors)
Startlista att bygga adaptrar för: Blocket (fordon/maskiner), Mascus, Klaravik, PS Auction, Auctionet, Machineseeker, Truck1, MachineryZone, samt generisk "dealer-webbplats"-adapter (sitemap + JSON-LD/Schema.org Product). Varje connector implementerar `fetchListings(since) → Observation[]`. Prioritera officiella feeds/partnerskap där de finns (`tos_status = partner_feed`); scraping-adaptrar respekterar robots.txt, rate limits (≤1 req/2 s per domän) och har kill-switch per källa.

### 8.3 Serienummer från bilder
Edge Function `ocr-listing-images`: kör vision-modell på annonsbilder som ser ut som typskyltar (klassificering först) ⇒ `serial_candidate` + confidence. Endast confidence ≥ 0,85 används för matchning; under det visas som "möjligt".

### 8.4 Matchning & signaler (körs efter varje ingest)
- Serienummer-match mot `machine_identifiers` ⇒ `matched_machine_id`.
- **`stolen_machine_listed`:** matchad maskin har status stolen ⇒ alert (critical) till ägare, holder, insurer, authority-orgar med bevakning.
- **`listed_with_active_financing`:** maskin med aktivt förbehåll ligger ute till försäljning ⇒ notis till holder (inte nödvändigtvis fel, men holder vill veta).
- **`duplicate_serial_in_market`:** samma serienummer i ≥2 aktiva annonser från olika säljare.
- **`seller_not_owner`:** säljande företag ≠ registrerad ägare/brukare/handlare med aktiv transfer.
- **`listed_after_transfer`:** annons fortfarande aktiv efter genomfört ägarbyte till annan part.
- **`price_anomaly`:** pris < 50 % av modellmedian (valfritt, lågprio).
- Oregistrerade maskiner med tillräckligt data (make+model+year+serial) blir **kandidater**: när ett företag registrerar sig och orgnr matchar `seller_org_number` ⇒ "Vi hittade 14 maskiner som ni annonserat – vill du lägga in dem?" (förifyllda utkast, nivå 0).

### 8.5 Drift
Separat worker `apps/ingest` (Node + Playwright/cheerio), körs schemalagt (GitHub Actions cron eller liten VPS), skriver via service-nyckel till Supabase. Dashboard i operatörsadmin: körningar, fel, volym per källa, öppna alerts. Gallring: observationer inaktiva > 24 månader anonymiseras (säljarfält nollas).

### 8.6 Juridiska räcken (måste med i DPIA)
Rättslig grund: berättigat intresse (bedrägeri- och stöldförebyggande, registrets kärnsyfte). Inga personuppgifter från privata säljare. Marknadsplatsers villkor gås igenom per källa innan aktivering – `tos_status = restricted` ⇒ connector avstängd tills avtal finns. Observationer visas aldrig som "ägare", bara som "senast sedd till salu hos …".

---

## 9. Informationsarkitektur & skärmar

### 9.1 Publika routes
`/` landning · `/m/:code` skanning · `/r/:reg_number` uppslag · `/s/:token` delningslänk · `/scan` kamera-skanner (PWA-genväg) · `/verify` (BankID-inloggning för privatperson-kontroll) · `/security` säkerhetssida (hash-ankare, ansvarsfull sårbarhetsrapportering) · `/api-docs` · `/login` `/signup` `/invite/:token` `/onboarding/dealer`

### 9.2 Inloggade routes (org-kontext i URL: `/o/:orgSlug/...`, org-växlare i headern)
**Gemensamt:** `/dashboard` · `/machines` · `/machines/new` · `/machines/:id` (flikar: Översikt, Historik, Dokument, Förbehåll, Service, Åtkomst) · `/machines/:id/transfer` · `/machines/:id/share` · `/import` · `/inbox` (Väntar på mig: transfers, verifieringar, förbehållsbekräftelser, inbjudningar) · `/notifications` · `/watchlist` · `/settings` (org, medlemmar, API-nycklar, webhooks, notiser, märkesbeställning) · `/labels`

**Owner:** `/fleet` (projekt, påminnelser, försäkring) · `/rentals`
**Dealer:** `/stock` · `/sales/new` · `/trade-in` · `/leads` · `/customers` · `/verify` (verifieringskö som partner)
**Financier:** `/check` (kontroll + CSV) · `/portfolio` · `/encumbrances/new` · `/receipts` · `/alerts`
**Insurer:** `/portfolio` · `/alerts`
**Authority:** `/search` (utökad) · `/flags` · `/export-check` · `/exports`
**Inspector:** `/verify` · `/bookings`
**Operator `/admin`:** organisationer (godkännandekö), verifieringskö, konflikter, märkesbatcher, händelselogg-utforskare + ankarverifiering, marknadsbevakning, API-användning, supportsök, feature flags, systemhälsa.

### 9.3 Navigation
Mobil: bottennavigering med 4 ikoner + stor central **Skanna**-knapp. Desktop: vänster sidomeny grupperad per roll, global sök (regnr/serienr) i headern (Cmd/Ctrl+K). "Väntar på mig"-räknare på Inbox.

### 9.4 Maskinsidan (den viktigaste skärmen)
Header: regnr (stort, monospace), statusbanner om ≠ active, verifieringsbadge, tillverkare/modell/år, primärfoto. Åtgärdsknappar beroende på roll (Sälj, Dela, Flagga, Verifiera, Rapportera timmar, Skriv ut ägarbevis). Nyckelfakta i två kolumner. Flikar. Historik = tidslinje från `events` med ikoner och tydliga verb ("Nordea Finance registrerade förbehåll", "Skannad i Uppsala").

---

## 10. Design

**Känsla:** nordisk, saklig, förtroendeingivande. Som ett modernt bank-/myndighetsgränssnitt men snabbare och varmare. Inte startup-lila, inga gradienter, inga dekorativa illustrationer i arbetsvyer.

- **Typografi:** Inter (UI) + JetBrains Mono (regnr, serienummer, kvittonummer). Tydlig hierarki: 28/20/16/14 px. Regnr alltid i monospace med bindestreck.
- **Färger (tokens):** `--bg #FAFAF8`, `--surface #FFFFFF`, `--ink #14161A`, `--muted #6B7280`, `--line #E5E7EB`, `--accent #0F4C5C` (djup petrol, primär knapp/länk), `--accent-soft #E6F0F2`. Statussemantik är låst: grön `#1B7F3B` = verifierad/aktiv, gul `#B7791F` = väntar/nivå 0, röd `#B42318` = stulen/spärrad/konflikt, blå `#1D4ED8` = förbehåll/finansiering, grå = avregistrerad. Dark mode via tokens (låg prio, men tokens från start).
- **Komponenter:** shadcn/ui-bas. Egna: `RegNumber`, `VerificationBadge`, `StatusBanner`, `MachineCard`, `Timeline`, `ScanButton`, `OrgPicker`, `CompanyLookupField`, `SerialInput` (validering + dubblettkoll live), `DocumentDropzone`, `ReceiptCard`.
- **UX-regler:** Skanna är alltid ett tryck bort. Wizards med progress och autosparning. Tomma tillstånd har alltid en primär handling. Tabeller på desktop, kort på mobil. Bekräfta destruktiva/juridiska steg med sammanfattning + signering, aldrig bara "OK". Formulär: inline-validering, aldrig alert(). Laddning via skeletons. Alla listor har sök + filter + export. Tillgänglighet: WCAG 2.1 AA, fokusringar, kontrast ≥ 4,5:1.
- **PDF:er (ägarbevis, kontrollkvitto, maskinrapport):** samma typografi, QR till publika sidan, kvitto-/dokumentnummer, hash av innehållet i sidfoten ("Verifiera på /verify-document").

---

## 11. Säkerhet & integritet

### 11.1 Autentisering & identitet
- Supabase Auth (e-post+lösenord, magic link, passkeys). MFA (TOTP) obligatorisk för financier/authority/operator.
- **BankID** via broker (Criipto eller Signicat) med OIDC ⇒ adapter `IdentityProvider` med implementationerna `bankid` och `mock`. Mock används när `DEMO_MODE=true` och visar tydligt "Demo-BankID". Resultat: `profiles.identity_verified_at`, `personal_number_hash`.
- **Signering** (`SignatureProvider`, `bankid`/`mock`) krävs för: `accept_transfer`, `register_encumbrance`, `release_encumbrance`, `deregister_machine`, `raise_flag(stolen)`. `signed_text` är en människoläsbar sammanfattning ("Jag bekräftar förvärv av maskin XXX-XXXX från Org AB 2026-09-21").
- Utländska organisationer: passkey + MFA + manuell godkännande av operatör.
- Sessioner: 12 h, rotation vid privilegiehöjning. API-nycklar: hash i DB, visas en gång.

### 11.2 Auktorisation: RLS + RPC
- **Default deny** på alla tabeller. Läspolicies per tabell (matris nedan). **Inga INSERT/UPDATE/DELETE-policies för klienten** på registertabeller – all skrivning via RPC (`SECURITY DEFINER`, `search_path` låst, `auth.uid()` kontrolleras inuti, `revoke all from public`, `grant execute to authenticated`).
- Hjälpfunktioner: `current_org_ids()`, `has_org_type(org, type)`, `is_operator(role)`, `is_member_of(org, min_role)`.
- API-anrop går via Edge Function `api-v1` som validerar nyckel + scope och anropar samma RPC:er med service role men skickar med `api_key_id` som aktör (loggas).

**RLS-läsmatris (utdrag, fullständig i migrationerna):**
| Tabell | Owner/Dealer (medlem i org X) | Financier | Insurer | Authority | Inspector | Publik (anon) |
|---|---|---|---|---|---|---|
| machines | rader där owner/user/registered_by = X, eller aktiv transfer till X | rader där X har encumbrance (pending/active) eller aktiv check senaste 24 h | rader där X har insurance_policy | alla | rader i verification_requests tilldelade X | ingen – publik vy via RPC `public_machine_card(code)` som returnerar begränsade fält |
| machine_identifiers | som machines, fullt värde | som machines | maskerat | fullt | fullt för tilldelade | 3 sista tecken via RPC |
| encumbrances | egna maskiner: alla fält | holder = X: alla; annars finns/finns-inte via RPC | finns/finns-inte | alla | – | – |
| transfers | from/to = X | existing_encumbrance holder = X | – | alla | – | – |
| flags | egna maskiner | maskiner m. förbehåll | försäkrade | alla | – | typ+status via RPC |
| events | egna maskiner | maskiner m. förbehåll (endast encumbrance/transfer/flag-events) | flag-events | alla | – | – |
| access_log | egna maskiner där visible_to_owner | – | – | alla | – | – |
| documents | egna + visibility-regler | visibility ∈ (owner_and_financier, verifiers) på maskiner m. förbehåll | – | alla | verifiers på tilldelade | public |
| check_receipts | – | performed_by = X | – | alla | – | – |
| market_observations | matched_machine_id ∈ egna | matched ∈ förbehåll + alla oregistrerade (aggregerat) | matched ∈ försäkrade | alla | – | – |
| organizations | egen + namn/orgnr på motparter i egna transfers/förbehåll; sökbar lista över godkända financier/dealer/inspector (namn, ort) | dito | dito | alla | dito | – |

### 11.3 Sök- och skrapskydd
- Exakt-träff-sök för alla utom authority/operator. **[v1.1]** Förbehåll får aldrig användas som sökbegrepp eller filter över registret ("visa alla belånade maskiner") för någon annan än holder över sin egen portfölj samt myndighet/operatör – samma princip som statens förslag. Publika uppslag rate-limitas (IP: 30/min, 300/dag) med Turnstile/hCaptcha efter tröskel. Regnr-kontrolltecken valideras klient- och serverside.
- Enumerering: 32^6 ≈ 1 miljard kombinationer + kontrolltecken; QR-token 128 bit. Inga sekventiella id:n exponeras (uuid överallt).

### 11.4 Oföränderlig historik
- `events` append-only via triggers; `hash`-kedja per insert. Nattligt jobb `anchor-events` beräknar dagens `root_hash` (Merkle över dagens events), skriver `event_anchors`, publicerar på `/security` **och** committar till ett publikt GitHub-repo (`anchors/YYYY-MM-DD.txt`). Vem som helst kan verifiera att historiken inte ändrats i efterhand. Ingen blockchain.
- Korrigeringar görs aldrig genom ändring utan genom `correction`-event med fyra-ögon-principen (två operatörer med `superadmin`/`verifier`), båda signerar.

### 11.5 Filer
Privat bucket, signerade URL:er (5 min), virus-skanning (ClamAV i Edge Function eller extern tjänst), max 25 MB, tillåtna typer pdf/jpg/png/heic. `sha256` lagras och skrivs in i eventet vid uppladdning. EXIF-GPS strippas från foton innan lagring (spara koordinater separat endast med samtycke, för stöldskanning).

### 11.6 Applikationssäkerhet
CSP strikt, HSTS, SameSite-cookies, CSRF på formulär utanför Supabase-klienten, input-validering med zod på klient och i RPC, dependency-scanning i CI, Sentry utan PII, secrets endast i Vercel/Supabase-miljö. Loggar innehåller aldrig personnummer eller fullständiga serienummer (maskeras).

### 11.7 GDPR & personuppgifter
- Enskild firma ⇒ orgnr = personnummer. Lagras krypterat (pgcrypto, nyckel i Vault), visas alltid maskerat `19XXXXXX-XXXX` utom för operatör med `superadmin` och för authority. Sökning på enskild firma sker via namn+ort, inte personnummer.
- Personnummer från BankID lagras endast som hash.
- Registerutdrag ("Vilka uppgifter finns om mig/oss") och radering av användarkonto (memberships avslutas; registerhistorik behålls med aktör-referens ersatt av "Borttagen användare").
- Gallring: åtkomstlogg 24 mån, notiser 12 mån, marknadsobservationer 24 mån (anonymiserade), check_receipts 10 år (bokföringsliknande), events för alltid (registrets kärna). **[v1.1]** För fysiska personer (enskild firma, privat ägare): ägaruppgifter pseudonymiseras 1 år efter avregistrering, identifierare (serienummer) behålls 7 år, events behålls men aktörsreferensen ersätts med pseudonym – samma nivåer som Transportstyrelsens förslag.
- **[v1.1] Rättelse av ägaruppgift:** en korrigering av registrerad ägare görs inte utan att den som berörs fått yttra sig – berörd org notifieras och har 14 dagar på sig att invända innan korrigeringen träder i kraft (undantag: uppenbara skrivfel, dokumenterat i händelsen). Under tiden status `disputed`.
- Data i EU (Supabase-region Stockholm eller Frankfurt, Vercel eu-central).
- Personuppgiftsbiträdesavtal med varje organisation vid onboarding (checkbox + versionerad text). DPIA skrivs innan produktion; §8 är den känsligaste delen.

### 11.8 Beredskap för bankernas krav
Publik säkerhetssida, pentest innan första bankintegration, incidentrutin, SLA-mål 99,9 %, dagliga backuper med point-in-time recovery, dataexport-klausul (om bolaget upphör lämnas registerdata till neutral part – text på /security).

---

## 12. API, webhooks, inbäddning

Bas: `https://api.<domän>/v1`, `Authorization: Bearer <api_key>`, JSON, idempotency-key på POST. OpenAPI 3.1-spec genereras och publiceras på `/api-docs`.

| Metod & path | Scope | Beskrivning |
|---|---|---|
| `GET /machines/lookup?reg=…&serial=…&pin=…&vin=…` | machines:read | Exakt uppslag. Returnerar samma vy som rollen har i UI. |
| `POST /checks` | checks:write | Finansieringskontroll ⇒ `receipt_number`, resultat, PDF-URL. |
| `POST /checks/batch` | checks:write | Upp till 500 identifierare. |
| `POST /machines` | machines:write | Registrera maskin (dealer/owner/financier). Returnerar reg_number. |
| `PATCH /machines/:id` | machines:write | Begränsade fält (timmar, foto, beskrivning). |
| `POST /machines/:id/labels/bind` | machines:write | Knyt märke. |
| `POST /encumbrances` · `POST /encumbrances/:id/release` · `POST /encumbrances/:id/confirm` | encumbrances:write | Kräver financier. Konflikt ⇒ `409 { code: 'ACTIVE_ENCUMBRANCE_EXISTS', holder: 'Org' }`. |
| `POST /transfers` · `POST /transfers/:id/accept` · `/approve` · `/cancel` | transfers:write | Signering kan ske i UI via returnerad `signing_url`. |
| `POST /flags` · `POST /flags/:id/clear` | flags:write | |
| `GET /machines/:id/events` | machines:read | Rollfiltrerad historik. |
| `GET /embed/badge/:reg.svg` | ingen | Publik badge. |
| `POST /webhooks` · `GET /webhooks` · `DELETE` | webhooks:manage | |

**Webhook-events:** `machine.registered`, `machine.verified`, `encumbrance.pending`, `encumbrance.confirmed`, `encumbrance.conflict`, `encumbrance.released`, `transfer.initiated`, `transfer.awaiting_you`, `transfer.completed`, `flag.raised`, `flag.cleared`, `machine.scanned` (endast stulen), `market.alert`, `label.bound`. Payload: `{ id, type, created_at, machine: { id, reg_number }, data }`, HMAC-SHA256-signatur i header, retry 5 gånger med backoff, deliveries synliga i UI med "Skicka igen".

---

## 13. Notiser & e-post

In-app (klocka + Inbox), e-post (Resend/Postmark, mallar på sv/en), valfri SMS för `critical` (Twilio/46elks, feature flag). Digest måndag 07:00 för påminnelser. Typer: inbjudan, ägarbyte väntar, förbehåll att bekräfta, förbehållskonflikt (critical), maskin flaggad stulen (critical), stulen maskin skannad (critical, med plats), verifiering klar/avslagen, marknadsalert, påminnelse service/försäkring/hyra, ny lead, API-nyckel skapad, ny medlem. Alla notiser länkar rakt in i rätt vy.

---

## 14. Teknik & arkitektur

**Samma stack i båda verktygen** så att resultaten går att jämföra och slå ihop (Lovable exporterar till GitHub, Claude Code fortsätter därifrån):
- **Frontend:** Vite + React 18 + TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, react-hook-form + zod, i18next (sv/en), `@zxing/browser` eller `html5-qrcode` för QR-skanning, `vite-plugin-pwa`. Hosting Vercel (Claude Code) / Lovable-hosting (Lovable). Custom domän via Cloudflare.
- **Backend:** Supabase – Postgres (RLS, RPC, pg_cron, pgcrypto, Vault), Auth, Storage, Edge Functions (Deno), Realtime (notiser). Två projekt: `staging` och `prod`, migrationer i repo (`supabase/migrations`), seed i `supabase/seed.sql`.
- **Edge Functions:** `ocr-nameplate`, `ocr-listing-images`, `import-map`, `company-lookup`, `pdf-certificate`, `pdf-check-receipt`, `pdf-buyer-report`, `send-email`, `webhook-dispatch`, `anchor-events`, `api-v1` (REST-gateway), `scan-log` (publik, rate-limitad), `av-scan`.
- **Worker:** `apps/ingest` (Node 20, Playwright, cheerio) – schemalagd.
- **AI:** Anthropic API (vision för skyltar/annonsbilder, kolumnmappning vid import). Aldrig för auktorisationsbeslut.
- **Övrigt:** Sentry (frontend + edge), GitHub Actions (lint, typecheck, unit, RLS-tester mot lokal Supabase, e2e Playwright på staging), Resend (e-post), Criipto (BankID, bakom adapter), Roaring/Bolagsverket (företagsuppslag, bakom adapter), Cloudflare Turnstile.

**Repo (monorepo, pnpm):**
```
/apps/web            Vite-app
/apps/ingest         marknadsbevakning-worker
/packages/shared     typer (genererade från Supabase), zod-scheman, regnr-generator/validator, i18n-strängar
/supabase/migrations  numrerade SQL-filer: 0001_extensions, 0002_enums, 0003_orgs_users, 0004_machines, 0005_encumbrances_transfers_flags, 0006_events_audit, 0007_documents_access, 0008_fleet, 0009_market, 0010_api_webhooks, 0011_rls_policies, 0012_rpc_functions, 0013_triggers, 0014_indexes
/supabase/functions   edge functions
/supabase/tests       RLS- och RPC-tester (pgTAP eller Vitest + supabase-js per roll)
/supabase/seed.sql    demo-data
/docs                 SPEC.md, CLAUDE.md, LOVABLE_PROMPT.md, ADR:er, openapi.yaml
```

**Feature flags (`app_config`-tabell + env):** `DEMO_MODE`, `FEATURE_MARKET`, `FEATURE_VALUATION`, `FEATURE_SMS`, `FEATURE_NFC`, `FEATURE_PAYMENTS`.

---

## 15. Icke-funktionella krav
- Registrering av maskin på mobil: ≤ 2 min, ≤ 4 skärmar. Publik skanningssida: LCP < 1,5 s på 4G. Uppslag/kontroll via API: p95 < 300 ms.
- Tillgänglighet 99,9 %. RPO 5 min, RTO 1 h.
- Skalning: 500 000 maskiner, 5 M events, 50 M observationer utan arkitekturbyte (index på normalized_value, reg_number, status, owner_org_id; partitionering av access_log och api_requests per månad).
- Alla texter via i18n, inga hårdkodade strängar i komponenter.
- Fungerar offline-tolerant för skanning (PWA cachar skalet; skanning utan nät ger "Visar senast kända status" om maskinen setts tidigare på enheten).

---

## 16. Acceptanskriterier & tester (måste vara gröna innan "klart")

**Säkerhet (automatiska RLS/RPC-tester, en testanvändare per roll):**
1. Anon kan inte SELECT på någon registertabell direkt; `public_machine_card` returnerar exakt fältlistan i §5.3 och inget mer.
2. Owner A kan inte läsa Owner B:s maskiner, dokument, events eller access_log.
3. Financier kan inte se holder på en maskin den saknar relation till; kan se ja/nej.
4. `register_encumbrance` på maskin med aktivt finansieringsförbehåll ⇒ fel `ACTIVE_ENCUMBRANCE_EXISTS`, `conflicts`-rad, notis till holder och ägare, webhook `encumbrance.conflict`. Inga partiella skrivningar.
5. `release_encumbrance` av annan än holder ⇒ `FORBIDDEN`.
6. UPDATE/DELETE på `events` ⇒ exception, även som service role via normal SQL (endast superuser-roll kan, och den används inte i appen).
7. Hashkedjan verifieras end-to-end i test; manipulerad rad upptäcks.
8. Duplicerat serienummer vid registrering ⇒ ny maskin `disputed` + conflict, inte tyst dubblett.
9. `accept_transfer` utan signatur ⇒ fel. Med mock-signatur i DEMO_MODE ⇒ ok; utanför DEMO_MODE måste provider vara `bankid`.
10. Stulen maskin: `initiate_transfer`/`register_encumbrance` blockeras; skanning skapar access_log + notis.
11. Rate limit på `/m/:code`: 31:a anropet/min från samma IP ⇒ 429.
12. API-nyckel utan scope ⇒ 403; revokerad nyckel ⇒ 401; allt loggas i api_requests.

**Funktion (e2e Playwright):**
13. Handlare: signup → org → import 20 rader (2 med fel) → 18 maskiner → beställ märken → sälj maskin till ny köpare med finansiär → köparen får e-post, accepterar → finansiären bekräftar → ägarbevis-PDF finns med korrekt regnr och QR.
14. Ägare: fota skylt (mock-OCR i test) → registrera → ladda upp faktura → verifieringskö → nivå 1 → dela rapportlänk → länken visar historik, går ut efter satt tid.
15. Finansiär: kontroll → kvitto med nummer → registrera förbehåll → annan finansiär försöker ⇒ blockeras och båda notifieras.
16. Stöld: ägare flaggar → publik sida röd → skanning notifierar ägaren → ingest hittar annons med samma serienummer ⇒ alert.
17. Myndighet: partiell sök hittar maskinen; ägaren ser inte myndighetens läsning (setting).

**Kvalitet:** typecheck och lint utan fel, Lighthouse a11y ≥ 95 på publik sida och maskinsida, alla strängar i sv och en.

---

## 17. Demo & seed-data (måste finnas – detta är vad vi visar handlare)

`supabase/seed.sql` + `DEMO_MODE=true` skapar:
- Operatör: `admin@demo` (superadmin), `verifier@demo`.
- Handlare: **Nordmaskin AB** (Uppsala, 3 användare), **Entreprenadcenter Syd AB** (Malmö), **Skogsmaskiner Norr AB** (Umeå).
- Ägare: **Bergs Schakt & Entreprenad AB** (12 maskiner, 2 projekt), **Lena Grävmaskin** (enskild firma – visar maskning), **Kommunfastigheter Väst** (kommunalt bolag).
- Finansiärer: **Demo Bank Finans**, **Nordisk Maskinfinans**. Försäkring: **Demo Försäkring**. Myndighet: **Polisen (demo)**, **Tullverket (demo)**. Inspector: **Maskinkontroll Sverige AB**.
- 60 maskiner över alla kategorier (Volvo EC220E, Cat 320, Hitachi ZX210, Komatsu PC210, Volvo L120H, Cat 950, Kubota KX080, JCB 3CX, Bell B30E, Valtra T235, John Deere 1270G, Ponsse Ergo, Manitou MT1840…) med blandade nivåer, 8 med aktivt förbehåll (leasing/avbetalning), 2 stulna, 1 spärrad, 3 skrotade, 5 utkast, 6 i handlarnas lager, 2 uthyrda, 1 pågående ägarbyte, 1 duplikatkonflikt.
- 150 marknadsobservationer varav 1 matchar en stulen maskin och 2 samma serienummer hos olika säljare.
- Märken: 3 batcher, 200 märken varav 55 bundna.
- Händelselogg med 400+ events och 30 dagars ankare. Access_log med skanningar på olika orter.

**Demo-manus (5 min för en handlare):**
1. Skanna ett märke med mobilen ⇒ publik sida, grön badge. 2. Skanna det stulna ⇒ röd fullskärm, ägaren får notis live. 3. Logga in som Nordmaskin ⇒ lager ⇒ "Sälj" ⇒ köpare + finansiär ⇒ ägarbevis-PDF på 30 sekunder. 4. Byt till Demo Bank Finans ⇒ kontrollera samma maskin ⇒ kvitto ⇒ försök lägga ett andra förbehåll ⇒ blockeras. 5. "Ta emot inbyte": skanna ⇒ se förbehåll ⇒ begär frisläppning. 6. Import: dra in en Excel med 30 maskiner ⇒ klart på en minut. 7. Marknadsbevakning: "vi hittade 14 av era annonserade maskiner – lägg in dem".

---

## 18. Öppna beslut & antaganden (defaults gäller tills annat sägs)
| Fråga | Default i denna spec |
|---|---|
| Maskintyper / viktgräns | Alla kategorier i `machine_category`, ingen viktgräns. **[v1.1]** `service_weight_kg` lagras; maskiner ≥ 1 500 kg markeras "registreringspliktig enligt Transportstyrelsens förslag" i rapporter, men allt får registreras – även småmaskiner (Tullverket vill kunna spåra dem). |
| Ska publik skanning visa förbehåll ja/nej? | Nej – kräver BankID-inloggning (även privatperson). |
| Vilka får verifiera efterregistreringar? | Operatör + godkända dealer/inspector/financier. |
| Extern registers id | Stöds som `identifier_type external_registry` + `external_system`. |
| Pris | Registrering gratis. Prislista (exkl. moms) för kontroller/API/abonnemang sätts i admin, inga betalflöden i v1 (`FEATURE_PAYMENTS=false`). |
| Namn/domän | `APP_NAME`-konstant, byts före lansering. Kontrollera PRV och domän. |
| Juridik | DPIA, personuppgiftsbiträdesavtal, villkor och godtrosförvärvsfrågan granskas av jurist före produktion. Inte en del av bygget. |

---

## 19. [v1.1] Tillägg från Transportstyrelsens rapport TSG 2021-1734 och branschartiklar

Källor: Transportstyrelsen, *Register för arbetsmaskiner – förutsättningar för utökad registrering* (okt 2022, inkl. författningsförslag och Bilaga 1); Finance Sweden pressmeddelande (sep 2025); Maskinentreprenören (nov 2025); Sveriges Radio Ekot (sep 2025). Allt nedan är inarbetat i §2–§18 där det hör hemma (markerat **[v1.1]**); här står det samlat med motivering.

### 19.1 Varför rapporten spelar roll för oss
Staten har utrett ett obligatoriskt register men bedömer att Transportstyrelsen tidigast kan ha ett i drift 2030. Författningsförslaget i rapporten är därför den bästa tillgängliga beskrivningen av hur ett svenskt maskinregister *bör* se ut juridiskt och datamässigt. Om vi bygger så att vår datamodell och våra regler är en superset av det förslaget blir vi (a) direkt användbara för upphandlare och myndigheter som redan tänker i de termerna, och (b) en kandidat för att bli datakälla eller leverantör om ett statligt register någonsin realiseras.

### 19.2 Datafält vi saknade (Bilaga 1)
| Fält enligt rapporten | Vår implementation |
|---|---|
| Tjänstevikt | `machines.service_weight_kg` |
| Motoreffekt + effektnorm | `engine_power_kw`, `power_standard` |
| Lyftanordning | `has_lifting_device` ⇒ besiktningskrav |
| Bränsletyp, konfiguration eldrift, utsläppsklass | `fuel_type`, `electric_config`, `emission_stage` |
| Identifieringsnummer, registreringsnummer | fanns |
| Antal ägare, nuvarande och föregående ägare | beräknas ur `ownerships` (visas som "3:e ägaren") |
| Efterlysning, beslag | `flags` typ `stolen` (authority) och `seized` |
| Kreditköp med förbehåll om återtaganderätt (med slutdatum), leasing | `encumbrances` med obligatoriskt `end_date` för `ownership_reservation` |
| CE-märkning | `ce_marked` + CE-försäkran som dokument (rapporten noterar att Arbetsmiljöverket tvekar juridiskt kring *obligatorisk* CE-registrering – hos oss är det frivilligt och ägarens egen uppgift) |

### 19.3 Regler vi tagit över
- **Ägarbyte:** båda parter anmäler; registreringsdatum = försäljningsdatum om anmälan sker inom 10 dagar, annars anmälningsdatum. Ägarbyte vägras om maskinen är efterlyst eller i beslag.
- **Förbehåll:** slutdatum obligatoriskt för återtaganderätt; holder ska anmäla ändring/upphörande/överlåtelse av förbehållet; köparens begäran om borttag ⇒ holder får yttra sig, motsätter sig holder står uppgiften kvar; nyttjanderätt ≥ 1 år ⇒ ny ägare kräver uthyrarens medgivande.
- **Avregistrering:** skrotad (visas), varaktigt utförd (export), militärt register, stulen och ej återfunnen inom 2 år; skylt/märke ska returneras eller anmälas förstört.
- **Gallring:** ägaruppgifter 1 år efter avregistrering, identifieringsnummer 7 år.
- **Sökning:** icke-myndigheter får bara söka på regnr, identifieringsnummer och orgnr/personnummer; förbehåll får inte vara sökbegrepp; polisen får söka på del av regnr.
- **Rättelse av ägare:** berörd part ska få yttra sig innan rättelse.
- **Tillfällig registrering** av utländska maskiner för projekt.
- **Registreringsbekräftelse** (vårt ägarbevis) och **registerutdrag** utan personnummer.

### 19.4 Nya moduler och kanaler som rapporten pekar ut
1. **Upphandling är den starkaste drivkraften.** Norge nådde ~80 % täckning i entreprenadsektorn för att offentliga beställare kräver registrering. Vi bygger därför flott-/upphandlingsrapport (§7.1) och `client`-rollen, och säljer in registret till Trafikverket, kommuner och de stora byggbolagen som ett *uppföljningsverktyg* för miljö- och maskinkrav – inte bara som bedrägeriskydd.
2. **Besiktning.** Rapporten lyfter att Arbetsmiljöverkets besiktningskrav (lyftanordningar) är svårt att följa upp. `inspections` + inspector-roll gör oss till det verktyget (§7.1). Kontrollorgan som SMP (RISE), Dekra, Kiwa och Inspecta blir därmed både verifieringspartner och dataleverantörer.
3. **Samkörning med vägtrafikregistret.** Maskinentreprenörerna kritiserar att maskinregister.se inte samkörs med Transportstyrelsens register över motorredskap (~30 000 maskiner). Vi gör det via `VehicleRegistryLookup` och `road_reg` (§4.2, §6.2). Det är en konkret, kommunicerbar skillnad.
4. **Fabriksdata från tillverkare.** Norge läste in all försäljning från Volvo CE, Hitachi m.fl. på individnivå vid start, så registrering blev "sök på serienummer, klart". `oem_records` + `manufacturer`-roll + API-endpoint `POST /v1/oem/records` (§4.7, §12).
5. **Beredskap.** Regeringen vill ha koll på arbetsmaskiner för totalförsvaret (Försvarsmakten notifieras i statens förslag; Boverket utreder). Aggregerad beredskapsexport för myndighet (§7.5) kostar nästan inget att bygga och öppnar en dörr.
6. **Miljödata.** Statens *primära* syfte är utsläppsuppföljning (Naturvårdsverkets arbetsmaskinsmodell saknar indata, köper i dag data från SMP). Utsläppssteg, bränsle och timmar i vår modell gör att vi kan leverera aggregerad statistik till Naturvårdsverket/Energimyndigheten och koppla mot klimatpremien för eldrivna maskiner. Senare, men datan ska in från dag ett.
7. **Larmtjänst och försäkringsbolagen.** Larmtjänst (försäkringsbranschens bedrägeriorganisation) förutspår att försäkringsbolag kommer kräva registrering. Larmtjänst är alltså en nyckelpartner: stöldflaggor bör kunna synkas med deras stöldgodsregister (adapter `TheftRegistrySync`, feature flag). Larmtjänst ser också det som en fördel att registret *inte* är publikt sökbart – vår publika sida visar därför bara det som behövs för att bekräfta identitet och status, och kan aldrig användas för att lista eller leta maskiner.
8. **Informationsförmedlare.** Bankerna köper i dag fordons- och kreditdata via förmedlare (UC, Creditsafe, Bilvision m.fl.). `marketplace`-rollen täcker dem; de är den snabbaste vägen in i bankernas kreditsystem utan egen integration hos varje bank.

### 19.5 Siffror att räkna med
- Cirka 30 000 anläggningsmaskiner i drift enligt Maskinentreprenörernas uppskattning, ~30 000 motorredskap registrerade hos Transportstyrelsen, ~23 000 maskiner till salu på Mascus vid ett givet tillfälle. Traktorer (~1,1 Mton CO₂, största gruppen) ligger till stor del i vägtrafikregistret.
- Tre av fyra företag anser att maskinstölder är ett stort problem; ju större företag desto mer positiva till register; småföretag (LRF Entreprenad) oroar sig för administration och avgifter från en privat aktör med vinstintresse ⇒ registrering ska förbli gratis och ta under två minuter, och prislistan ska vara publik.
- Statens avgiftsförslag: 150–225 kr/år exkl. moms plus skyltavgift. Norge: 1 000 NOK exkl. moms per registrering. Vår modell (gratis registrering, betalda uppslag/API/abonnemang) ligger under båda för ägaren.

### 19.6 Vad vi medvetet inte gör
- Vi inför ingen viktgräns (rapporten föreslår 1,5 ton för plikt) – allt får registreras, men vikten lagras så att rapporter kan filtrera.
- Vi registrerar inte utsläpp per dygn eller drivmedelsförbrukning i v1 (Norge utreder live-rapportering); timmätare räcker som proxy och telematik kommer senare.
- Vi använder inte statens föreslagna regnr-format (5 siffror + bokstav) eftersom det krockar visuellt med annat och saknar kontrolltecken; vårt format behålls.
