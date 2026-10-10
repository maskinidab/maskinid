-- =====================================================================
-- "Bifoga dokument" on a financing, and a financing that is visible the moment it is reported.
--
-- Two reported problems are fixed here.
--
-- 1. There was no way to attach the bank order / leasing agreement to a financing: encumbrances had no document
--    column, and the document_type value `financing_contract` existed but was referenced nowhere in the app.
--    (create_document_upload already permits an organisation-level upload with p_machine_id null, so a bank can
--    stage an agreement before any encumbrance exists without widening that function.)
--
-- 2. Choosing a bank left the machine reading "Ej belånad". app.active_financing counts status='active' only,
--    FinancingBadge was binary, and in the sale flow the encumbrance was not created until the buyer accepted
--    the transfer — which is why it looked as though the buyer had to approve first. The pending state is now
--    part of the machine view, and a sale creates the pending row immediately so the bank hears about it at once.
--    The financing *check* (perform_check / app.check_one) deliberately keeps answering on active financing only:
--    a reported but unconfirmed financing is not an encumbrance, and that answer is the bank's legal one
--    (SPEC §6.6, §16.3–4).
-- =====================================================================

alter table public.encumbrances add column if not exists document_ids uuid[] not null default '{}';
comment on column public.encumbrances.document_ids is 'Bank order / leasing agreement / credit agreement backing this financing.';

-- Validates and binds documents handed to register_encumbrance / request_encumbrance: the caller must be able to
-- read them, they must not already belong to another machine, and they become visible to owner and lender.
create or replace function app.bind_encumbrance_documents(p_actor uuid, p_machine_id uuid, p_document_ids uuid[])
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare d public.documents; out_ids uuid[] := '{}'; i uuid;
begin
  foreach i in array coalesce(p_document_ids, '{}') loop
    select * into d from public.documents where id = i;
    if d.id is null then perform app.raise('NOT_FOUND', '{"field":"document_ids"}'); end if;
    if d.org_id <> p_actor and not app.can_read_document(d) then perform app.raise('FORBIDDEN', '{"field":"document_ids"}'); end if;
    if d.machine_id is not null and d.machine_id <> p_machine_id then
      perform app.raise('VALIDATION', '{"field":"document_ids","reason":"belongs_to_other_machine"}');
    end if;
    update public.documents set machine_id = p_machine_id,
      visibility = case when visibility = 'owner' then 'owner_and_financier' else visibility end
    where id = d.id;
    out_ids := out_ids || d.id;
  end loop;
  return out_ids;
end $$;

-- The documents ride along in the encumbrance JSON, filtered by what the viewer may read.
create or replace function app.encumbrance_json(e public.encumbrances, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'type', e.type, 'status', e.status, 'start_date', e.start_date, 'end_date', e.end_date,
    'holder', jsonb_build_object('id', e.holder_org_id, 'name', (select name from public.organizations where id = e.holder_org_id)),
    'confirmed_at', e.confirmed_at, 'released_at', e.released_at, 'created_at', e.created_at)
    || case when p_full then jsonb_build_object('contract_ref', e.contract_ref, 'notes', e.notes,
         'counterparty', app.org_brief(e.counterparty_org_id), 'transferred_from_encumbrance_id', e.transferred_from_encumbrance_id,
         'rejected_reason', e.rejected_reason,
         'documents', coalesce((select jsonb_agg(app.document_json(d) order by d.created_at)
           from public.documents d where d.id = any (e.document_ids) and d.archived_at is null and app.can_read_document(d)), '[]'::jsonb))
       else '{}'::jsonb end
$$;

-- ---------- Documents on a financing ----------
-- Old signatures dropped: an added default parameter would otherwise leave an ambiguous overload behind.
drop function if exists public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid);
drop function if exists public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text);

