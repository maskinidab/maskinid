# 0018 – Mandates, risk signals and groups

**Context.** CLAUDE.md step 21 lists "Fullmakter och kommission, risksignaler och bevakning efter kontroll,
koncern/avdelningar (SPEC §20.5–20.7)"; the SPEC sections are missing (ADR 0003).

**Decision.**
- **Mandates.** The owner grants, with BankID, either a consignment (one machine, to a dealer) or a power of attorney
  (one machine or all its machines) with explicit scopes: `sell`, `view`, `fleet`. The agent accepts; either side
  revokes; max two years; a completed transfer ends the machine's mandates. Under `sell` the agent starts the transfer
  but the owner stays seller of record and is notified; the buyer still signs. Consigned machines appear in the dealer's
  stock. Mandates never allow encumbrances, flags or deregistration – those stay with owner and lender.
- **Risk signals** are computed in the check (before the check itself is stored) and saved in the receipt: active
  flag, open conflict, frequent transfers, listing by another seller, recent owner change, new unverified registration,
  hour meter corrected, several lenders checking, listed for sale, open transfer, financing recently released. They are
  indicators ("titta närmare"), never a verdict, and contain no amounts.
- **Monitoring after a check** reuses the watchlist with an end date (30/90/180 days); a manual watch is permanent.
- **Groups.** One level: a subsidiary requests, the parent's admin accepts. The parent gets relation `group` = read-only
  full view of subsidiaries' machines; writes stay with each company. **Departments** are an org's own grouping.

**Consequences.** `app.has_full_access` now includes `agent` and `group`; tests cover that neither can write.
