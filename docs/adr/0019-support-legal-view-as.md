# 0019 – Tips, stolen list, support, legal documents, account security and "view as"

**Context.** CLAUDE.md step 22 lists "Tips, publik stöldlista, hjälpcenter, support, juridiska dokument med acceptans,
kontosäkerhet, 'Visa som organisation' (SPEC §20.8, 20.10, 20.11)"; the SPEC sections are missing (ADR 0003).

**Decision.**
- **Tips** come in anonymously through the `tip` Edge Function (service role, rate limited per hashed IP, 5/hour).
  A tip matched to a stolen machine notifies the owner and the flagging org at once, but without the tipster's contact
  details. Only the operator sees contact details and may forward the tip to the authority that flagged the machine.
- **Public stolen list** is opt-in per stolen flag (`flags.publish_public`), set by the owner, the flagging org or an
  authority. It shows make, model, year, colour, registration number, county and date – never owner or location detail.
  Publishing and unpublishing are events in the chain.
- **Help centre** content lives in `packages/shared/src/help` (sv/en) so it is versioned with the code, not a CMS.
- **Support** tickets from signed-in users (tied to org + user) and from the public contact form (e-mail only, service
  role, rate limited). Operator replies are audited; the customer gets a notification or a `support_reply` e-mail.
- **Legal documents** are versioned rows (key, version, locale). Documents with `requires_acceptance` block the app
  (LegalGate) until the user accepts the latest version; acceptances are kept per user and version. The DPA is
  accepted per organisation by its admin as before (step 2) and is also listed here.
- **Account security**: a per-user security log (sign-in, sign-out everywhere, MFA changes, identity, legal
  acceptance, view-as) and "sign out of all devices" (Supabase global sign-out). The log is written by the client
  after the event, so it is informative, not evidence.
- **View as organisation**: operators (support role and up) can view an approved org read-only for 30 minutes with a
  mandatory reason. It is a pseudo-membership with role `readonly` returned by `my_context`; every RPC already rejects
  writes for `readonly`. The session is audited and the org's admins are notified at once.

**Consequences.** `app.is_member_of` honours an active view-as session for read access only. Seed accepts the current
legal versions for demo users so the demo is not interrupted; publishing a new version shows the gate.
