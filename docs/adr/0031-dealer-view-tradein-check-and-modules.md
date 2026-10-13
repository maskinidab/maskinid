# 0031 – The dealer's view: Inbytestest of its own, and fleet modules per organisation

**Context.** Four of the product owner's points were about one thing — a dealer being shown an owner's tools:

> "För handlare tycker jag att vi kan ändra kategorin 'Daglig kontroll' till 'Inbytestest', alternativt skapa en ny
> kategori som heter just 'Inbytestest'. Där ska handlaren kunna fylla i eller scanna serienumret på maskinen och
> sedan få upp samma kontrollpunkter, texter och bockrutor som idag finns under 'Daglig kontroll'."

> "Uthyrning kan vi ta bort från handlarvyn, men funktionen ska fortfarande finnas kvar i systemet så att vi kan
> aktivera den för de handlare som vill ha eller behöver den framöver."

> "'Bränsle och klimat' kan tas bort från handlarvyn." · "'Förare' kan också tas bort från handlarvyn."

The four modules were gated on the `owner` org type (`nav.ts`), and Nordmaskin is `['dealer', 'owner']` — which is
why a dealer saw them at all. They are an owner's operating tools: a daily check stops a machine, a fuel entry
feeds a climate report, an operator is an employee.

A dealer standing at a trade-in candidate wants the same *checklist* for a different reason: to find what is wrong
before agreeing a price.

**Decision: Inbytestest is its own thing, sharing the checklist and nothing else.**

- **`public.tradein_checks`, not a row in `daily_checks`.** A dealer cannot use `submit_daily_check` at all: it
  goes through `app.require_fleet_access`, which requires the caller to own or use the machine, and a trade-in
  candidate is by definition someone else's. Beyond that, reusing it would mean a dealer's appraisal could take
  the owner's machine out of service and write in the owner's hour meter.
- **`submit_tradein_check` never calls `record_hours` or `app.set_operational_status`.** The hour reading goes on
  the check row. A failed critical item is a price argument, not a stop order.
- **`machine_id` is nullable, with `serial_text` beside it.** A trade-in candidate is frequently not in MaskinID
  yet, and `trade_in_lookup` raises `NOT_FOUND` for it. The appraisal is saved against the serial the dealer
  scanned or typed, so the dealer is not told to register someone else's machine first.
- **RLS admits the dealer that made it, and the operator. Deliberately not the machine's owner.** Copying the
  `daily_checks_read` shape (`or app.has_full_access(app.machine_relations(machine_id))`) would hand the owner the
  dealer's valuation notes — one line that would make the feature unusable for the party using it.
- **Logged as `dealer.tradein_check` with `machine_id = null`.** `app.can_read_event` returns true for the owner on
  every event that carries a `machine_id`, so logging it against the machine would show the owner "Nordmaskin
  inbytestestade din maskin" before any offer was made. The null branch confines it to the dealer's own
  organisations, and hard rule 3 is still satisfied.
- **The checklist itself is one component.** `components/ChecklistForm.tsx` renders the control points, texts and
  tick boxes for both flows, against the same `checklist_templates` rows — so "samma kontrollpunkter, texter och
  bockrutor" is true by construction rather than by copying.

**Decision: the four modules become a per-organisation setting, defaulted from the org type.**

- `organizations.settings -> 'modules'`, the same shape as `financing_defaults` and `min_trusted_level`. No new
  table.
- **The default is derived, not stored**: `app.module_default` turns `daily_check`, `rentals`, `climate` and
  `operators` off for anything with the `dealer` type. Nothing had to be backfilled, and a dealer created tomorrow
  gets the right menu on day one. A stored key overrides it, one module at a time. `nav.ts` mirrors the same
  defaults so a stale `my_context` can never blank the menu.
- **The organisation's own admin can switch one on**, under Inställningar → Moduler. A module is a view
  simplification, not a security boundary; keeping it operator-only would have made "aktivera den för de handlare
  som vill ha den" a support ticket every time. `admin_set_org_modules` lets the operator do it too, audited.
- **Writes are guarded by `BEFORE INSERT` triggers** on `daily_checks`, `fuel_entries`, `operators`,
  `machine_operators` and `rentals`. `appRoutes` carries no role metadata, so every page is reachable by address —
  hiding a menu item is not enforcement. Triggers rather than checks in eight RPCs because they catch every path
  at once; and deliberately *not* inside `app.require_fleet_access`, which is the shared choke point for
  `record_hours` and the whole service history, neither of which belongs to a module.
- **Reads stay open, each for a reason.** `list_rentals` returns both `out` and `in`, so a dealer that *rents a
  machine in* keeps seeing it — it is renting out that is switched off. `list_daily_checks` / `list_fuel` /
  `list_operators` only ever return the caller's own rows, and with the module off there are none.
  `list_checklist_templates` is explicitly not guarded: it is where Inbytestest gets its checklist.
- **`ModuleGate`** wraps the four routes so a typed-in address explains itself instead of offering a "Ny uthyrning"
  button that the server then refuses.
- **`my_context` sends the effective modules**, resolved per membership, so the web app does not duplicate the
  resolution logic — only the fallback.

**Consequences.** `nordmaskin@demo.se` now shows Inbytestest where Daglig kontroll was, and Uthyrning, Bränsle &
klimat and Förare are gone; `berg@demo.se` is unchanged. Flotta and Redskap stay — they were not part of the
request.

The seeded rentals moved from Nordmaskin to Bergs Schakt. Seeding them on the main dealer account would both fail
the module guard and put back the menu item the product owner asked to have removed; an owner renting two machines
out is the more natural demo anyway. `docs/TESTGUIDE.md` moves its Uthyrning round accordingly.
