-- =====================================================================
-- Export stops destroying the machine's identity.
--
-- Until now export went through `deregister_machine(reason => 'exported')`, which revoked the QR label and
-- released the serial from the uniqueness index. The consequence was that `check_identifier` answered
-- "exists: false" for an exported machine, so its history became unreachable by serial number and the QR
-- label read as "replaced" — export behaved like a deletion.
--
-- Decision (ADR 0026): `exported` stays a status and stays read-only, but the identity survives. The label
-- keeps its binding, the serial keeps `unique_active`, export is logged as its own event with destination
-- country, and `reimport_machine` brings the machine back. A machine exported abroad is still the same
-- machine, and a foreign owner must be able to scan it.
-- =====================================================================

alter table public.machines
  add column if not exists exported_at      timestamptz,
  add column if not exists export_country   char(2),
  add column if not exists export_customs_ref text;

comment on column public.machines.export_country is 'ISO 3166-1 alpha-2 destination country, set when the machine is exported.';

-- ---------- Identifiers survive an export ----------
-- 'exported' removed from both status lists: an exported serial stays claimed, so re-registering the same
-- machine from abroad finds the existing record instead of creating a twin.
create or replace function app.identifier_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st public.machine_status;
begin
  new.normalized_value := app.normalize_identifier(new.value);
  if new.normalized_value is null then raise exception 'empty identifier'; end if;
  select status into st from public.machines where id = new.machine_id;
  new.unique_active := new.type in ('pin', 'serial', 'vin') and new.conflict_id is null
    and st not in ('draft', 'scrapped', 'deregistered');
  return new;
end $$;

create or replace function app.machine_status_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update public.machine_identifiers set unique_active = (type in ('pin', 'serial', 'vin') and conflict_id is null
      and new.status not in ('draft', 'scrapped', 'deregistered'))
    where machine_id = new.id;
  end if;
  return null;
end $$;

-- Backfill: reclaim the serials of machines that were already exported, but never at the cost of breaking
-- machine_identifiers_unique_active — if some other machine took the value in the meantime, leave it alone
-- (that collision is a conflict for the operator queue, not something a migration should decide).
do $$
declare r record;
begin
  for r in
    select i.id, i.type, i.normalized_value
    from public.machine_identifiers i
    join public.machines m on m.id = i.machine_id
    where m.status = 'exported' and not i.unique_active and i.conflict_id is null
      and i.type in ('pin', 'serial', 'vin')
  loop
    if not exists (
      select 1 from public.machine_identifiers x
      where x.unique_active and x.type = r.type and x.normalized_value = r.normalized_value
    ) then
      update public.machine_identifiers set unique_active = true where id = r.id;
    end if;
  end loop;
end $$;

-- ---------- Public card shows where the machine went ----------
create or replace function app.public_card_json(m public.machines, p_label public.labels)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reg_number', m.reg_number,
    'make', m.make,
    'model', m.model,
    'year', m.year,
    'category', m.category,
    'primary_photo_path', m.primary_photo_path,
    'status', m.status,
    'verification_level', m.verification_level,
    'serial_masked', app.mask_serial(app.machine_primary_serial(m.id)),
    'has_registered_owner', m.owner_org_id is not null,
    'label_status', case when p_label.id is null then null
                         when p_label.status = 'bound' then 'bound'
                         when p_label.status in ('revoked', 'lost') then 'replaced' else 'unbound' end,
    'inspection_valid_until', app.public_inspection_valid_until(m.id),
    'exported_at', m.exported_at,
    'export_country', m.export_country
  )
$$;