create or replace function public.register_encumbrance(p_org_id uuid, p_machine_id uuid, p_type public.encumbrance_type,
  p_contract_ref text default null, p_start_date date default current_date, p_end_date date default null,
  p_counterparty_org_id uuid default null, p_notes text default null, p_signature_id uuid default null,
  p_document_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances;
  sig uuid; params jsonb; ev public.events; docs uuid[];
begin
  perform app.require_scope('encumbrances:write');
  if not (app.has_org_type(actor, 'financier') or app.is_operator('superadmin')) then perform app.raise('FORBIDDEN'); end if;
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  perform app.assert_not_blocked(m.id, 'register_encumbrance');
  perform app.validate_encumbrance_params(p_type, p_start_date, p_end_date);
  params := jsonb_build_object('type', p_type, 'contract_ref', p_contract_ref, 'start_date', p_start_date, 'end_date', p_end_date);
  -- Conflict is checked before the signature is consumed so a blocked attempt never uses up the signature.
  if p_type in ('ownership_reservation', 'leasing') then
    select * into existing from public.encumbrances where machine_id = m.id and status = 'active'
      and type in ('ownership_reservation', 'leasing') for update;
    if existing.id is null then
      select * into existing from public.encumbrances where machine_id = m.id and status = 'pending'
        and type in ('ownership_reservation', 'leasing') and holder_org_id <> actor limit 1;
    end if;
    if existing.id is not null then
      return app.encumbrance_conflict(m.id, actor, existing, params);
    end if;
  end if;
  sig := app.consume_signature(p_signature_id, 'register_encumbrance', m.id, params, true);
  -- A pending request from the owner to the same holder is fulfilled by this registration.
  update public.encumbrances set status = 'rejected', rejected_reason = 'superseded'
  where machine_id = m.id and status = 'pending' and holder_org_id = actor;
  docs := app.bind_encumbrance_documents(actor, m.id, p_document_ids);
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id, signature_id, confirmed_at, notes, document_ids)
  values (m.id, p_type, actor, coalesce(p_counterparty_org_id, m.owner_org_id), nullif(trim(p_contract_ref), ''), coalesce(p_start_date, current_date),
    p_end_date, 'active', actor, auth.uid(), sig, now(), nullif(trim(p_notes), ''), docs)
  returning * into e;
  ev := app.log_event('encumbrance.registered', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', actor, 'start_date', e.start_date, 'end_date', e.end_date));
  perform app.notify_org(m.owner_org_id, 'encumbrance.registered',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'holder', (select name from public.organizations where id = actor), 'type', e.type),
    '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  perform app.enqueue_webhook(actor, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  perform app.after_encumbrance_change(e.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true));
end $$;


create or replace function public.request_encumbrance(p_org_id uuid, p_machine_id uuid, p_holder_org_id uuid default null,
  p_type public.encumbrance_type default 'ownership_reservation', p_contract_ref text default null,
  p_start_date date default current_date, p_end_date date default null,
  p_holder_org_number text default null, p_holder_name text default null, p_holder_email text default null,
  p_document_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances;
  ev public.events; holder uuid; placeholder boolean; docs uuid[];
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if (m.owner_org_id = actor or m.registered_by_org_id = actor or m.first_sale_dealer_org_id = actor) is not true then perform app.raise('FORBIDDEN'); end if;
  perform app.assert_not_blocked(m.id, 'request_encumbrance');
  -- Either an organisation we already know, or a bank named by its organisation number (which creates an
  -- unclaimed placeholder the bank can take over later).
  if p_holder_org_id is not null then
    holder := p_holder_org_id;
  elsif nullif(trim(p_holder_org_number), '') is not null then
    holder := app.resolve_org_by_number(actor, p_holder_org_number, array['financier']::public.org_type[], p_holder_name, p_holder_email);
  else
    perform app.raise('VALIDATION', '{"field":"holder_org_id"}');
  end if;
  if not app.can_be_financier_holder(holder) then perform app.raise('FINANCIER_NOT_ELIGIBLE', jsonb_build_object('holder_org_id', holder)); end if;
  perform app.validate_encumbrance_params(p_type, p_start_date, p_end_date);
  if p_type in ('ownership_reservation', 'leasing') then
    select * into existing from public.encumbrances where machine_id = m.id and status = 'active' and type in ('ownership_reservation', 'leasing');
    if existing.id is not null then
      return app.encumbrance_conflict(m.id, actor, existing, jsonb_build_object('type', p_type, 'requested_holder_org_id', holder));
    end if;
  end if;
  docs := app.bind_encumbrance_documents(actor, m.id, p_document_ids);
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id, document_ids)
  values (m.id, p_type, holder, m.owner_org_id, nullif(trim(p_contract_ref), ''), coalesce(p_start_date, current_date), p_end_date,
    'pending', actor, auth.uid(), docs)
  returning * into e;
  placeholder := not exists (select 1 from public.memberships where org_id = holder and status = 'active');
  ev := app.log_event('encumbrance.requested', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', holder, 'holder_unclaimed', placeholder));
  -- notify_org writes nothing for an organisation without active members. That is fine and deliberate: get_inbox
  -- and list_portfolio are derived from table state, so every pending row materialises the moment the bank claims
  -- the organisation. The invitation e-mail (resolve_org_by_number) is what knocks on the door.
  perform app.notify_org(holder, 'encumbrance.pending',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'requested_by', (select name from public.organizations where id = actor),
      'encumbrance_id', e.id), '/inbox', 'warning');
  perform app.enqueue_webhook(holder, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true),
    'holder', app.org_brief(holder), 'holder_unclaimed', placeholder);
