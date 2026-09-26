# 0009 – Proof of representation before an organisation is approved or claimed

**Context.** SPEC §2.2 auto-approves `owner` organisations when the first user is BankID-verified and the org number has
been looked up. That alone lets any verified person create (or claim a placeholder of) *any* company by typing its
org number – and thereby become owner of its machines in the register.

**Decision.** Auto-approval (and claiming a placeholder org that already has machines) additionally requires that the
user's BankID personal number is among the company's signatories/board members returned by the company lookup
(Roaring). Signatory personal numbers are hashed in the database with the same salt as BankID identities
(`company_lookups.signatory_hashes`) and never stored in clear. Otherwise the org stays `pending` with owner rights
and goes to the operator's approval queue. DEMO_MODE's mock register treats every user as a signatory.

**Consequences.** Slightly more manual approvals for companies where the person onboarding is not a signatory
(e.g. a fleet manager). They can be invited by a signatory instead.