-- ---------- Signed text for export and re-import ----------
-- New actions plug in as app.sigtext_<action>(subject, params, locale) (the dispatcher in migration 0013).
-- Overriding deregister_machine here keeps app.signature_text_core untouched; the wording for scrapped /
-- misregistered / military is reproduced verbatim so no existing signed statement changes meaning.
create or replace function app.sigtext_deregister_machine(p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare m public.machines; reg text; en boolean := p_locale = 'en'; disp text := p_params ->> 'label_disposition';
begin
  select * into m from public.machines where id = p_subject_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  reg := app.format_reg_number(m.reg_number) || ' (' || coalesce(m.make, '') || ' ' || coalesce(m.model, '') || ')';
  if (p_params ->> 'reason') = 'exported' then
    return case when en then format('I export machine %s. The label stays on the machine and the machine keeps its history in MaskinID.', reg)
                else format('Jag exporterar maskin %s. Märket sitter kvar på maskinen och maskinen behåller sin historik i MaskinID.', reg) end;
  end if;
  return case when en then format('I deregister machine %s. Reason: %s. The label is %s.', reg, app.label(p_params ->> 'reason', 'en'), disp)
              else format('Jag avregistrerar maskin %s. Orsak: %s. Märket är %s.', reg, app.label(p_params ->> 'reason', 'sv'),
                case disp when 'destroyed' then 'förstört' when 'returned' then 'returnerat' else 'borttaget' end) end;
end $$;

create or replace function app.sigtext_reimport_machine(p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare m public.machines; reg text; en boolean := p_locale = 'en';
begin
  select * into m from public.machines where id = p_subject_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  reg := app.format_reg_number(m.reg_number) || ' (' || coalesce(m.make, '') || ' ' || coalesce(m.model, '') || ')';
  return case when en then format('I bring machine %s back into the register after its export to %s.', reg, coalesce(m.export_country, '-'))
              else format('Jag återinför maskin %s i registret efter exporten till %s.', reg, coalesce(m.export_country, '-')) end;
end $$;

-- ---------- Deregistration / export ----------
-- The old signature must be dropped, not just replaced: adding parameters with defaults would leave two
-- overloads behind and make every existing positional call (e.g. the seed) ambiguous.
drop function if exists public.deregister_machine(uuid, uuid, public.deregistration_reason, text, uuid, text, date);
-- p_export_country is text, not char(2): the browser demo backend derives a parameter cast from
-- format_type(type, null), which turns char(2) into a bare "character" and truncates 'NO' to 'N'.
-- The column stays char(2); the value is validated and upper-cased here.

-- Adds p_export_country and p_export_customs_ref, plus 'kept' as a label disposition. Export keeps the label
-- bound: a resolvable QR on an exported machine is the whole point of this migration.
create or replace function public.deregister_machine(p_org_id uuid, p_machine_id uuid, p_reason public.deregistration_reason,
  p_label_disposition text default 'removed', p_signature_id uuid default null, p_note text default null, p_date date default null,
  p_export_country text default null, p_export_customs_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; fin public.encumbrances; is_holder boolean; sig uuid;
  st public.machine_status; ev public.events; revoked int := 0; disposition text; country text; customs text;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  disposition := coalesce(nullif(trim(p_label_disposition), ''), case when p_reason = 'exported' then 'kept' else 'removed' end);
  if disposition not in ('destroyed', 'removed', 'returned', 'kept') then perform app.raise('VALIDATION', '{"field":"label_disposition"}'); end if;
  if disposition = 'kept' and p_reason <> 'exported' then
    perform app.raise('VALIDATION', '{"field":"label_disposition","reason":"kept_only_for_export"}');
  end if;
  country := upper(nullif(trim(p_export_country), ''));
  customs := nullif(trim(p_export_customs_ref), '');
  if country is not null and country !~ '^[A-Z][A-Z]$' then perform app.raise('VALIDATION', '{"field":"export_country"}'); end if;
  if p_reason <> 'exported' and (country is not null or customs is not null) then
    perform app.raise('VALIDATION', '{"field":"export_country","reason":"only_for_export"}');
  end if;
  fin := app.active_financing(m.id);
  is_holder := fin.holder_org_id = actor;
  if p_reason = 'stolen_not_recovered' then
    if not app.is_operator('superadmin') then perform app.raise('FORBIDDEN'); end if;
  else
    if (m.owner_org_id = actor or is_holder or app.is_operator('superadmin')) is not true then perform app.raise('FORBIDDEN'); end if;
    perform app.assert_not_blocked(m.id, 'deregister_machine');
    if fin.id is not null and not is_holder and not app.is_operator('superadmin') then
      perform app.raise('ENCUMBRANCE_BLOCKS_DEREGISTRATION', jsonb_build_object('holder', (select name from public.organizations where id = fin.holder_org_id)));
    end if;
  end if;
  sig := app.consume_signature(p_signature_id, 'deregister_machine', m.id,
    jsonb_build_object('reason', p_reason, 'label_disposition', disposition));
  st := case p_reason when 'scrapped' then 'scrapped' when 'exported' then 'exported' else 'deregistered' end::public.machine_status;
  update public.machines set status = st, deregistered_at = coalesce(p_date::timestamptz, now()), deregistration_reason = p_reason,
    exported_at = case when p_reason = 'exported' then coalesce(p_date::timestamptz, now()) else exported_at end,
    export_country = case when p_reason = 'exported' then country else export_country end,
    export_customs_ref = case when p_reason = 'exported' then customs else export_customs_ref end
  where id = m.id;
  if disposition <> 'kept' then
    update public.labels set status = 'revoked', revoked_at = now(), revoked_reason = 'deregistered:' || disposition
    where machine_id = m.id and status = 'bound';
    get diagnostics revoked = row_count;
  end if;
  update public.transfers set status = 'cancelled', cancelled_reason = 'machine_deregistered'
  where machine_id = m.id and status in ('draft', 'awaiting_buyer', 'awaiting_financier');
  ev := app.log_event('machine.deregistered', m.id, m.owner_org_id, actor, jsonb_build_object('reason', p_reason, 'status', st,
    'label_disposition', disposition, 'labels_revoked', revoked, 'note', left(p_note, 500), 'by_holder', is_holder));
  if p_reason = 'exported' then
    perform app.log_event('machine.exported', m.id, m.owner_org_id, actor,
      jsonb_build_object('country', country, 'customs_ref', customs, 'date', coalesce(p_date, current_date)));
    perform app.enqueue_webhook(m.owner_org_id, 'machine.exported', m.id, jsonb_build_object('country', country), ev.id);
  end if;
  if actor <> m.owner_org_id then
    perform app.notify_org(m.owner_org_id, 'machine.deregistered', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
      'reason', p_reason, 'by', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'warning');
  end if;
  perform app.enqueue_webhook(m.owner_org_id, 'flag.raised', m.id, jsonb_build_object('type', st), ev.id);
  return jsonb_build_object('ok', true, 'status', st, 'labels_revoked', revoked);
end $$;

revoke all on function public.deregister_machine(uuid, uuid, public.deregistration_reason, text, uuid, text, date, text, text) from public;
grant execute on function public.deregister_machine(uuid, uuid, public.deregistration_reason, text, uuid, text, date, text, text) to authenticated, service_role;

-- ---------- Re-import ----------
-- A machine that comes back is the same machine. Current owner (or an operator) only, signature required, and the
-- export stays in the history: exported_at/export_country are deliberately not cleared.
create or replace function public.reimport_machine(p_org_id uuid, p_machine_id uuid, p_signature_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; sig uuid; clash uuid; fin public.encumbrances;
begin
  perform app.require_scope('machines:write');
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if m.status <> 'exported' then perform app.raise('MACHINE_NOT_EXPORTED', jsonb_build_object('status', m.status)); end if;
  if (m.owner_org_id = actor or app.is_operator('superadmin')) is not true then perform app.raise('FORBIDDEN'); end if;
  -- Defensive: export no longer releases the serial, so a clash should be impossible. One that exists predates
  -- this migration and belongs in the conflict queue, not in a silent overwrite.
  select x.machine_id into clash from public.machine_identifiers mine
  join public.machine_identifiers x on x.type = mine.type and x.normalized_value = mine.normalized_value
  where mine.machine_id = m.id and x.machine_id <> m.id and x.unique_active and mine.type in ('pin', 'serial', 'vin') limit 1;
  if clash is not null then perform app.raise('DUPLICATE_IDENTIFIER', jsonb_build_object('machine_id', clash)); end if;
  sig := app.consume_signature(p_signature_id, 'reimport_machine', m.id, '{}'::jsonb);
  update public.machines set status = 'active', deregistered_at = null, deregistration_reason = null where id = m.id;
  perform app.log_event('machine.reimported', m.id, m.owner_org_id, actor,
    jsonb_build_object('from_country', m.export_country, 'exported_at', m.exported_at, 'note', left(p_note, 500), 'signature_id', sig));
  perform app.enqueue_webhook(m.owner_org_id, 'machine.reimported', m.id, jsonb_build_object('from_country', m.export_country));
  fin := app.active_financing(m.id);
  if fin.id is not null and fin.holder_org_id <> actor then
    perform app.notify_org(fin.holder_org_id, 'machine.reimported',
      jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number), '/machines/' || m.id, 'info');
  end if;
  return jsonb_build_object('ok', true, 'status', 'active');
end $$;

revoke all on function public.reimport_machine(uuid, uuid, uuid, text) from public;
grant execute on function public.reimport_machine(uuid, uuid, uuid, text) to authenticated, service_role;

-- ---------- Expired temporary registration ----------
-- Same semantics as a manual export: the label stays, the serial stays claimed, machine.exported is logged.
-- This path cannot call deregister_machine — it runs from pg_cron with no actor and no signature.
create or replace function app.run_temporary_registrations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.machines; reminded int := 0; expired int := 0;
begin
  for m in select * from public.machines where registration_type = 'temporary' and status = 'active' and valid_until is not null
             and valid_until between current_date and current_date + 30 loop
    if app.rate_limit_hit('temp-reminder:' || m.id || ':' || m.valid_until, 1, interval '60 days') then
      perform app.notify_org(m.owner_org_id, 'machine.temporary_expiring', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id,
        'valid_until', m.valid_until), '/machines/' || m.id, 'warning');
      reminded := reminded + 1;
    end if;
  end loop;
  for m in select * from public.machines where registration_type = 'temporary' and status = 'active' and valid_until < current_date for update loop
    update public.machines set status = 'exported', deregistration_reason = 'exported', deregistered_at = now(),
      exported_at = coalesce(exported_at, now()), export_country = coalesce(export_country, m.origin_country)
    where id = m.id;
    perform app.log_event('machine.deregistered', m.id, m.owner_org_id, null, jsonb_build_object('reason', 'exported', 'cause', 'temporary_expired',
      'valid_until', m.valid_until));
    perform app.log_event('machine.exported', m.id, m.owner_org_id, null, jsonb_build_object('country', m.origin_country,
      'cause', 'temporary_expired', 'date', current_date));
    perform app.notify_org(m.owner_org_id, 'machine.temporary_expired', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id),
      '/machines/' || m.id, 'warning');
    expired := expired + 1;
  end loop;
  return jsonb_build_object('reminded', reminded, 'expired', expired);
end $$;
