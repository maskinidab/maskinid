# 0029 – Financing terms, for the owner and the lender only

**Supersedes the amounts part of [0025](0025-payoff-without-amounts.md).** That ADR ends with:

> If that is ever wanted, it needs a new decision, a new ADR and a change to `CLAUDE.md` rule 5 — not a quiet
> column.

This is that decision, that ADR and that change.

**Context.** The product owner tried the system again and asked for something the register could not do: *"Det måste
gå att fylla i finansieringsuppgifter manuellt, t.ex. amorteringstid, restvärde, finansieringsbelopp osv. Det ska
självklart också gå att koppla finansieringen till ett specifikt avtalsnummer hos banken. Jag tycker att
avtalsnummer/avtalsreferens ska vara obligatoriskt så att banken enkelt kan koppla maskinen till rätt
finansieringsavtal."* Asked where the figures should live, the answer was a finance calculator — a "finanssnurra" —
for the owner and the bank: calculate it, type it in, or read it off the bank's attached PDF.

Three of those fields are not amounts at all. An agreement number, an amortisation period and an interest rate were
never what rule 5 was protecting against. Two of them are: the financed amount and the residual value.

What rule 5 was actually for, per SPEC §0, is that the register does not become a debt register — *"Det behövs inte
för att stoppa dubbelfinansiering och sänker risk och tröskel för bankerna."* A second lender needs to know that a
machine is financed and by whom. It does not need to know how much, and a register that tells it would be a reason
for the first lender not to join.

That argument is about **who can read the figure**, not about whether it exists. The owner knows its own loan. The
lender wrote the contract. Neither learns anything from the register that it did not already have.

**Decision.** Store the terms on the encumbrance, readable by the machine's owner and by the lender holding that
financing, and by nobody else.

- Eight columns on `public.encumbrances`: `financing_amount`, `down_payment`, `residual_value`,
  `amortization_months`, `interest_rate`, plus the derived `monthly_cost` and `total_credit_amount` and the flag
  `terms_overridden`. Amounts in kronor, `numeric(14,2)`.
- **`payoff_requests` stays amount-free**, and the test that proves it stays. The payoff figure still lives only
  inside the lender's own document. A payoff amount is an outstanding debt at a point in time, which is exactly
  what the register must not hold; the terms of a contract are not.
- **The terms are their own JSON object.** `app.encumbrance_terms_json` is separate from `app.encumbrance_json`,
  and each caller adds it deliberately. The obvious shortcut — hanging the figures on `encumbrance_json`'s
  existing `p_full` flag — would have leaked them, because `p_full` is already true for operators and authorities.
- **`terms_overridden`.** A typed-in monthly cost wins over the calculated one and is recorded as such, so a later
  change to the formula never silently rewrites the lender's own figure.
- **The formula exists twice, and a test pins the two together.** `packages/shared/src/financing.ts` for the
  browser, `app.annuity_monthly` in SQL because `register_encumbrance` is reachable over `api-v1` with no browser.
  `supabase/tests/26_financing_terms.test.ts` runs both over the same `CALCULATOR_CASES` table and compares to the
  öre. Two formulas that drift apart is the kind of thing a lender disputes.
- **The agreement number is mandatory**, enforced in `app.require_contract_ref` from all three doors that write a
  financing: `register_encumbrance`, `request_encumbrance` and `app.open_new_financing` (the sale flow).
  Deliberately *not* a column constraint: a `CHECK`, even `NOT VALID`, is evaluated on every `UPDATE` of an
  existing row, and `release_encumbrance`, `settle_payoff` and `accept_transfer` all update rows written before
  this requirement existed. A constraint would have left a bank unable to release an old financing — on staging,
  where rows created through "Bifoga dokument" have a null reference.
- **`update_encumbrance_terms`** lets the owner and the holder correct the figures, with an
  `encumbrance.terms_updated` event. Figures read off a document will sometimes be wrong, and without this the
  only fix would be to release the financing and register it again, breaking the chain over a clerical error.
- **OCR reads the terms** and pre-fills the calculator. It is still never asked for a purchase price, an
  outstanding debt or a payoff figure.

**The exposure matrix**, each line covered by a test:

| Who | Terms |
|---|---|
| The machine's owner (`owner` / `user` relation) | **yes** |
| The lender holding that financing | **yes**, including in its own portfolio |
| Another lender | no — and with no relation it cannot read the machine at all |
| A dealer at trade-in (`trade_in_lookup`) | no |
| An authority, customs | no (it does see *who* holds the financing) |
| An insurer | no |
| The operator (MaskinID) | no |
| `perform_check` receipt | no |
| Share link / buyer report | no |
| Public card `/m/:code`, `/r/:reg` | no |
| The hash-chained `events` log | no — `terms_set: true` records that figures exist |
| Webhook payloads | no |
| `transfers.new_financing` | no — stripped once copied onto the encumbrance |

That last line is the one the matrix nearly missed. The sale flow carries the buyer's financing in
`transfers.new_financing`, which is stored verbatim and returned raw by `app.transfer_json` — and
`machine_view_extras` shows `open_transfer` to the authority and to a dealer at trade-in. Nothing in the
encumbrance serialisation would have caught it. `app.open_new_financing` now moves the terms onto the encumbrance
and strips them off the transfer in the same transaction, and `app.transfer_json` strips whatever is left on older
rows.

**Consequences.** `CLAUDE.md` rule 5 is narrowed, not dropped: no purchase price, no outstanding debt, an
amount-free `payoff_requests`, and contract terms visible to the two parties to the contract. The property that
keeps the threshold low for lenders — that a competitor cannot read your loan book out of the register — still
holds, and now has a test per path instead of a convention.

The cost is that every future place that serialises an encumbrance has to decide consciously whether to add
`app.encumbrance_terms_json`. That is the point of it being a separate object, and `26_financing_terms.test.ts` is
where a new path gets its line.
