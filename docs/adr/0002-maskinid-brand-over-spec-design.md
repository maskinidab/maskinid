# 0002 – MaskinID graphic profile and name override SPEC §10

**Context.** SPEC §10 prescribes Inter/JetBrains Mono, petrol accent and the working name "Maskinpass". The company is
MaskinID AB and has a finished graphic profile (`design-system/`): Archivo/IBM Plex Mono, the yellow ID mark, the ID
frame and the register line, plus fixed terminology. The product owner chose the profile (2026-09-26).

**Decision.**
- `APP_NAME = "MaskinID"` in `packages/shared/src/config.ts` (still a single constant; rule 9 still applies).
- Typography, colours, components and tone of voice follow `design-system/grafisk-profil.md`.
- SPEC's locked status semantics are kept but mapped to profile tokens: active/verified → `--status-ok` (green),
  pending/level 0 → `--status-vantar` (amber), stolen/blocked/conflict → `--status-sparr` (red),
  encumbrance/financing → `--status-info` (blue), deregistered → neutral grey. Status is always word + icon, never
  colour alone, and never the brand yellow.
- Terminology: the profile's fixed terms are used in Swedish UI copy. "Finansieringsförbehåll" (SPEC) is shown as
  **"Belånad" / "Ingen registrerad belåning"** for the yes/no answer, with the type spelled out ("Äganderättsförbehåll",
  "Leasing", "Uthyrning"). The holder of a financing encumbrance is a **"Långivare"**, insurers are
  **"Försäkringsgivare"**, a blocked machine is **"Spärrad"**. Code, tables and API keep the SPEC's English names.

**Consequences.** Lighthouse/a11y targets (SPEC §16) apply unchanged; contrast is checked against profile tokens.
