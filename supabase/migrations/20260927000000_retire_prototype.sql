-- =====================================================================
-- Retire the prototype schema (migrations 20260926000001–3).
--
-- The prototype stored loan amounts (pledges.amount_sek), which the
-- specification forbids (CLAUDE.md rule 5), and used a data model that
-- differs from SPEC §4. Committed migrations are never edited, so this
-- migration moves the prototype tables into a private `legacy` schema.
-- Their data is migrated into the new model by the
-- `migrate_legacy_data` migration, which then drops the schema.
-- See docs/adr/0005-retire-prototype-schema.md.
-- =====================================================================

-- Prototype RPCs and helpers (all replaced by the new API).
drop function if exists public.admin_attach_profile(uuid, uuid, text, text, uuid, boolean);
drop function if exists public.admin_create_organization(text, text, public.organization_type);
drop function if exists public.admin_list_users();
drop function if exists public.verify_identity(uuid, text);
drop function if exists public.require_admin();
drop function if exists public.is_admin();
drop function if exists public.issue_extract(uuid);
drop function if exists public.get_extract(text);
drop function if exists public.extract_json(public.register_extracts);
drop function if exists public.lift_block(uuid);
drop function if exists public.report_block(uuid, public.block_reason, text, text);
drop function if exists public.register_insurance(uuid, text, text, date, date);
drop function if exists public.release_pledge(uuid);
drop function if exists public.register_pledge(uuid, text, bigint);
drop function if exists public.transfer_ownership(uuid, uuid, timestamptz);
drop function if exists public.register_machine(text, text, text, text, text, int, uuid);
drop function if exists public.list_my_machines();
drop function if exists public.get_machine_history(uuid);
drop function if exists public.get_machine_record(uuid);
drop function if exists public.lookup_machine(text);
drop function if exists public.my_profile();
drop function if exists public.machine_record_json(uuid);
drop function if exists public.is_current_owner(uuid, uuid);
drop function if exists public.log_event(uuid, public.register_event_kind, text, uuid);
drop function if exists public.forbidden();
drop function if exists public.require_org();
drop function if exists public.current_org();

create schema if not exists legacy;
revoke all on schema legacy from public;

do $$
declare t text;
begin
  foreach t in array array['register_extracts', 'register_events', 'blocks', 'insurances', 'pledges',
                           'ownerships', 'machines', 'profiles', 'organizations'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I set schema legacy', t);
    end if;
  end loop;
  foreach t in array array['machine_register_seq', 'extract_seq'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter sequence public.%I set schema legacy', t);
    end if;
  end loop;
  foreach t in array array['organization_type', 'block_reason', 'register_event_kind'] loop
    if to_regtype('public.' || t) is not null then
      execute format('alter type public.%I set schema legacy', t);
    end if;
  end loop;
  if to_regprocedure('public.identifier_key(text)') is not null then
    alter function public.identifier_key(text) set schema legacy;
  end if;
end $$;
