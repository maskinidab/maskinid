# 0026 – Export preserves the machine's identity

**Context.** Exporting a machine went through `deregister_machine(reason => 'exported')`, which did two things
that together made the machine look deleted:

1. It revoked every bound label, so the QR on the machine resolved to a "label replaced" notice.
2. The status trigger released the serial from the partial unique index (`app.identifier_before_write` and
   `app.machine_status_after` treated `exported` like `scrapped`). `check_identifier` filters on `unique_active`,
   so typing the serial of an exported machine answered "finns inte" — its history became unreachable by the one
   identifier anybody standing at the machine actually has.

The product owner's reading of it: "När en maskin exporteras verkar QR Koden/historiken på serienumret försvinna.
Tycker de borde va kvar vid export, på så sätt kan man få utländska användare. Exporten borde egentligen bara bli
ytterligare en händelse i maskinens historik."

SPEC §6.8 does say "Serienummer frigörs från unikhetsindexet" for scrapped/exported. That is right for a scrapped
machine, which no longer exists. It is wrong for an exported one, which is the same machine in another country —
and releasing the serial actively invites a cloned identity.

**Decision.** Export stays a status and stays read-only, but it no longer destroys the identity.

- `machines` gains `exported_at`, `export_country` and `export_customs_ref`.
- `'exported'` is removed from the serial-releasing status lists, so an exported serial stays claimed. A
  re-registration from abroad therefore finds the existing record instead of creating a twin. (A migration
  backfills already-exported machines, skipping any value another machine has taken meanwhile — that collision
  belongs in the conflict queue, not in a migration.)
- `deregister_machine` accepts `label_disposition = 'kept'`, which is the default (and only valid value) for
  export, and skips the label revocation. The other reasons are unchanged: scrapping still revokes the label and
  releases the serial.
- Export is logged as its own `machine.exported` event with country, customs reference and date, **in addition**
  to the existing `machine.deregistered`, so nothing that consumes the old event breaks.
- `app.public_card_json` gains `exported_at` and `export_country`, so the public card can say where the machine
  went. Still nothing that identifies the owner (SPEC §5.3, §16.1).
- New `public.reimport_machine` brings it back to `active`. `exported_at`/`export_country` are deliberately not
  cleared: the export stays in the history.
- `app.run_temporary_registrations` (an expired temporary registration auto-exports) is aligned with the same
  semantics. It cannot call the RPC — it runs from pg_cron with no actor and no signature.

**Consequences.** A foreign owner can keep scanning the machine, a Swedish buyer can look up its full history
before buying it back, and Tullverket still sees the export date. Exported machines remain read-only, so nothing
else in the ~20 code paths that guard on `('scrapped','exported','deregistered')` had to move. Letting a foreign
owner keep *operating* the machine as fully active was the alternative; it touches all of those paths and can be
taken separately if the need appears.