end $$;


revoke all on function public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid, uuid[]), public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text, uuid[]) from public;
grant execute on function public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid, uuid[]), public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text, uuid[]) to authenticated, service_role;

-- ---------- A reported-but-unconfirmed financing is visible ----------
create or replace function app.pending_financing(p_machine_id uuid)
returns public.encumbrances language sql stable security definer set search_path = '' as $$
  select * from public.encumbrances where machine_id = p_machine_id and status = 'pending'
    and type in ('ownership_reservation', 'leasing') and transferred_from_encumbrance_id is null
  order by created_at desc limit 1
$$;

create or replace function app.machine_view_extras(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owner_like boolean := p_rel && array['owner', 'user'];
  sees_yes_no boolean := owner_like or p_rel && array['operator', 'authority', 'holder', 'transfer_party', 'checker']
    or (p_org_id is not null and (app.has_org_type(p_org_id, 'dealer') or app.has_org_type(p_org_id, 'financier')
      or app.has_org_type(p_org_id, 'insurer') or app.has_org_type(p_org_id, 'inspector') or app.has_org_type(p_org_id, 'marketplace')));
  -- Who holds it: owner (own), dealer at trade-in (transfer_party), every financier, authority, operator (SPEC §2.6).
  sees_holder boolean := owner_like or p_rel && array['operator', 'authority', 'transfer_party', 'holder']
    or (p_org_id is not null and app.has_org_type(p_org_id, 'financier'));
  sees_flag_details boolean := owner_like or p_rel && array['operator', 'authority', 'holder', 'insurer'];
  af public.encumbrances := app.active_financing(m.id);
  pf public.encumbrances := app.pending_financing(m.id);
  x jsonb := '{}'::jsonb;
begin
  if sees_yes_no then
    x := x || jsonb_build_object('financing', jsonb_build_object(
      'has_active', af.id is not null,
      -- A financing reported to the bank but not yet confirmed. Surfaced so the dealer sees "Belåning anmäld"
      -- immediately instead of "Ej belånad" (the reported defect); deliberately NOT part of has_active.
      'has_pending', pf.id is not null,
      'pending', case when pf.id is not null and sees_holder then app.encumbrance_json(pf, owner_like or pf.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel)) end,
      'active', case when af.id is not null and sees_holder then app.encumbrance_json(af, owner_like or af.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel)) end,
      'min_trusted_level', case when p_org_id is null then 0 else coalesce((select (settings ->> 'min_trusted_level')::int from public.organizations where id = p_org_id), 0) end));
  end if;
  if owner_like or p_rel && array['operator', 'authority', 'holder'] then
    x := x || jsonb_build_object('encumbrances', coalesce((select jsonb_agg(app.encumbrance_json(e,
        owner_like or e.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel)) order by e.created_at desc)
      from public.encumbrances e where e.machine_id = m.id
        and (owner_like or 'operator' = any (p_rel) or 'authority' = any (p_rel) or e.holder_org_id = p_org_id)), '[]'::jsonb));
  end if;
  x := x || jsonb_build_object('flags', coalesce((select jsonb_agg(case when sees_flag_details then jsonb_build_object('id', f.id, 'type', f.type,
        'status', f.status, 'reference', f.reference,
        'description', case when f.type in ('blocked', 'under_investigation', 'seized') and not (owner_like or p_rel && array['operator', 'authority']) then null else f.description end,
        'raised_at', f.raised_at, 'raised_by', (select name from public.organizations where id = f.raised_by_org_id),
        'can_clear', f.raised_by_org_id = p_org_id or p_rel && array['operator', 'authority'],
        'occurred_at', f.occurred_at, 'location_text', f.location_text, 'cleared_at', f.cleared_at)
      else jsonb_build_object('type', f.type, 'status', f.status, 'raised_at', f.raised_at) end order by f.raised_at desc)
    from public.flags f where f.machine_id = m.id and (f.status = 'active' or sees_flag_details)), '[]'::jsonb));
  x := x || jsonb_build_object('last_transfer_date', (select max(effective_date) from public.transfers where machine_id = m.id and status = 'completed'));
  if owner_like or p_rel && array['operator', 'authority', 'transfer_party', 'holder'] then
    x := x || jsonb_build_object('open_transfer', (select app.transfer_json(t) from public.transfers t
      where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1));
  end if;
  return x || app.machine_view_extras_more(m, p_rel, p_org_id);
