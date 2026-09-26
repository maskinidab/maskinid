# 0005 – Retire the prototype schema

**Context.** The prototype schema stored loan amounts (`pledges.amount_sek`), which rule 5 forbids, and its model does
not match SPEC §4. It was applied to the live Supabase project.

**Decision.** Migration `20260927000000_retire_prototype` drops the prototype RPCs and moves the prototype tables,
types and sequences into a private `legacy` schema. A later migration (`migrate_legacy_data`) copies organisations,
users, machines, ownerships, pledges (as encumbrances **without amounts**), insurances and blocks (as flags) into the
new model, writes `legacy.imported` events, and then drops the `legacy` schema including every amount.

**Consequences.** No loan amount survives the migration. Prototype register numbers (`MID-YYYY-NNNNNNN`) are kept as
`external_registry` identifiers so old extracts can still be matched; machines get new SPEC registration numbers.
