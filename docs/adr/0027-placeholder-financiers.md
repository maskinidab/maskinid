# 0027 – Financing against a lender that does not use MaskinID yet

**Context.** A dealer receives a bank order from, say, LF Finans and needs to register the financing against LF
Finans — whether or not LF Finans is a MaskinID customer. The day they sign up, their machines must already be
there instead of having to be entered from scratch.

Three things blocked it:

- `request_encumbrance` required `app.has_org_type(p_holder_org_id, 'financier')`, and `has_org_type` gives a
  `pending` organisation **only** the `owner` type (SPEC §2.2). A placeholder could never be a lender.
- There was no financier-side equivalent of `app.resolve_owner_org`, which has always created an unclaimed
  placeholder organisation from an organisation number.
- `list_partner_orgs` — the single source for every lender dropdown — returns approved organisations only.

The claim half already worked: `create_org` takes over an organisation that has no active member, keeping the same
id, so everything pointing at it survives.

**Decision.** Generalise the placeholder mechanism to the lender side, and keep "nameable" strictly separate from
"capable".

- `app.resolve_org_by_number(actor, org_number, types, name, invite_email)` generalises `resolve_owner_org`, which
  becomes a thin call with `array['owner']`. It creates `status = 'pending'` with the requested types, logs
  `org.created` with `payload.placeholder = true`, and queues an invitation e-mail.
- **`app.has_org_type` is deliberately not changed.** The new predicate `app.can_be_financier_holder` (not
  suspended, declares `financier`) is used *only* where a bank is named as the holder of a financing:
  `request_encumbrance`, `initiate_transfer`'s `new_financing`, `transfer_encumbrance_holder` and
  `app.open_new_financing`. Everything that grants power — `register_encumbrance`'s actor check,
  `confirm_encumbrance`, `release_encumbrance`, `list_portfolio`, the aal2 requirement in `require_actor` — still
  goes through `has_org_type`. A placeholder can be named and can do nothing at all.
- `list_partner_orgs` is left alone. A dropdown of unverified banks would be a phishing surface, so naming a bank
  outside MaskinID goes through its organisation number instead (`FinancierPicker` → "Annan bank").
- An *unclaimed* organisation that does not yet declare the type we need gains it (a company first seen as an
  owner can later be named as a lender). A **claimed** organisation is never relabelled: naming one that is not a
  lender fails with `FINANCIER_NOT_ELIGIBLE`.
- `create_org`'s `SIGNATORY_REQUIRED` guard previously only looked at `machines.owner_org_id`. A placeholder that
  carries only *encumbrances* is just as load-bearing — taking it over hands someone every financing registered
  against that bank — so `app.placeholder_is_load_bearing` now covers both.
- `lookup_company` reports `claimable` and `needs_signatory`, and the onboarding form offers the claim path.
  Previously the UI only ever offered "Begär åtkomst", which notifies admins a placeholder does not have, so the
  request went nowhere.

**Consequences.** The register can hold the true financing picture before the banks are customers, which is the
point: it gives a lender a reason to join (their portfolio is already there) rather than a data-entry project.
`app.notify_org` writes nothing for an organisation without members, and that is left as it is — `get_inbox` and
`list_portfolio` are derived from table state, so every pending row materialises the moment the bank claims the
organisation. The invitation e-mail (`invite_financier`) is what knocks on the door.

The residual risk is a dealer registering a financing against the wrong organisation number. That is the same risk
the owner-side placeholder has always carried, and it is mitigated the same way: the operator approves the
organisation, a signatory has to claim it, and the lender can reject the reported financing.
