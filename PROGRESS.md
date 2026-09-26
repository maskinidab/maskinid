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