end $$;


create or replace function app.machine_list_extras(m public.machines, p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'has_active_financing', (app.active_financing(m.id)).id is not null,
    -- A financing reported to a lender but not confirmed yet, so a list can show "Belåning anmäld".
    'has_pending_financing', (app.pending_financing(m.id)).id is not null,
    'active_flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
    'open_transfer_status', (select t.status from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1),
    'project', (select a.name from public.machine_assignments a where a.machine_id = m.id and a.org_id = p_org and a.to_date is null limit 1),
    'next_action', (select jsonb_build_object('title', r.title, 'type', r.type, 'due_at', r.due_at, 'due_hours', r.due_hours)
      from public.reminders r where r.machine_id = m.id and r.org_id = p_org and r.status = 'open' order by r.due_at nulls last limit 1),
    'inspection_valid_until', case when m.has_lifting_device then app.inspection_valid_until(m.id) end,
    'operational_status', case when m.owner_org_id = p_org or m.user_org_id = p_org then m.operational_status end,
    'operator', (select o.name from public.machine_operators mo join public.operators o on o.id = mo.operator_id
      where mo.machine_id = m.id and mo.org_id = p_org and mo.to_at is null limit 1),
    'last_daily_check', (select jsonb_build_object('at', d.created_at, 'result', d.result) from public.daily_checks d
      where d.machine_id = m.id and d.org_id = p_org order by d.created_at desc limit 1),
    'department', (select jsonb_build_object('id', dp.id, 'name', dp.name) from public.machine_departments md join public.departments dp on dp.id = md.department_id
      where md.machine_id = m.id and md.org_id = p_org),
    'consignment', (select jsonb_build_object('mandate_id', d.id, 'principal', (select name from public.organizations where id = d.principal_org_id), 'valid_to', d.valid_to)
      from public.mandates d where d.machine_id = m.id and d.agent_org_id = p_org and d.kind = 'consignment' and d.status = 'active' limit 1))
$$;

