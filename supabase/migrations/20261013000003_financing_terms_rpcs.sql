-- =====================================================================================================================
-- The write and read paths for financing terms (ADR 0029), continued from 20261013000002.
--
-- Three doors write a financing, and all three now require an agreement number and accept the terms:
--   1. register_encumbrance  – the lender registers it itself
--   2. request_encumbrance   – the dealer or owner reports it to the bank
--   3. app.open_new_financing – the buyer's financing reported from the sale flow (transfers.new_financing)
--
-- Door 3 is also an amount leak that the exposure matrix in 26_financing_terms.test.ts would not otherwise catch:
-- `transfers.new_financing` is stored verbatim and app.transfer_json returned it raw, while machine_view_extras
-- shows `open_transfer` to the authority and to a dealer at trade-in. The terms are therefore stripped out of
-- the transfer row as soon as they have been copied onto the encumbrance, and transfer_json strips whatever is
-- left on rows written before this migration.
-- =====================================================================================================================

-- ---------- Keys that must never stay on a transfer row ----------
create or replace function app.strip_financing_terms(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then p
    else p - 'financing_amount' - 'down_payment' - 'residual_value' - 'amortization_months' - 'interest_rate'
           - 'monthly_cost' - 'total_credit_amount' - 'terms_overridden' end
$$;
grant execute on function app.strip_financing_terms(jsonb) to authenticated, service_role;

-- ---------- transfer_json: never the terms ----------
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
    -- Stripped: open_transfer is visible to the authority and to a dealer at trade-in, and the terms are for the
    -- owner and the lender only (ADR 0029). The figures live on the encumbrance the sale produced.
    'new_financing', app.strip_financing_terms(t.new_financing), 'created_at', t.created_at) end
$$;

-- ---------- Door 1: the lender registers the financing ----------
-- The 10-argument signature is dropped so the added default cannot leave an ambiguous overload behind.
drop function if exists public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid, uuid[]);

create or replace function public.register_encumbrance(p_org_id uuid, p_machine_id uuid, p_type public.encumbrance_type,
  p_contract_ref text default null, p_start_date date default current_date, p_end_date date default null,
  p_counterparty_org_id uuid default null, p_notes text default null, p_signature_id uuid default null,
  p_document_ids uuid[] default '{}', p_terms jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances;
  sig uuid; params jsonb; ev public.events; docs uuid[]; ref text;
begin
  perform app.require_scope('encumbrances:write');
  if not (app.has_org_type(actor, 'financier') or app.is_operator('superadmin')) then perform app.raise('FORBIDDEN'); end if;
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  perform app.assert_not_blocked(m.id, 'register_encumbrance');
  perform app.validate_encumbrance_params(p_type, p_start_date, p_end_date);
  ref := app.require_contract_ref(p_contract_ref);
  params := jsonb_build_object('type', p_type, 'contract_ref', ref, 'start_date', p_start_date, 'end_date', p_end_date);
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
  values (m.id, p_type, actor, coalesce(p_counterparty_org_id, m.owner_org_id), ref, coalesce(p_start_date, current_date),
    p_end_date, 'active', actor, auth.uid(), sig, now(), nullif(trim(p_notes), ''), docs)
  returning * into e;
  e := app.apply_financing_terms(e.id, p_terms);
  -- No amounts in the event payload: events are hash-chained, exported in register extracts and readable by
  -- everyone with full access to the machine. `terms_set` records that figures exist without revealing them.
  ev := app.log_event('encumbrance.registered', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', actor, 'start_date', e.start_date,
      'end_date', e.end_date, 'contract_ref', e.contract_ref, 'terms_set', e.financing_amount is not null));
  perform app.notify_org(m.owner_org_id, 'encumbrance.registered',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'holder', (select name from public.organizations where id = actor), 'type', e.type),
    '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  perform app.enqueue_webhook(actor, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  perform app.after_encumbrance_change(e.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true) || app.encumbrance_terms_json(e));
end $$;

-- ---------- Door 2: the dealer or owner reports the financing to the bank ----------
drop function if exists public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text, uuid[]);

