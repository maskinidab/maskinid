# 0017 – Attachments, operators, daily checks and fuel as fleet data

**Context.** CLAUDE.md step 20 lists "Redskap, förare, daglig kontroll, bränsle/klimat (SPEC §20.1–20.4) inkl.
`operational_status`, checklistmallar, klimatrapport-PDF". SPEC v1.2 §20 is missing (ADR 0003).

**Decision.**
- These are fleet data kept by the owner/user organisation, not register facts: RLS lets the keeping org read them;
  daily checks follow the machine like service history. All writes go through RPCs and log events on the machine.
- `machines.operational_status` (operational / restricted / out_of_service) is separate from the register status. A
  failed *critical* checklist item sets out_of_service and notifies owner and user; a clean check lifts only a stop
  that a daily check caused – a manual stop needs a manual release.
- Checklists: built-in templates (general, lifting devices) plus org templates; each check stores a snapshot of the
  items so later template edits never rewrite history.
- Operators hold no personal identity numbers (rejected by a check); optional link to a member login.
- Fuel/energy is logged per machine; the climate report multiplies by emission factors kept in `app_config`
  (`EMISSION_FACTORS`) and stores the factors used in a numbered C- snapshot, verifiable like other documents.

**Consequences.** Emission factors are assumptions until confirmed (docs/OPEN_QUESTIONS.md). Telematics import of
hours/fuel comes with the adapter in step 25.
