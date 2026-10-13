# 0032 – Anyone may look up a serial; the full history needs the owner's consent

**Context.** Two of the product owner's points turned out to be one root cause.

> "Enskild firma verkar inte kunna se historiken när de söker på ett serienummer."

> "Vi behöver låsa upp så att samtliga kontotyper/profiler kan söka på VIN/serienummer och se maskinens
> grundinformation samt om den är belånad eller har någon aktiv finansieringsspärr. Däremot ska inte vem som helst
> kunna se hela maskinens historik. Vill man ha tillgång till den fullständiga historiken ska man kunna skicka en
> förfrågan till maskinägaren, som sedan får godkänna att informationen delas."

And a third he asked us to think about:

> "Hur ska vi tänka kring bankernas möjlighet att se ett företags maskinflotta? … Ett alternativ är att
> företagaren själv får godkänna att banken får tillfällig tillgång till hela eller delar av maskinflottan."

**It was never `is_sole_trader`.** No permission path in the codebase reads that flag. A sole proprietor and a
plain company account both have `types = {owner}`, and `app.machine_view_extras` only emitted the `financing`
block when `sees_yes_no` held — which required a relation to the machine or one of the partner org types
(dealer / financier / insurer / inspector / marketplace). So a search returned the make and the model and nothing
about financing, and clicking through raised `NOT_FOUND` because there was no relation at all. Lena could see her
*own* machines' history perfectly well; it was everyone else's that was blank.

**Decision 1: `lookup_machine` is the search that opens up — not `perform_check`.**

This is the part worth writing down, because `perform_check` is the more obvious candidate and the wrong one:

- `check_receipts` carries an `after insert` metering trigger (`app.meter_check`) and the price list sets
  `('check', 4900)`. Opening it to every account type would bill 49 kr for curiosity.
- A receipt grants the `checker` relation for 24 hours.
- `app.risk_signals` raises `many_recent_checks` at three distinct checking organisations within 30 days, so three
  strangers looking a machine up would poison its risk profile for the people paying for the product.
- `machine.checked` is logged against the owner's machine, filling their timeline with unknown accounts.

`lookup_machine` has none of that: exact match, one `app.after_lookup` row in the access log (which the owner can
already read), no receipt, no event, no meter, no relation. It already ran for every org type and already backs
Ctrl+K and `GET /machines/lookup`. The whole change is `sees_yes_no := p_org_id is not null` plus one
`app.rate_limit_hit` line — 120 an hour per organisation, since enumeration is the cost to guard against.

What opens: `has_active` / `has_pending`, and the flag types. What stays closed: who the lender is (`sees_holder`),
the terms (ADR 0029), the owner's name, the unmasked serial, and the history. The public card is untouched — the
guard is `p_org_id is not null`, so the unauthenticated surface does not move.

**Decision 2: consent is a mandate, not a new table.**

`public.mandates` (ADR 0018) already was this: a principal authorising another organisation, scoped (`view` is the
full machine view), time-limited to at most 730 days, BankID-signed, revocable by either side, and already wired
into `app.machine_relations` as `agent`. Three gaps had to be closed.

1. **The direction.** `grant_mandate` is principal-initiated; nobody could ask. `request_mandate` +
   `decide_mandate_request` add the other direction. The request gets a **new `requested` status** rather than
   reusing `pending`, and that distinction is a security boundary, not tidiness: `pending` means "the agent must
   accept", and `respond_mandate` matches `agent_org_id = actor and status = 'pending'`. An agent-initiated
   `pending` row would have let the requester accept its own request and hand itself a full machine view.
2. **A mandate produced no history.** `app.can_read_event` never knew `agent` or `group`, so a mandate holder got
   a full machine view and an empty timeline — which makes consent worth nothing. It is now keyed on the mandate's
   *scope* rather than on the relation, because `machine_relations_more` sets `agent` for `view|sell|fleet` alike:
   a `view` mandate is the whole history, a `fleet` mandate sees only `machine.*` events, because operating a
   machine is not a reason to read who has owned and financed it.
3. **Nowhere to ask from.** The search result offers it (a hit with `access: "basic"` has no machine page to open),
   the history tab offers it, the lender's portfolio offers the fleet-wide version, and the owner decides from the
   inbox or Fullmakter. `get_inbox` grew an `app.inbox_extras` hook so the next flow needing an inbox item does
   not have to copy that body again.

**Consequences.** The answer to the bank question: **without consent a lender still sees only the machines it
finances** — `list_portfolio` is strictly `holder_org_id = actor`, and SPEC §11.3 forbids listing all encumbered
machines. With a signed, time-limited, revocable consent it sees whole or part of the fleet: fleet-wide is
`machine_id = null`, and "parts of the fleet" is one mandate per machine, which the existing check constraint
already allows. That is better than a blanket right for every bank, and better than nothing for credit
assessment.

Consent gives the **history**, never the lender's terms. A machine's `view` mandate yields `access: "full"` and
the full timeline, and `supabase/tests/29_lookup_and_consent.test.ts` asserts that the financing amounts are still
absent — the contract between an owner and its bank is not the owner's to share on the bank's behalf.
