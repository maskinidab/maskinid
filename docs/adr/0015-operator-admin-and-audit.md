# 0015 – Operator admin lives in the operator org; every operator lookup is audited

**Context.** SPEC §9 lists an `/admin` area (approval queue, verification queue, conflicts, label batches, event
explorer with anchor verification, market surveillance, API usage, support search, feature flags, system health).
Operators are members of the operator organisation, and several queues (verification) are shared with partner orgs.

**Decision.**
- The admin area is `/o/<operator-org>/admin/*` inside the normal app shell, so org context, signatures and existing
  pages (verification queue, machine page) are reused. `/admin/*` links from notifications redirect there.
- Role gates follow SPEC §2.4 and are enforced in the RPCs: `support` reads, `verifier` handles queues (approve orgs,
  narrow requested roles, conflicts, corrections, market alerts), `superadmin` changes settings (flags, suspension,
  label printing and print files, source activation).
- `operator_audit` is an append-only table (triggers block update/delete/truncate) that records every support search,
  organisation view, role change, flag change and label-code export. Changes that affect the register are also
  events in the hash chain. Only superadmins read the audit log.
- Sole-trader numbers stay masked for support and verifiers; only superadmins see them (SPEC §11.7).
- Feature flags are edited in `app_config`; only existing keys, and boolean flags stay boolean.

**Consequences.** Support work is traceable without adding personal data to the public event chain.
