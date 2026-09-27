# 0006 – Event hash chain

**Context.** SPEC §4.5 defines `hash = sha256(prev_hash || seq || type || payload::text || created_at)`. That leaves
`machine_id`, `org_id` and the actor columns outside the hash (they could be changed undetected), relies on the session
time zone for `created_at::text`, and plain concatenation is ambiguous. With `bigserial`, concurrent transactions can
also commit in a different order than their `seq`, which breaks a chain ordered by `seq`.

**Decision.**
- `hash = sha256(prev_hash|seq|id|type|machine_id|org_id|actor_type|actor_user_id|actor_org_id|payload|created_at)` with
  `|` separators, jsonb's canonical text for `payload` and `created_at` as UTC ISO-8601 with microseconds.
- `seq`, `prev_hash` and `hash` are set in a BEFORE INSERT trigger holding `pg_advisory_xact_lock`, so seq order equals
  chain order.
- Daily anchors store a Merkle root over the day's event hashes plus the last chain hash (`chain_hash`).

**Consequences.** Writers of events are serialised (fine for the expected ~5 M events). The /security page documents
the exact formula so anyone can recompute it.