create or replace function public.request_encumbrance(p_org_id uuid, p_machine_id uuid, p_holder_org_id uuid default null,
  p_type public.encumbrance_type default 'ownership_reservation', p_contract_ref text default null,
  p_start_date date default current_date, p_end_date date default null,
  p_holder_org_number text default null, p_holder_name text default null, p_holder_email text default null,
  p_document_ids uuid[] default '{}', p_terms jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances;
  ev public.events; holder uuid; placeholder boolean; docs uuid[]; ref text;
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
  ref := app.require_contract_ref(p_contract_ref);
  if p_type in ('ownership_reservation', 'leasing') then
    select * into existing from public.encumbrances where machine_id = m.id and status = 'active' and type in ('ownership_reservation', 'leasing');
    if existing.id is not null then
      return app.encumbrance_conflict(m.id, actor, existing, jsonb_build_object('type', p_type, 'requested_holder_org_id', holder));
    end if;
  end if;
  docs := app.bind_encumbrance_documents(actor, m.id, p_document_ids);
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id, document_ids)
  values (m.id, p_type, holder, m.owner_org_id, ref, coalesce(p_start_date, current_date), p_end_date,
    'pending', actor, auth.uid(), docs)
  returning * into e;
  e := app.apply_financing_terms(e.id, p_terms);
  placeholder := not exists (select 1 from public.memberships where org_id = holder and status = 'active');
  ev := app.log_event('encumbrance.requested', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', holder, 'holder_unclaimed', placeholder,
      'contract_ref', e.contract_ref, 'terms_set', e.financing_amount is not null));
  -- notify_org writes nothing for an organisation without active members. That is fine and deliberate: get_inbox
  -- and list_portfolio are derived from table state, so every pending row materialises the moment the bank claims
  -- the organisation. The invitation e-mail (resolve_org_by_number) is what knocks on the door.
  perform app.notify_org(holder, 'encumbrance.pending',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'requested_by', (select name from public.organizations where id = actor),
      'encumbrance_id', e.id), '/inbox', 'warning');
  perform app.enqueue_webhook(holder, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true) || app.encumbrance_terms_json(e),
    'holder', app.org_brief(holder), 'holder_unclaimed', placeholder);
end $$;

revoke all on function public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid, uuid[], jsonb),
  public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text, uuid[], jsonb) from public;
grant execute on function public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid, uuid[], jsonb),
  public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text, uuid[], jsonb) to authenticated, service_role;

