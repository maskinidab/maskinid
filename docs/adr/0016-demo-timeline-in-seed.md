# 0016 – Demo seed spreads events over 30 days and anchors them

**Context.** SPEC §17 wants a demo with 400+ events and 30 days of anchors. The seed runs in seconds, so every event
gets the same timestamp and there would be one anchor day at most. Events are append-only and hash-chained.

**Decision.** The last seed file (`supabase/seed/90_timeline.sql`) spreads existing events over the last 30 days in
their original order, recomputes the hash chain, computes one anchor per day, marks them published, and then asserts
that `verify_chain()` passes. The update trigger is disabled only inside that seed transaction. This file is never part
of migrations and never runs against staging or production data (seeds run only on local and demo databases).

**Consequences.** Other tables (ownerships, notifications) keep the seed time; the demo timeline therefore reads
"registered 30 days ago" while some dates on the machine page show today. Acceptable for a demo.