-- ---------- The transfer carries the reported financing, not just the request payload ----------
-- transfer_json exposed `new_financing` (the raw request) but never the encumbrance it produced, so the sale
-- page had nothing to show the dealer after reporting the buyer's bank. `new_encumbrance` closes that: the
-- dealer sees "anmäld till <bank> – väntar på bekräftelse" instead of nothing.
create or replace function app.transfer_json(t public.transfers)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when t.id is null then null else jsonb_build_object('id', t.id, 'machine_id', t.machine_id,
    'reg_number', (select reg_number from public.machines where id = t.machine_id),
    'from', app.org_brief(t.from_org_id), 'to', app.org_brief(t.to_org_id), 'to_email', t.to_email,
    'to_org_number', case when app.is_sole_trader_number(t.to_org_number) then '19XXXXXX-XXXX' else t.to_org_number end,
    'sale_date', t.sale_date, 'reported_at', t.reported_at, 'effective_date', t.effective_date, 'status', t.status,
    'is_trade_in', t.is_trade_in, 'financier_decision', t.financier_decision, 'expires_at', t.expires_at,
    'completed_at', t.completed_at, 'cancelled_reason', t.cancelled_reason, 'document_ids', to_jsonb(t.document_ids),
    'existing_encumbrance', case when t.existing_encumbrance_id is null then null else
      (select jsonb_build_object('id', e.id, 'type', e.type, 'holder', jsonb_build_object('id', e.holder_org_id,
        'name', (select name from public.organizations where id = e.holder_org_id))) from public.encumbrances e where e.id = t.existing_encumbrance_id) end,
    'new_encumbrance', case when t.new_encumbrance_id is null then null else
      (select jsonb_build_object('id', e.id, 'type', e.type, 'status', e.status, 'holder', jsonb_build_object('id', e.holder_org_id,
        'name', (select name from public.organizations where id = e.holder_org_id))) from public.encumbrances e where e.id = t.new_encumbrance_id) end,
    'new_financing', t.new_financing, 'created_at', t.created_at) end
$$;

