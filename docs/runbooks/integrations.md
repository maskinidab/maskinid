# Runbook – integrations (step 25)

All external systems sit behind adapters in `packages/shared/src/adapters`. `DEMO_MODE=true` (default) uses the mocks.
Feature flags live in `app_config` and can be changed without a release.

| Integration | Flag | Adapter | Edge Function | Schedule |
|---|---|---|---|---|
| NFC labels | `FEATURE_NFC` | – (Web NFC in the browser) | `scan-log` (chip check) | – |
| Telematics (CareTrack, Komtrax, Trackunit) | `FEATURE_TELEMATICS` | `telematics.ts` (ISO 15143-3) | `telematics-sync` | every 15 min |
| Transportstyrelsen | – | `VehicleRegistryLookup` | `vtr-lookup` | on demand |
| Larmtjänst | `FEATURE_THEFT_SYNC` | `TheftRegistrySync` | `theft-sync` | every 10 min |

## Telematics
- Customers add a connection under Settings → Integrationer: feed URL (https only) and credentials (basic, token or
  OAuth client). Credentials are encrypted with `integration_key` (Vault) and only decrypted by the service role.
- `telematics_due_connections` returns connections not synced for an hour or with "Synka nu"; `telematics_ingest`
  matches machines of the connection's organisation only, raises hour meters (never lowers) and keeps the latest position.
- A connection that fails is set to `error` and the org admins are notified. Common causes: expired password,
  feed URL changed, IP allow-list at the manufacturer (give them the Supabase egress IPs).
- A stolen machine that reports a position notifies owner and the flagging authority (at most every 6 hours).

## Transportstyrelsen
- Needs an agreement for "Fordonsuppgifter via API". Set `VTR_API_URL` and `VTR_API_TOKEN` as function secrets.
- The adapter drops owner name, personal number and address; `record_vtr_lookup` drops them again. Cached 7 days.

## Larmtjänst
- Needs an agreement. Set `LARMTJANST_API_URL` and `LARMTJANST_API_KEY`.
- Outgoing: every stolen flag (and its clearing) is queued in `theft_sync_queue`; failures retry with backoff
  (5 min × 3ⁿ, 6 attempts) and then show as failed under Admin → Stöldregister.
- Incoming: reports since the last two days are matched on serial/PIN/VIN. A match never flags a machine; the owner
  and the verifiers are notified and a verifier confirms or dismisses under Admin → Stöldregister.

## NFC
- NFC labels hold the same URL as the QR code (NDEF URL record). The owner registers the chip serial with Chrome on
  Android (Labels → Registrera chip). A public NFC scan with another chip gives "Märket kan vara kopierat" and notifies
  the owner and verifiers once per day and label.
