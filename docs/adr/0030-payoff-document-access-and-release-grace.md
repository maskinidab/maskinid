# 0030 – Who can open a payoff document, and what a lender sees after releasing

**Context.** Two of the product owner's reports were the same sentence from opposite ends of the payoff flow:

> "Handlaren får då upp att det finns ett lösenbesked som väntar, men när man klickar på det står det att man inte
> har behörighet att se det."

> "Samt en bekräftelse när banken släpper kredit/leasingspärr, just nu kommer det bara upp 'ingen behörighet'."

Both were real, and neither was a missing permission as such. They were the same modelling mistake twice: access
derived from a *relation to the machine*, in two places where the relation is not what the access is about.

**1. The payoff statement.** The lender uploads it, so `documents.org_id` is the bank, and
`app.attach_payoff_document` forces `visibility = 'owner_and_financier'`. `app.can_read_document` then admitted the
uploading org, the operator, an authority, the `owner`/`user` relations and `holder` — a list that has no entry for
the one party that asked the question. A dealer at trade-in can at best be `transfer_party`, and
`app.machine_relations` grants that only while the transfer is `awaiting_buyer`/`awaiting_financier`. At the moment
the dealer asks for a payoff the transfer is still a `draft`, so the dealer has **no relation at all** and
`authorize_document_download` raised `NOT_FOUND`.

The intent had been the opposite from the start: `payoff.quote_hint` reads "Bifoga lösenbeskedet som PDF.
Handlaren ser beloppet i dokumentet", and ADR 0025 says the figure "lives inside the lender's PDF, which both
parties can open". The code never implemented that sentence, and the only test covering it asserted the *owner*
could read the statement — never the dealer.

**2. Releasing the block.** `release_encumbrance` and `settle_payoff` set `status = 'released'`.
`app.machine_relations` grants `holder` only for `status in ('pending','active')`, so the lender lost every
relation to the machine in the same transaction in which it released the block. The dialog closed, the machine
query refetched, `get_machine` raised `NOT_FOUND`, and `MachinePage` replaced the whole page with
`errors.NOT_FOUND` — "Uppgiften finns inte eller så har du inte behörighet att se den". The action had succeeded
and the screen said it had not.

**Decision.**

- **A payoff's documents belong to the payoff, not to the machine.** `app.can_read_document` gets a branch that
  admits a caller who is `requested_by_org_id` or `holder_org_id` on a `payoff_requests` row referencing that very
  document as its `quote_document_id` or `settlement_document_id`. Narrow on purpose: the two parties to one
  payoff, its two documents, nothing else. It does not widen any other document.
- **`DOCUMENT_NOT_READY`.** `authorize_document_download` required `status = 'clean'` while `can_read_document`
  admits `'scanning'`, so in non-demo mode a dealer clicking "Öppna lösenbesked" seconds after the upload would
  get `NOT_FOUND` — the same message as the bug just fixed. Permission and readiness now answer differently. A
  caller with no permission still gets `NOT_FOUND`, so "not ready" cannot be used to probe which ids exist.
- **A `former_holder` relation for 90 days after a release**, built the way `previous_owner` already is. It is
  deliberately **not** in `app.has_full_access`: a released financing is not continued access to the owner's
  machine. It yields the lender's own encumbrance rows in `machine_view_extras` (without which `MachinePage` does
  not render the financing tab at all, so the grace relation would buy a page the bank could not use), its own
  documents, and in `app.can_read_event` the `encumbrance`/`transfer`/`flag` categories up to **released_at + 1
  day**. The day of slack matters: `app.log_event('encumbrance.released')` runs *after* `released_at = now()`, so
  an exact cut-off would hide the one event the confirmation exists to show. `previous_owner` solves it the same
  way with `max(to_date) + 1`.
- **Both release dialogs end on a receipt, not on a close.** `PayoffSettleDialog` and `ReleaseEncumbranceDialog`
  stay open with "Spärren släppt" and a link onward to **Portfölj** or **Inkorg**, rather than closing into a page
  the lender no longer has a relation to. The wording follows the profile: a button that says "Släpp spärren"
  confirms with "Spärren släppt".
- **`MachinePage` stops treating `NOT_FOUND` as a failure.** `if (q.error || !q.data) return <ErrorNotice …>`
  nuked the page on any refetch error. A `NOT_FOUND` after an action now renders "Du har inte längre åtkomst till
  den här maskinen" with a way back. This is the same class of bug for `deregister_machine`, `accept_transfer` on
  the seller's side and `revoke_mandate`, all of which end a relation the same way — so the fix belongs in the
  page, not only in the grace relation.

**Consequences.** The lender keeps a read of what it did for a quarter and then drops off, which is what an audit
trail needs and what a machine owner would expect. The dealer reads the figure where ADR 0025 always said it
would. `supabase/tests/27_payoff_access_and_release.test.ts` covers both directions, including the cases that
must stay closed: a second dealer, a second lender, an insurer, an inspector and anon get `NOT_FOUND` on the
statement, and a former holder sees neither the next lender's financing nor its terms.

The e2e suite now clicks the button instead of only asserting that it is on screen — which is what let the first
defect ship.
