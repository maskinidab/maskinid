# 0021 – Statistics, data export, web push, API sandbox, partial search, merge

**Context.** CLAUDE.md step 24: "Statistik, dataexport, push-notiser, sandbox, partial search, merge (SPEC §20.12–20.16)".
The sections are missing (ADR 0003); SPEC §1 and §19 name environmental statistics for Naturvårdsverket and
preparedness as uses of the data.

**Decision.**
- **Statistics.** `/statistics` shows aggregates of the register (type, county from the owner's town, emission stage,
  fuel, age, verification level, registrations per month, stolen/recovered). Cells with 1–4 machines are suppressed
  ("<5") so a single owner cannot be identified; theft counts are not suppressed (the stolen list is public anyway).
  A daily snapshot is stored by `refresh_statistics` (service role, scheduled in step 26); operators see exact numbers.
  The environment table (type × stage × fuel with average power and hours, groups ≥ 5) downloads as CSV.
  Charts follow the dataviz method: one series ⇒ no legend, bars ≤ 24 px with a 4 px rounded end, values in text ink,
  tooltip on hover/focus and a table view; the bar colour is validated for both themes.
- **Data export.** Org admins download all of the organisation's data as JSON (`maskinid-export/1`); anyone can download
  their personal data. Secret columns (key/token hashes, webhook secrets, personal-number hash, encrypted org numbers,
  push keys) are never included. 5 exports per day; the org export is an event.
- **Web push.** VAPID + aes128gcm (RFC 8291/8292) implemented with Web Crypto behind a `PushSender` adapter
  (webpush | mock). A trigger on `notifications` queues push messages per device using the same defaults as e-mail
  (warnings and critical) unless the user chooses otherwise per org; `push-send` delivers every minute and removes
  expired subscriptions. In the local demo a small pump in the app shows queued messages through the service worker.
  While here, fixed "all notifications" for e-mail: `['*']` was compared literally and sent nothing.
- **API sandbox.** `mk_test_` keys are answered by the gateway from five fixed test machines (clean, financed, stolen,
  disputed, scrapped) that exercise the important responses (409 on double financing, stolen blocks transfer, …).
  Nothing reaches the register, no webhooks fire and nothing is billed. The separate Supabase "sandbox" project from
  the kickoff prompt remains possible for full end-to-end tests.
- **Partial search.** Lenders, insurers, dealers, inspection bodies, authorities and the operator can search on ≥ 5
  characters of a serial or reg number (worn nameplates). At most 10 candidates, identifier masked except the matched
  part, never owner or financing; 30 searches per hour; logged as an event. Also `GET /machines/search?q=`.
- **Merge.** A verifier merges a duplicate record into the kept machine (same owner, not two active financings, no
  open transfer). Identifiers, labels, documents, service, inspections, flags, encumbrances etc. move; the old record
  becomes deregistered (`misregistered`) with `merged_into_id`, and the kept machine's history includes the old
  record's events (events are append-only and never move). Offered from the duplicate-conflict dialog.

**Consequences.** Owners cannot use partial search (it would let anyone probe serial numbers). Rows that would break a
"one open per machine" rule stay on the old record, which remains readable through the link.
