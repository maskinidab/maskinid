-- =====================================================================================================================
-- Every account type can look up a serial and see whether a machine is financed; the full history needs the
-- owner's consent (ADR 0032).
--
-- "Vi behöver låsa upp så att samtliga kontotyper/profiler kan söka på VIN/serienummer och se maskinens
--  grundinformation samt om den är belånad eller har någon aktiv finansieringsspärr. Däremot ska inte vem som
--  helst kunna se hela maskinens historik. Vill man ha tillgång till den fullständiga historiken ska man kunna
--  skicka en förfrågan till maskinägaren, som sedan får godkänna att informationen delas."
--
-- "Enskild firma verkar inte kunna se historiken när de söker på ett serienummer."
--
-- Those two are one root cause, and it is not `is_sole_trader` — nothing in any permission path reads that flag.
-- A sole proprietor and a plain company account both have `types = {owner}`, and `app.machine_view_extras` only
-- emitted the financing block for an org with a relation to the machine or one of the partner types
-- (dealer/financier/insurer/inspector/marketplace). So a search returned the make and model and nothing about
-- financing, and the machine page then raised NOT_FOUND because there was no relation at all.
--
-- `lookup_machine` is the search that opens up, NOT `perform_check`. perform_check inserts a check_receipt, and
-- `check_receipts` carries an after-insert metering trigger priced at 49 kr (20260927000024:98,171-178); it also
-- grants the `checker` relation for 24 hours and feeds app.risk_signals' `many_recent_checks` at three distinct
-- checking organisations in 30 days. Opening it to every account type would bill curiosity and let three
-- strangers poison a machine's risk profile. lookup_machine writes only an access-log row, which the owner can
-- already read.
-- =====================================================================================================================

