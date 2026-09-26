# 0010 – Signatures via API, and how long the registering organisation sees a machine

**Signatures.** SPEC §11.1 requires a signature for `accept_transfer`, `register_encumbrance`, `release_encumbrance`,
`deregister_machine` and `raise_flag(stolen)`, and SPEC §12 exposes encumbrance and flag endpoints to API partners.
Decision: every signature is created server-side with a human-readable text built from the subject (the client cannot
choose what is signed), is bound to action + subject + parameters, single use, valid 30 minutes, and outside DEMO_MODE
only `bankid` counts. API keys (org-level credentials created by a BankID-verified admin, scope-limited and logged)
may register/confirm/release encumbrances, approve transfers as financier and raise flags without a personal
signature. **Accepting a transfer and deregistering always need a personal BankID signature** – via the API the
partner gets a `signing_url` for a person to sign.

**Registering organisation.** SPEC §11.2 lets `registered_by` read a machine. Taken literally, a seller who once
registered the machine would keep reading the buyer's financing forever. Decision: the `registered_by` relation only
applies during the first ownership period (until the first completed transfer). Previous owners keep read-only access
to the history up to their transfer (SPEC §6.7).
