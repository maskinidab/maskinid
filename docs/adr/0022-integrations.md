# 0022 – Integrations: NFC, telematics, Transportstyrelsen, Larmtjänst; public pages

**Context.** CLAUDE.md step 25: "Integrationsadaptrar med mock: NFC, telematik, Transportstyrelsen, Larmtjänst
(SPEC §7.8) och publika sidor (SPEC §20.17)". SPEC §7.8 lists them as prepared but not built in v1; §19.7 names
Larmtjänst as a key partner and warns that the public page must never allow listing or searching for machines.

**Decision.**
- **NFC.** Same `labels` rows with `medium nfc` and the same URL as the QR code. Anti-copy check without special chips:
  the owner registers the chip serial (Web NFC `serialNumber`, stored only as a hash); a public scan with another chip
  shows a warning and notifies the owner. Cryptographic tags (NTAG 424 SUN) can replace this later with the same field.
- **Telematics.** One client for ISO 15143-3 / AEMP 2.0, which CareTrack, Komtrax and Trackunit all offer, with basic,
  token or OAuth client credentials (encrypted). Only the org's own machines are matched; hour meters only rise; only the
  latest position is stored, visible to owner/user and to an authority while the machine is stolen. Pagination is only
  followed on the feed's own origin so credentials are never sent elsewhere.
- **Transportstyrelsen.** `vtr-lookup` Edge Function fills the existing 7-day cache; personal data is dropped twice.
- **Larmtjänst.** Outgoing queue from stolen flags (trigger) with retry; incoming reports are matched but never flag a
  machine automatically – the owner is told and a verifier reviews it.
- **Public pages.** `/for/:segment` (owners, dealers, lenders, insurers, authorities), `/about`, `/integrations` and
  `/status` (register status, latest published anchor, which integrations are on). None of them lists machines.

**Consequences.** Everything runs with mocks in DEMO_MODE; real endpoints need partner agreements and secrets
(`docs/runbooks/integrations.md`). Also fixed: the timeline text for reported hours used a payload key that no event has.
