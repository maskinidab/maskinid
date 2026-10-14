-- The lender's bare prefix is not an agreement number (ADR 0029, follow-up).
--
-- Picking a lender pre-fills its contract_ref_prefix ("NF-"), and app.require_contract_ref only refuses an empty
-- value, so submitting without typing anything registered a financing with the agreement number "NF-" – one the
-- bank cannot tie to anything on its side, which is the whole reason the field is mandatory.
--
-- A trigger rather than a change to the three RPCs that write a financing (register_encumbrance,
-- request_encumbrance, initiate_transfer's buyer financing): it covers every door at once. It fires only when the
-- number is written, so releasing or settling a row registered earlier is unaffected (see the CHECK note in
-- supabase/tests/26_financing_terms.test.ts).

create or replace function app.encumbrance_contract_ref_not_prefix()
returns trigger language plpgsql security definer set search_path = '' as $$
declare prefix text;
begin
  select nullif(trim(o.settings -> 'financing_defaults' ->> 'contract_ref_prefix'), '') into prefix
  from public.organizations o where o.id = new.holder_org_id;
  if prefix is not null and lower(trim(coalesce(new.contract_ref, ''))) = lower(prefix) then
    perform app.raise('VALIDATION', '{"field":"contract_ref","reason":"required"}');
  end if;
  return new;
end $$;

drop trigger if exists encumbrances_contract_ref_not_prefix on public.encumbrances;
create trigger encumbrances_contract_ref_not_prefix
  before insert or update of contract_ref on public.encumbrances
  for each row execute function app.encumbrance_contract_ref_not_prefix();
