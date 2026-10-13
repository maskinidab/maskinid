# 0025 – Payoff ("lösen") without amounts

> **Superseded in part by [0029](0029-financing-terms-for-owner-and-lender.md).** The financing *terms* (amount,
> down payment, residual value, amortisation period, interest) are now stored on the encumbrance and readable by
> the machine's owner and the holding lender. Everything below still holds for the payoff itself:
> `payoff_requests` remains amount-free and the payoff figure lives only inside the lender's document.

**Context.** A dealer taking in a machine the bank owns through leasing has to know what must be settled before the
trade-in can happen, and the bank has to be able to answer. Until now the only way to ask a lender to release a
financing was `request_encumbrance_release`, which wrote a single bell notification linked to `/machines/:id`. It
created no row, produced no entry in `get_inbox`, and fired no webhook, so a bank had nothing to work through and
no record that the question had ever been asked. From the dealer's side "Väntar på långivaren" was a dead end.

The product owner asked for the bank to be able to send back "en aktuell lösenoffert/lösenbelopp". That collides
head-on with a hard rule: `CLAUDE.md` rule 5 and SPEC §0 say the register stores **no** financing amounts,
purchase prices or outstanding debt — "Det behövs inte för att stoppa dubbelfinansiering och sänker risk och
tröskel för bankerna."

**Decision.** Build the payoff conversation, and keep the figure out of the register.

- `public.payoff_requests` holds status, purpose, contract reference, a validity date, and the ids of two
  documents: the lender's payoff statement and the requester's proof of settlement. **There is no amount column**,
  and `supabase/tests/23_payoff.test.ts` asserts that one cannot appear. The figure lives inside the lender's PDF,
  which both parties can open; the dealer reads it there.
- Lifecycle: `requested → quoted → settlement_submitted → settled`, plus `declined` and `expired`. A partial
  unique index allows one open request per encumbrance.
- `submit_payoff_settlement` (the requester uploading proof) deliberately does **not** touch the encumbrance.
  The block is released only by `settle_payoff` or `release_encumbrance`, both holder-only and both signed, so
  "spärren släpps aldrig utan att banken faktiskt godkänt att krediten är löst" holds by construction rather than
  by convention.
- `settle_payoff` releases the encumbrance, closes the reminders and unblocks a waiting transfer in the same
  transaction, so approving is one action for the bank instead of approve-then-release-manually.
- `request_trade_in` takes `p_request_payoff`, so the lender hears about it when the dealer starts the deal. The
  transfer is still a `draft` waiting for the owner at that point; previously `app.open_transfer` (and therefore
  the lender's notification) was not reached until the owner approved.
- Three new `get_inbox` kinds — `payoff_request`, `payoff_quote`, `payoff_settlement_review` — because the inbox,
  not the notification bell, is what a bank actually works through.
- The same flow is exposed over `api-v1` (`POST /payoffs`, `/quote`, `/settlement`, `/settle`, `/decline`) and as
  webhook events, so a bank can automate it. No bank-specific integration is built.

**Consequences.** MaskinID never holds a debt figure, which is the property that keeps the threshold low for
lenders, and the audit trail still shows exactly who asked, who answered, who approved and when. The cost is that
the amount is only readable by opening a document, so it cannot be searched, summed or shown in a list. If that is
ever wanted, it needs a new decision, a new ADR and a change to `CLAUDE.md` rule 5 — not a quiet column.