-- ---------- Anyone may see "belånad", nobody new may see who holds it ----------
create or replace function app.machine_view_extras(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owner_like boolean := p_rel && array['owner', 'user'];
  -- Whether the machine is financed is now available to every signed-in organisation, whatever its type: that is
  -- the question a buyer, a seller or a sole proprietor asks before paying for a machine (ADR 0032). Who the
  -- lender is, and the terms, stay narrow. Guarded on p_org_id so the public card (p_org_id null) is unchanged.
  sees_yes_no boolean := p_org_id is not null;
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
  if owner_like or p_rel && array['operator', 'authority', 'holder', 'former_holder'] then
    x := x || jsonb_build_object('encumbrances', coalesce((select jsonb_agg(app.encumbrance_json(e,
        owner_like or e.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and e.holder_org_id = p_org_id) then app.encumbrance_terms_json(e) else '{}'::jsonb end
        order by e.created_at desc)
      from public.encumbrances e where e.machine_id = m.id
        -- A former holder sees its own rows only, never the owner's other financings.
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

-- A rate limit, because the search is now open to every account type. The same ceiling partial_search uses.
-- Deliberately per organisation rather than per user: the cost to protect against is enumeration, not clicking.
create or replace function public.lookup_machine(p_org_id uuid, p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); q text := app.normalize_identifier(p_query); ids uuid[];
begin
  perform app.require_scope('machines:read');
  if q is null or length(q) < 3 then return '[]'::jsonb; end if;
  if not app.rate_limit_hit('lookup:' || actor, 120, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  if app.is_valid_reg_number(q) then
    select array_agg(id) into ids from public.machines where reg_number = q and status <> 'draft';
  end if;
  if ids is null then
    select array_agg(distinct x.machine_id) into ids from public.machine_identifiers x join public.machines m on m.id = x.machine_id
      where x.normalized_value = q and m.status <> 'draft';
  end if;
  if ids is null then return '[]'::jsonb; end if;
  perform app.after_lookup(actor, ids, 'web');
  return coalesce((select jsonb_agg(app.machine_view(i, actor)) from unnest(ids) i), '[]'::jsonb);
end $$;

-- =====================================================================================================================
-- Consent: asking the owner for the full history, or for a view of the fleet
-- =====================================================================================================================
--
-- Built on public.mandates (ADR 0018) rather than on a new table. It already is exactly this: a principal
-- authorising another organisation, scoped (`view` means the full machine view), time-limited to at most two
-- years, signed with BankID, revocable by either side, and already wired into app.machine_relations as `agent`.
--
-- Three gaps had to be closed.
--
-- 1. The direction. grant_mandate is principal-initiated; nobody could ask. A new `requested` status is used for
--    an agent-initiated row rather than reusing `pending`, because `pending` means "the agent must accept" and
--    respond_mandate matches `agent_org_id = actor and status = 'pending'`. An agent-initiated `pending` row
--    would therefore let the requester approve its own request — straight to a full machine view.
-- 2. A mandate produced no history. app.can_read_event never knew `agent` or `group`, so a mandate holder got a
--    full machine view and an empty timeline, which is precisely what makes consent worth nothing.
-- 3. Nowhere to ask from. request_mandate + decide_mandate_request, and an inbox item for the owner.

alter table public.mandates drop constraint mandates_status_check;
alter table public.mandates add constraint mandates_status_check
  check (status = any (array['requested', 'pending', 'active', 'revoked', 'declined', 'completed']));
alter table public.mandates add column if not exists requested_by text not null default 'principal'
  check (requested_by in ('principal', 'agent'));
alter table public.mandates add column if not exists request_message text check (length(request_message) <= 1000);

comment on column public.mandates.requested_by is
  'Who started it. An agent-initiated row is status = requested until the principal approves, so respond_mandate (agent-only, pending-only) can never approve it (ADR 0032).';

-- One open consignment per machine, now counting a request as open as well.
drop index if exists public.mandates_one_consignment;
create unique index mandates_one_consignment on public.mandates (machine_id)
  where kind = 'consignment' and status in ('requested', 'pending', 'active');

-- ---------- Anyone may ask the owner ----------
create or replace function public.request_mandate(p_org_id uuid, p_principal_org_id uuid, p_machine_id uuid default null,
  p_scopes text[] default array['view'], p_valid_to date default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates; m public.machines;
  scopes text[]; valid_to date := coalesce(p_valid_to, current_date + 90); principal uuid := p_principal_org_id;
begin
  scopes := (select array_agg(distinct s order by s) from unnest(p_scopes) s);
  -- Asking for the right to sell someone else's machine is not a consent request; that is a consignment the
  -- owner offers. A request is for seeing things.
  if not (scopes <@ array['view', 'fleet']) then perform app.raise('VALIDATION', '{"field":"scopes"}'); end if;
  if p_machine_id is not null then
    select * into m from public.machines where id = p_machine_id;
    if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
    principal := coalesce(principal, m.owner_org_id);
    -- The request goes to whoever owns it now, so a stale id cannot redirect it.
    if principal <> m.owner_org_id then perform app.raise('VALIDATION', '{"field":"principal_org_id"}'); end if;
  end if;
  if principal is null then perform app.raise('VALIDATION', '{"field":"principal_org_id"}'); end if;
  if principal = actor then perform app.raise('VALIDATION', '{"field":"principal_org_id","reason":"own_org"}'); end if;
  if not exists (select 1 from public.organizations where id = principal and status <> 'suspended') then
    perform app.raise('VALIDATION', '{"field":"principal_org_id"}');
  end if;
  -- Already have it? Then there is nothing to ask for.
  if p_machine_id is not null and app.has_mandate(p_machine_id, actor, 'view') then
    perform app.raise('MANDATE_ALREADY_ACTIVE');
  end if;
  if exists (select 1 from public.mandates where principal_org_id = principal and agent_org_id = actor
             and machine_id is not distinct from p_machine_id and status in ('requested', 'pending', 'active')) then
    perform app.raise('MANDATE_ALREADY_OPEN');
  end if;
  insert into public.mandates (kind, principal_org_id, agent_org_id, machine_id, scopes, valid_to, status,
    requested_by, request_message, created_by)
  values ('power_of_attorney', principal, actor, p_machine_id, scopes, valid_to, 'requested',
    'agent', nullif(trim(p_message), ''), auth.uid())
  returning * into d;
  perform app.log_event('mandate.requested', p_machine_id, principal, actor,
    jsonb_build_object('mandate_id', d.id, 'scopes', d.scopes, 'valid_to', d.valid_to, 'fleet_wide', p_machine_id is null));
  perform app.notify_org(principal, 'mandate.requested',
    jsonb_build_object('mandate_id', d.id, 'agent', (select name from public.organizations where id = actor),
      'reg_number', m.reg_number, 'fleet_wide', p_machine_id is null), '/inbox', 'warning', 'admin');
  return jsonb_build_object('ok', true, 'mandate', to_jsonb(d));
exception when check_violation or unique_violation then
  perform app.raise('VALIDATION', '{"field":"mandate"}');
end $$;

-- ---------- The owner decides, with a signature ----------
create or replace function public.decide_mandate_request(p_org_id uuid, p_mandate_id uuid, p_approve boolean,
  p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates; sig uuid;
begin
  select * into d from public.mandates where id = p_mandate_id for update;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  -- Only the owner of the data decides, and only on a request (never on a grant it made itself).
  if d.principal_org_id <> actor or d.status <> 'requested' then perform app.raise('NOT_FOUND'); end if;
  if p_approve then
    -- Signed with the same text as granting one directly: approving a request and granting access are the same act.
    sig := app.consume_signature(p_signature_id, 'grant_mandate', actor, jsonb_build_object(
      'agent_org_id', d.agent_org_id, 'machine_id', coalesce(d.machine_id::text, ''),
      'scopes', array_to_string(d.scopes, ', '), 'valid_to', d.valid_to::text));
    update public.mandates set status = 'active', principal_signature_id = sig, accepted_by = auth.uid(), accepted_at = now()
    where id = d.id returning * into d;
  else
    update public.mandates set status = 'declined', ended_at = now(), accepted_by = auth.uid() where id = d.id returning * into d;
  end if;
  perform app.log_event(case when p_approve then 'mandate.request_approved' else 'mandate.request_declined' end,
    d.machine_id, d.principal_org_id, actor, jsonb_build_object('mandate_id', d.id, 'scopes', d.scopes, 'valid_to', d.valid_to));
  perform app.notify_org(d.agent_org_id, case when p_approve then 'mandate.request_approved' else 'mandate.request_declined' end,
    jsonb_build_object('mandate_id', d.id, 'principal', (select name from public.organizations where id = actor),
      'valid_to', d.valid_to), '/mandates', 'info', 'admin');
  return jsonb_build_object('ok', true, 'mandate', to_jsonb(d));
end $$;

revoke all on function public.request_mandate(uuid, uuid, uuid, text[], date, text),
  public.decide_mandate_request(uuid, uuid, boolean, uuid) from public;
grant execute on function public.request_mandate(uuid, uuid, uuid, text[], date, text),
  public.decide_mandate_request(uuid, uuid, boolean, uuid) to authenticated, service_role;

-- ---------- Either side can withdraw a request ----------
create or replace function public.revoke_mandate(p_org_id uuid, p_mandate_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates;
begin
  update public.mandates set status = 'revoked', ended_at = now(), ended_reason = left(nullif(trim(p_reason), ''), 300)
  where id = p_mandate_id and (principal_org_id = actor or agent_org_id = actor)
    and status in ('requested', 'pending', 'active') returning * into d;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('mandate.revoked', d.machine_id, d.principal_org_id, actor, jsonb_build_object('mandate_id', d.id, 'kind', d.kind));
  perform app.notify_org(case when actor = d.principal_org_id then d.agent_org_id else d.principal_org_id end, 'mandate.revoked',
    jsonb_build_object('mandate_id', d.id, 'by', (select name from public.organizations where id = actor)), '/mandates', 'warning', 'admin');
  return jsonb_build_object('ok', true, 'mandate', to_jsonb(d));
end $$;

-- ---------- The list shows requests too ----------
create or replace function public.list_mandates(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object(
      'direction', case when d.principal_org_id = actor then 'granted' else 'received' end,
      -- Who has to act: on a request it is the principal, on a grant it is the agent.
      'awaiting', case when d.status = 'requested' then 'principal' when d.status = 'pending' then 'agent' end,
      'effective_status', case when d.status = 'active' and d.valid_to < current_date then 'expired' else d.status end,
      'principal', app.org_brief(d.principal_org_id), 'agent', app.org_brief(d.agent_org_id),
      'machine', (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model) from public.machines m where m.id = d.machine_id))
      order by (d.status in ('requested', 'pending', 'active')) desc, d.created_at desc)
    from public.mandates d where d.principal_org_id = actor or d.agent_org_id = actor), '[]'::jsonb);
end $$;

-- ---------- A mandate finally produces a timeline ----------
-- Keyed on the mandate's scope, not on the relation: machine_relations_more sets `agent` for view|sell|fleet, so
-- keying on the relation would hand a fleet-only agent the whole transfer and encumbrance history.
create or replace function app.can_read_event(p_machine_id uuid, p_org_id uuid, p_type text, p_created_at timestamptz)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare rel text[]; orgs uuid[] := app.current_org_ids();
begin
  if app.is_operator() or app.acts_as('authority') then return true; end if;
  if p_machine_id is null then
    return p_org_id is not null and p_org_id = any (orgs);
  end if;
  rel := app.machine_relations(p_machine_id);
  if rel && array['owner', 'user', 'registered_by', 'draft_owner'] then return true; end if;
  if 'previous_owner' = any (rel) then
    -- Previous owners see history up to the end of their last ownership period (SPEC §6.7 step 3).
    return p_created_at < (select (max(w.to_date) + 1)::timestamptz from public.ownerships w
      where w.machine_id = p_machine_id and w.owner_org_id = any (orgs) and w.to_date is not null);
  end if;
  -- Consent: a `view` mandate is the full history, for as long as the mandate runs. A `fleet` mandate is about
  -- operating the machine, so it sees the operating events and not the ownership and financing ones.
  if exists (select 1 from unnest(orgs) o where app.has_mandate(p_machine_id, o, 'view')) then return true; end if;
  if exists (select 1 from unnest(orgs) o where app.has_mandate(p_machine_id, o, 'fleet'))
     and app.event_category(p_type) = 'machine' then return true; end if;
  -- A group parent sees its subsidiary's machines as the subsidiary does (ADR 0018).
  if 'group' = any (rel) then return true; end if;
  if 'holder' = any (rel) and app.event_category(p_type) in ('encumbrance', 'transfer', 'flag') then return true; end if;
  if 'former_holder' = any (rel) and app.event_category(p_type) in ('encumbrance', 'transfer', 'flag') then
    return p_created_at < (select max(e.released_at) + interval '1 day' from public.encumbrances e
      where e.machine_id = p_machine_id and e.status = 'released' and e.holder_org_id = any (orgs));
  end if;
  if 'insurer' = any (rel) and app.event_category(p_type) = 'flag' then return true; end if;
  return false;
end $$;

-- ---------- The owner's inbox ----------
-- An extension hook, so the next flow that needs an inbox item does not have to copy this body again.
create or replace function app.inbox_extras(p_actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_agg(jsonb_build_object('kind', 'mandate_request', 'id', d.id, 'created_at', d.created_at,
      'mandate', to_jsonb(d) || jsonb_build_object('agent', app.org_brief(d.agent_org_id),
        'machine', (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model)
          from public.machines m where m.id = d.machine_id))))
    from public.mandates d where d.principal_org_id = p_actor and d.status = 'requested'), '[]'::jsonb)
$$;
grant execute on function app.inbox_extras(uuid) to authenticated, service_role;

create or replace function public.get_inbox(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); me text; items jsonb := '[]'::jsonb;
begin
  select email into me from public.profiles where user_id = auth.uid();
  -- Transfers where we are the buyer
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'transfer_accept', 'id', t.id, 'created_at', t.updated_at, 'transfer', app.transfer_json(t)))
    from public.transfers t where t.to_org_id = actor and t.status = 'awaiting_buyer'), '[]'::jsonb);
  -- Transfers waiting for our decision as financier
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'transfer_financier', 'id', t.id, 'created_at', t.updated_at, 'transfer', app.transfer_json(t)))
    from public.transfers t join public.encumbrances e on e.id = t.existing_encumbrance_id
    where e.holder_org_id = actor and t.status = 'awaiting_financier'), '[]'::jsonb);
  -- Trade-in requests to approve (we are the owner)
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'trade_in_approve', 'id', t.id, 'created_at', t.created_at, 'transfer', app.transfer_json(t)))
    from public.transfers t where t.from_org_id = actor and t.status = 'draft' and t.is_trade_in and t.initiated_by_org_id <> actor), '[]'::jsonb);
  -- Encumbrances to confirm, and encumbrance transfers offered to us
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', case when e.transferred_from_encumbrance_id is null then 'encumbrance_confirm' else 'encumbrance_takeover' end,
      'id', e.id, 'created_at', e.created_at, 'encumbrance', app.encumbrance_json(e, true) || app.encumbrance_terms_json(e),
      'reg_number', (select reg_number from public.machines where id = e.machine_id), 'machine_id', e.machine_id))
    from public.encumbrances e where e.holder_org_id = actor and e.status = 'pending'), '[]'::jsonb);
  -- Verification requests assigned to us, and our own requests needing more information
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'verification_review', 'id', v.id, 'created_at', v.created_at, 'request', app.verification_json(v)))
    from public.verification_requests v where v.reviewer_org_id = actor and v.status in ('open', 'in_review')), '[]'::jsonb);
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'verification_needs_info', 'id', v.id, 'created_at', v.updated_at, 'request', app.verification_json(v)))
    from public.verification_requests v where v.requested_by_org_id = actor and v.status = 'needs_info'), '[]'::jsonb);
  -- Owner corrections we may object to
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'correction_objection', 'id', c.id, 'created_at', c.created_at,
      'correction', to_jsonb(c) || jsonb_build_object('reg_number', (select reg_number from public.machines where id = c.machine_id), 'to', app.org_brief(c.to_org_id))))
    from public.owner_corrections c where c.from_org_id = actor and c.status = 'objection_period'), '[]'::jsonb);
  -- Open conflicts involving us
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'conflict', 'id', c.id, 'created_at', c.created_at, 'conflict', app.conflict_json(c)))
    from public.conflicts c where actor = any (c.involved_org_ids) and c.status = 'open'), '[]'::jsonb);
  -- Payoff: what the lender has to answer, and what the requester has got back. Until now a payoff request
  -- produced only a bell notification, so a bank had no queue to work through (the reported defect).
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'payoff_request', 'id', p.id, 'created_at', p.created_at,
      'payoff', app.payoff_json(p)))
    from public.payoff_requests p where p.holder_org_id = actor and p.status = 'requested'), '[]'::jsonb);
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'payoff_settlement_review', 'id', p.id, 'created_at', p.updated_at,
      'payoff', app.payoff_json(p)))
    from public.payoff_requests p where p.holder_org_id = actor and p.status = 'settlement_submitted'), '[]'::jsonb);
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'payoff_quote', 'id', p.id, 'created_at', p.quoted_at,
      'payoff', app.payoff_json(p)))
    from public.payoff_requests p where p.requested_by_org_id = actor and p.status = 'quoted'), '[]'::jsonb);
  -- Consent requests waiting for us as the owner of the data (ADR 0032), and whatever later steps add.
  items := items || app.inbox_extras(actor);
  -- Invitations for the user (not org-bound)
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'invitation', 'id', m.id, 'created_at', m.created_at, 'org', app.org_brief(m.org_id), 'role', m.role))
    from public.memberships m where m.status = 'invited' and lower(m.invite_email) = me and (m.invite_expires_at is null or m.invite_expires_at > now())), '[]'::jsonb);
  return jsonb_build_object('count', jsonb_array_length(items),
    'items', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from jsonb_array_elements(items) x), '[]'::jsonb));
end $$;