-- ---------- The buyer's financing reaches the bank at sale time ----------
-- Shared by initiate_transfer and (for older transfers) accept_transfer.
create or replace function app.open_new_financing(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.transfers; m public.machines; nf jsonb; e public.encumbrances; ev public.events; holder uuid;
begin
  select * into t from public.transfers where id = p_transfer_id for update;
  if t.id is null or t.new_financing is null or t.new_encumbrance_id is not null then return null; end if;
  nf := t.new_financing;
  -- The buyer's bank may be named by organisation number instead of id, so a dealer selling a machine financed
  -- by a bank that does not use MaskinID does not have to leave the sale flow (ADR 0027).
  holder := (nf ->> 'holder_org_id')::uuid;
  if holder is null and nullif(nf ->> 'holder_org_number', '') is not null then
    holder := app.resolve_org_by_number(t.initiated_by_org_id, nf ->> 'holder_org_number', array['financier']::public.org_type[],
      nf ->> 'holder_name', nf ->> 'holder_email');
  end if;
  if holder is null then perform app.raise('VALIDATION', '{"field":"new_financing.holder_org_id"}'); end if;
  if not app.can_be_financier_holder(holder) then perform app.raise('FINANCIER_NOT_ELIGIBLE', jsonb_build_object('holder_org_id', holder)); end if;
  select * into m from public.machines where id = t.machine_id;
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date,
    status, requested_by_org_id, registered_by_user_id)
  values (m.id, coalesce(nf ->> 'type', 'ownership_reservation')::public.encumbrance_type, holder,
    coalesce(t.to_org_id, m.owner_org_id), nullif(trim(nf ->> 'contract_ref'), ''),
    coalesce((nf ->> 'start_date')::date, t.sale_date, current_date), (nf ->> 'end_date')::date,
    'pending', t.initiated_by_org_id, auth.uid())
  returning * into e;
  update public.transfers set new_encumbrance_id = e.id where id = t.id;
  ev := app.log_event('encumbrance.requested', m.id, m.owner_org_id, t.initiated_by_org_id,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', holder, 'transfer_id', t.id));
  perform app.notify_org(holder, 'encumbrance.pending',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'encumbrance_id', e.id,
      'requested_by', (select name from public.organizations where id = t.initiated_by_org_id)), '/inbox', 'warning');
  perform app.enqueue_webhook(holder, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  return e.id;
end $$;

create or replace function public.initiate_transfer(p_org_id uuid, p_machine_id uuid, p_sale_date date default current_date,
  p_to_org_id uuid default null, p_to_org_number text default null, p_to_email text default null,
  p_new_financing jsonb default null, p_document_ids uuid[] default '{}', p_is_trade_in boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; buyer uuid; t public.transfers; fin public.encumbrances; agent boolean;
begin
  perform app.require_scope('transfers:write');
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  fin := app.active_financing(m.id);
  agent := m.owner_org_id <> actor and app.has_mandate(m.id, actor, 'sell');
  -- Seller: current owner (dealer for stock machines), the holder of a leasing object, an agent with a sell mandate, or an operator.
  if (m.owner_org_id = actor or (fin.type = 'leasing' and fin.holder_org_id = actor) or agent or app.is_operator('superadmin')) is not true then
    perform app.raise('FORBIDDEN');
  end if;
  perform app.assert_not_blocked(m.id, 'initiate_transfer');
  if exists (select 1 from public.transfers where machine_id = m.id and status in ('draft', 'awaiting_buyer', 'awaiting_financier')) then
    perform app.raise('TRANSFER_ALREADY_OPEN');
  end if;
  if p_sale_date is null or p_sale_date > current_date then perform app.raise('VALIDATION', '{"field":"sale_date"}'); end if;
  if p_to_org_id is not null then
    buyer := p_to_org_id;
    if not exists (select 1 from public.organizations where id = buyer and status <> 'suspended') then perform app.raise('VALIDATION', '{"field":"to_org_id"}'); end if;
  elsif nullif(p_to_org_number, '') is not null then
    buyer := app.resolve_owner_org(actor, jsonb_build_object('owner_org_number', p_to_org_number));
  elsif nullif(trim(p_to_email), '') is null then
    perform app.raise('VALIDATION', '{"field":"buyer"}');
  end if;
  if buyer = m.owner_org_id then perform app.raise('VALIDATION', '{"field":"buyer","reason":"same_as_owner"}'); end if;
  if p_new_financing is not null and not (nullif(p_new_financing ->> 'holder_org_number', '') is not null
     or app.can_be_financier_holder((p_new_financing ->> 'holder_org_id')::uuid)) then
    perform app.raise('VALIDATION', '{"field":"new_financing.holder_org_id"}');
  end if;
  insert into public.transfers (machine_id, from_org_id, to_org_id, to_org_number, to_email, initiated_by_user_id, initiated_by_org_id,
    sale_date, reported_at, effective_date, status, is_trade_in, new_financing, document_ids)
  values (m.id, m.owner_org_id, buyer, app.normalize_org_number(p_to_org_number), lower(nullif(trim(p_to_email), '')), auth.uid(), actor,
    p_sale_date, now(), app.transfer_effective_date(p_sale_date, now()), 'draft', coalesce(p_is_trade_in, false), p_new_financing,
    coalesce(p_document_ids, '{}'))
  returning * into t;
  -- The buyer's financing is reported to the bank now, not when the buyer accepts. Until this change the
  -- encumbrance did not exist until accept_transfer, so the machine read "Ej belånad" for days and the bank
  -- heard nothing — exactly the reported defect. The partial unique index covers active rows only, so a
  -- pending row may sit beside the seller's active one.
  if p_new_financing is not null then perform app.open_new_financing(t.id); end if;
  t := app.open_transfer(t.id);
  if agent then
    perform app.log_event('mandate.used', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id, 'scope', 'sell'));
    perform app.notify_org(m.owner_org_id, 'mandate.sale_started', jsonb_build_object('reg_number', m.reg_number, 'transfer_id', t.id,
      'agent', (select name from public.organizations where id = actor)), '/transfers/' || t.id, 'info', 'admin');
  end if;
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;


create or replace function public.accept_transfer(p_org_id uuid, p_transfer_id uuid, p_signature_id uuid default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); t public.transfers; m public.machines; sig uuid; e public.encumbrances;
  nf jsonb; newe public.encumbrances; ev public.events; seller public.organizations;
begin
  perform app.require_scope('transfers:write');
  select * into t from public.transfers where id = p_transfer_id for update;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  if t.to_org_id is null or not exists (select 1 from public.memberships where org_id = t.to_org_id and status = 'active') then
    -- E-mail invite or placeholder buyer: the invite token binds the transfer to the accepting org.
    if p_token is null or t.invite_token_hash is distinct from app.sha256_hex(p_token) then perform app.raise('FORBIDDEN'); end if;
    update public.transfers set to_org_id = actor where id = t.id returning * into t;
  end if;
  if t.to_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if t.status <> 'awaiting_buyer' then perform app.raise('TRANSFER_NOT_AWAITING_BUYER', jsonb_build_object('status', t.status)); end if;
  if t.expires_at < now() then
    update public.transfers set status = 'expired' where id = t.id;
    perform app.raise('TRANSFER_EXPIRED');
  end if;
  select * into m from public.machines where id = t.machine_id for update;
  perform app.assert_not_blocked(m.id, 'accept_transfer');
  -- Always a personal signature (never an API key alone).
  sig := app.consume_signature(p_signature_id, 'accept_transfer', t.id);
  select * into seller from public.organizations where id = t.from_org_id;

  update public.ownerships set to_date = greatest(t.effective_date, from_date) where machine_id = m.id and to_date is null;
  insert into public.ownerships (machine_id, owner_org_id, from_date, acquired_via, transfer_id)
  values (m.id, actor, t.effective_date, 'transfer', t.id);
  update public.machines set owner_org_id = actor,
    user_org_id = case when user_org_id = t.from_org_id then null else user_org_id end,
    stock_status = case when app.has_org_type(actor, 'dealer') then case when t.is_trade_in then 'trade_in' else 'stock' end end
  where id = m.id;

  -- Existing financing: released (already done), carried over to the buyer, or – if the holder is the seller (leasing
  -- object sold by the lessor) – ended.
  if t.existing_encumbrance_id is not null then
    select * into e from public.encumbrances where id = t.existing_encumbrance_id for update;
    if e.status = 'active' and t.financier_decision = 'transfer_to_buyer' then
      update public.encumbrances set counterparty_org_id = actor where id = e.id;
      perform app.log_event('encumbrance.counterparty_changed', m.id, actor, e.holder_org_id, jsonb_build_object('encumbrance_id', e.id, 'counterparty_org_id', actor));
    end if;
  end if;
  update public.encumbrances set status = 'released', released_at = now(), notes = coalesce(notes, '') || ' [ended by sale]'
  where machine_id = m.id and status = 'active' and holder_org_id = t.from_org_id and type in ('leasing', 'rental');

  -- The pending row is normally created by initiate_transfer; only create it here for transfers that predate
  -- that change. Either way the counterparty becomes the buyer now that they own the machine.
  nf := t.new_financing;
  if nf is not null then
    if t.new_encumbrance_id is null then
      perform app.open_new_financing(t.id);
      select * into t from public.transfers where id = t.id;
    end if;
    update public.encumbrances set counterparty_org_id = actor where id = t.new_encumbrance_id and status = 'pending';
  end if;
  update public.transfers set status = 'completed', completed_at = now(), buyer_signature_id = sig where id = t.id returning * into t;
  update public.machines set updated_at = now() where id = m.id;
  ev := app.log_event('ownership.transferred', m.id, actor, actor, jsonb_build_object('transfer_id', t.id, 'from_org_id', t.from_org_id,
    'to_org_id', actor, 'effective_date', t.effective_date, 'sale_date', t.sale_date, 'reported_at', t.reported_at, 'is_trade_in', t.is_trade_in));
  perform app.log_event('transfer.completed', m.id, actor, actor, jsonb_build_object('transfer_id', t.id));
  perform app.notify_org(t.from_org_id, 'transfer.completed', jsonb_build_object('transfer_id', t.id, 'reg_number', m.reg_number,
    'buyer', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(t.from_org_id, 'transfer.completed', m.id, jsonb_build_object('transfer_id', t.id, 'role', 'seller'), ev.id);
  perform app.enqueue_webhook(actor, 'transfer.completed', m.id, jsonb_build_object('transfer_id', t.id, 'role', 'buyer'), ev.id);
  perform app.after_transfer_completed(t.id);
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t), 'machine', app.machine_view(m.id, actor));
end $$;


-- ---------- Trade-in: find the machine by serial, and see the payoff in the same answer ----------
-- The page previously offered only "Scanna märke" and a registration-number field, because the RPC accepted only
-- p_code and p_reg. A dealer standing at a machine normally has the serial/VIN on the nameplate, not a MaskinID
-- label. The identifier branch is the same exact-match query lookup_machine uses.
drop function if exists public.trade_in_lookup(uuid, text, text);

create or replace function public.trade_in_lookup(p_org_id uuid, p_code text default null, p_reg text default null,
  p_serial text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); m public.machines; l public.labels;
  fin public.encumbrances; pend public.encumbrances; t public.transfers; po public.payoff_requests; q text;
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  if p_code is not null then
    select * into l from public.labels where code = p_code;
    if l.id is not null and l.machine_id is not null then select * into m from public.machines where id = l.machine_id; end if;
  elsif nullif(trim(p_reg), '') is not null then
    select * into m from public.machines where reg_number = app.normalize_reg_number(p_reg);
  elsif nullif(trim(p_serial), '') is not null then
    q := app.normalize_identifier(p_serial);
    if q is null or length(q) < 4 then perform app.raise('VALIDATION', '{"field":"serial"}'); end if;
    select mm.* into m from public.machine_identifiers x join public.machines mm on mm.id = x.machine_id
    where x.normalized_value = q and mm.status <> 'draft'
    order by x.unique_active desc, case x.type when 'pin' then 1 when 'serial' then 2 when 'vin' then 3 else 9 end limit 1;
  else
    perform app.raise('VALIDATION', '{"field":"query"}');
  end if;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  fin := app.active_financing(m.id);
  pend := app.pending_financing(m.id);
  select * into t from public.transfers where machine_id = m.id and status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1;
  select * into po from public.payoff_requests where machine_id = m.id
    and status in ('requested', 'quoted', 'settlement_submitted') order by created_at desc limit 1;
  perform app.after_lookup(actor, array[m.id], 'scan');
  return jsonb_build_object('machine', app.machine_view(m.id, actor),
    'financing', jsonb_build_object('has_active', fin.id is not null, 'type', fin.type,
      'encumbrance_id', fin.id,
      'holder', case when fin.id is not null then (select name from public.organizations where id = fin.holder_org_id) end,
      'has_pending', pend.id is not null,
      'pending_holder', case when pend.id is not null then (select name from public.organizations where id = pend.holder_org_id) end),
    -- The lender's own details, so the dealer can see who to talk to about the payoff.
    'financier', case when fin.id is not null then public.get_financier_profile(fin.holder_org_id) end,
    'payoff', case when po.id is not null then app.payoff_json(po) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'created_at', e.created_at) order by e.seq desc)
      from (select * from public.events where machine_id = m.id and type in ('machine.registered', 'ownership.transferred', 'machine.verified',
            'encumbrance.registered', 'encumbrance.released', 'flag.raised', 'flag.cleared', 'inspection.recorded',
            'machine.exported', 'machine.reimported', 'payoff.requested', 'payoff.settled') order by seq desc limit 20) e), '[]'::jsonb),
    'open_transfer', app.transfer_json(t),
    'is_owner', m.owner_org_id = actor);
end $$;

revoke all on function public.trade_in_lookup(uuid, text, text, text) from public;
grant execute on function public.trade_in_lookup(uuid, text, text, text) to authenticated, service_role;