-- ---------- Door 3: the buyer's financing from the sale flow ----------
create or replace function app.open_new_financing(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.transfers; m public.machines; nf jsonb; e public.encumbrances; ev public.events; holder uuid; ref text;
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
  ref := app.require_contract_ref(nf ->> 'contract_ref');
  select * into m from public.machines where id = t.machine_id;
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date,
    status, requested_by_org_id, registered_by_user_id)
  values (m.id, coalesce(nf ->> 'type', 'ownership_reservation')::public.encumbrance_type, holder,
    coalesce(t.to_org_id, m.owner_org_id), ref,
    coalesce((nf ->> 'start_date')::date, t.sale_date, current_date), (nf ->> 'end_date')::date,
    'pending', t.initiated_by_org_id, auth.uid())
  returning * into e;
  e := app.apply_financing_terms(e.id, nf);
  -- The terms now live on the encumbrance, where only the owner and the lender can read them. Taking them off the
  -- transfer row closes the path through transfer_json -> open_transfer -> authority / trade-in dealer.
  update public.transfers set new_encumbrance_id = e.id, new_financing = app.strip_financing_terms(new_financing) where id = t.id;
  ev := app.log_event('encumbrance.requested', m.id, m.owner_org_id, t.initiated_by_org_id,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', holder, 'transfer_id', t.id,
      'contract_ref', e.contract_ref, 'terms_set', e.financing_amount is not null));
  perform app.notify_org(holder, 'encumbrance.pending',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'encumbrance_id', e.id,
      'requested_by', (select name from public.organizations where id = t.initiated_by_org_id)), '/inbox', 'warning');
  perform app.enqueue_webhook(holder, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  return e.id;
end $$;

-- ---------- Correcting the terms ----------
-- Read figures off a document and some of them will be wrong. Without this the only fix is to release the
-- financing and register it again, which breaks the chain for a clerical error.
create or replace function public.update_encumbrance_terms(p_org_id uuid, p_encumbrance_id uuid, p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; m public.machines; before jsonb;
begin
  perform app.require_scope('encumbrances:write');
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into m from public.machines where id = e.machine_id;
  -- The two parties to the financing, and nobody else: these are their own contract figures.
  if (e.holder_org_id = actor or m.owner_org_id = actor) is not true then perform app.raise('FORBIDDEN'); end if;
  if e.status not in ('pending', 'active') then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  before := jsonb_build_object('had_terms', e.financing_amount is not null);
  if p_terms ? 'contract_ref' then
    update public.encumbrances set contract_ref = app.require_contract_ref(p_terms ->> 'contract_ref') where id = e.id;
  end if;
  e := app.apply_financing_terms(e.id, p_terms);
  perform app.log_event('encumbrance.terms_updated', m.id, m.owner_org_id, actor,
    before || jsonb_build_object('encumbrance_id', e.id, 'contract_ref', e.contract_ref, 'terms_set', e.financing_amount is not null));
  -- The other party is told that the figures changed, without the figures being in the notification.
  perform app.notify_org(case when actor = e.holder_org_id then m.owner_org_id else e.holder_org_id end, 'encumbrance.terms_updated',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'by', (select name from public.organizations where id = actor)),
    '/machines/' || m.id, 'info');
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true) || app.encumbrance_terms_json(e));
end $$;
revoke all on function public.update_encumbrance_terms(uuid, uuid, jsonb) from public;
grant execute on function public.update_encumbrance_terms(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------- Reads: the owner and the holder, nobody else ----------
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
      -- The terms ride on their own object and only for the owner of the machine and the lender holding that
      -- very financing (ADR 0029). Note that encumbrance_json's second argument is already true for operators
      -- and authorities, which is exactly why the terms are not part of it.
      'pending', case when pf.id is not null and sees_holder then app.encumbrance_json(pf, owner_like or pf.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and pf.holder_org_id = p_org_id) then app.encumbrance_terms_json(pf) else '{}'::jsonb end end,
      'active', case when af.id is not null and sees_holder then app.encumbrance_json(af, owner_like or af.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and af.holder_org_id = p_org_id) then app.encumbrance_terms_json(af) else '{}'::jsonb end end,
      'min_trusted_level', case when p_org_id is null then 0 else coalesce((select (settings ->> 'min_trusted_level')::int from public.organizations where id = p_org_id), 0) end));
  end if;
  if owner_like or p_rel && array['operator', 'authority', 'holder'] then
    x := x || jsonb_build_object('encumbrances', coalesce((select jsonb_agg(app.encumbrance_json(e,
        owner_like or e.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and e.holder_org_id = p_org_id) then app.encumbrance_terms_json(e) else '{}'::jsonb end
        order by e.created_at desc)
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

-- confirm_encumbrance: the holder is confirming its own financing, so it sees the terms in the answer.
create or replace function public.confirm_encumbrance(p_org_id uuid, p_encumbrance_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; m public.machines; existing public.encumbrances; ev public.events;
begin
  perform app.require_scope('encumbrances:write');
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if e.status <> 'pending' then perform app.raise('ENCUMBRANCE_NOT_PENDING'); end if;
  if e.transferred_from_encumbrance_id is not null then
    perform app.raise('ENCUMBRANCE_IS_TRANSFER', jsonb_build_object('encumbrance_id', e.id));
  end if;
  select * into m from public.machines where id = e.machine_id for update;
  perform app.assert_not_blocked(m.id, 'confirm_encumbrance');
  if e.type in ('ownership_reservation', 'leasing') then
    select * into existing from public.encumbrances where machine_id = m.id and status = 'active' and type in ('ownership_reservation', 'leasing');
    if existing.id is not null then
      return app.encumbrance_conflict(m.id, actor, existing, jsonb_build_object('type', e.type, 'pending_encumbrance_id', e.id));
    end if;
  end if;
  update public.encumbrances set status = 'active', confirmed_at = now() where id = e.id returning * into e;
  ev := app.log_event('encumbrance.confirmed', m.id, m.owner_org_id, actor, jsonb_build_object('encumbrance_id', e.id, 'type', e.type));
  perform app.notify_org(m.owner_org_id, 'encumbrance.confirmed',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'holder', (select name from public.organizations where id = actor)),
    '/machines/' || m.id, 'info');
  if e.requested_by_org_id is not null and e.requested_by_org_id <> m.owner_org_id then
    perform app.notify_org(e.requested_by_org_id, 'encumbrance.confirmed',
      jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'holder', (select name from public.organizations where id = actor)),
      '/machines/' || m.id, 'info');
  end if;
  perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', e.id), ev.id);
  perform app.after_encumbrance_change(e.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true) || app.encumbrance_terms_json(e));
end $$;

-- The lender's own portfolio: every row is one it holds, which is the one relation allowed to see the terms.
-- Without this the feature is half-built for the customer paying for it.
create or replace function public.list_portfolio(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if app.has_org_type(actor, 'financier') then
    return coalesce((select jsonb_agg(jsonb_build_object('kind', 'encumbrance', 'id', e.id, 'type', e.type, 'status', e.status,
        'contract_ref', e.contract_ref, 'start_date', e.start_date, 'end_date', e.end_date, 'machine_id', m.id, 'reg_number', m.reg_number,
        'make', m.make, 'model', m.model, 'year', m.year, 'machine_status', m.status, 'verification_level', m.verification_level,
        'owner', (select name from public.organizations where id = m.owner_org_id),
        'flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
        'open_transfer', (select t.status from public.transfers t where t.machine_id = m.id and t.status in ('awaiting_buyer', 'awaiting_financier') limit 1),
        'last_event_at', (select max(created_at) from public.events ev where ev.machine_id = m.id)) || app.encumbrance_terms_json(e)
        order by e.start_date desc)
      from public.encumbrances e join public.machines m on m.id = e.machine_id
      where e.holder_org_id = actor and e.status in ('active', 'pending')), '[]'::jsonb);
  elsif app.has_org_type(actor, 'insurer') then
    return coalesce((select jsonb_agg(jsonb_build_object('kind', 'policy', 'id', ip.id, 'policy_number', ip.policy_number, 'coverage', ip.coverage,
        'status', ip.status, 'valid_from', ip.valid_from, 'valid_to', ip.valid_to, 'requires_verification_level', ip.requires_verification_level,
        'machine_id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year, 'machine_status', m.status,
        'verification_level', m.verification_level, 'owner', (select name from public.organizations where id = m.owner_org_id),
        'flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
        'last_event_at', (select max(created_at) from public.events ev where ev.machine_id = m.id)) order by ip.valid_to desc)
      from public.insurance_policies ip join public.machines m on m.id = ip.machine_id
      where ip.insurer_org_id = actor and ip.status = 'active'), '[]'::jsonb);
  end if;
  perform app.raise('FORBIDDEN');
  return null;
end $$;

-- ---------- Webhooks and the API learn the new event ----------
create or replace function app.webhook_event_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['machine.registered', 'machine.verified', 'encumbrance.pending', 'encumbrance.confirmed', 'encumbrance.conflict',
    'encumbrance.released', 'encumbrance.terms_updated', 'transfer.initiated', 'transfer.awaiting_you', 'transfer.completed',
    'flag.raised', 'flag.cleared', 'machine.scanned', 'market.alert', 'label.bound', 'lead.created', 'ping',
    'payoff.requested', 'payoff.quoted', 'payoff.settlement_submitted', 'payoff.settled', 'payoff.declined',
    'machine.exported', 'machine.reimported']
$$;
