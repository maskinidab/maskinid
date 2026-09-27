# Incidents

**Roles:** incident lead (on call), communicator, scribe. Log every step with time in the incident document.

## Severity
- **S1** register unavailable, wrong financing/theft status shown, data breach, broken event chain.
- **S2** part unavailable (e-mail, API, one integration), degraded performance.
- **S3** cosmetic or single-user issue.

## First 30 minutes (S1/S2)
1. Confirm (uptime, Sentry, `/status`). Open the incident, notify the team.
2. Inform customers with API integrations (e-mail to their technical contact); `/status` shows job health automatically.
3. Stabilise: roll back (deploy.md), pause the failing job, or turn off the feature flag.

## Personal-data breach (GDPR art. 33–34)
- Assess within hours; report to IMY within **72 hours** of becoming aware if there is a risk to individuals.
- Inform affected organisations (we are processor for some data – see the DPA) without undue delay.
- Preserve evidence: do not delete logs; export `operator_audit`, `access_log`, relevant events.

## Broken event chain (`chain.broken`)
1. Do not write to the affected range manually. Run `select app.verify_chain()` to find `bad_seq`.
2. Compare with the published anchors (`/status`, anchor repository) to find which day diverges.
3. A mismatch means tampering or corruption: treat as S1 security incident; restore the range from backup into a
   separate project for comparison (backup-restore.md).

## After
Post-mortem within 5 working days: timeline, root cause, what changes (tests, alerts, runbooks).
