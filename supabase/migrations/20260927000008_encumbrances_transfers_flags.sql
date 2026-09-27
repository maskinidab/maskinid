-- =====================================================================
-- 0005 encumbrances, transfers, flags, deregistration, checks and
-- signatures (SPEC §4.3, §4.4, §6.3, §6.6–§6.9, §11.1, §16 points 3–5, 9–10)
-- =====================================================================

-- ---------- Signatures ----------
create table public.signatures (
  id             uuid primary key default gen_random_uuid(),
  provider       public.signature_provider not null,
  action         text not null,
  subject_type   text not null,
  subject_id     uuid not null,
  params         jsonb not null default '{}'::jsonb,
  org_id         uuid references public.organizations (id),
  signer_user_id uuid not null,
  signed_text    text not null,
  signed_at      timestamptz,
  status         public.signature_status not null default 'pending',
  evidence       jsonb not null default '{}'::jsonb,
  expires_at     timestamptz not null default now() + interval '15 minutes',
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index signatures_signer_idx on public.signatures (signer_user_id, created_at desc);

-- ---------- Encumbrances ----------
create table public.encumbrances (
  id                             uuid primary key default gen_random_uuid(),
  machine_id                     uuid not null references public.machines (id),
  type                           public.encumbrance_type not null,
  holder_org_id                  uuid not null references public.organizations (id),
  counterparty_org_id            uuid references public.organizations (id),
  contract_ref                   text,
  start_date                     date not null default current_date,
  end_date                       date,
  transferred_from_encumbrance_id uuid references public.encumbrances (id),
  status                         public.encumbrance_status not null default 'pending',
  requested_by_org_id            uuid references public.organizations (id),
  registered_by_user_id          uuid,
  signature_id                   uuid references public.signatures (id),
  confirmed_at                   timestamptz,
  released_at                    timestamptz,
  released_by_user_id            uuid,
  release_signature_id           uuid references public.signatures (id),
  rejected_reason                text,
  notes                          text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
-- At most ONE active financing encumbrance per machine (rule 4, SPEC §4.3).
create unique index encumbrances_one_active_financing on public.encumbrances (machine_id)
  where status = 'active' and type in ('ownership_reservation', 'leasing');
create index encumbrances_machine_idx on public.encumbrances (machine_id);
create index encumbrances_holder_idx on public.encumbrances (holder_org_id, status);
create index encumbrances_counterparty_idx on public.encumbrances (counterparty_org_id);
create trigger encumbrances_updated before update on public.encumbrances for each row execute function app.set_updated_at();

-- ---------- Transfers ----------
create table public.transfers (
  id                      uuid primary key default gen_random_uuid(),
  machine_id              uuid not null references public.machines (id),
  from_org_id             uuid not null references public.organizations (id),
  to_org_id               uuid references public.organizations (id),
  to_org_number           text,
  to_email                text,
  initiated_by_user_id    uuid,
  initiated_by_org_id     uuid references public.organizations (id),
  sale_date               date not null,
  reported_at             timestamptz not null default now(),
  effective_date          date not null,
  status                  public.transfer_status not null default 'draft',
  is_trade_in             boolean not null default false,
  new_encumbrance_id      uuid references public.encumbrances (id),
  new_financing           jsonb,                 -- {holder_org_id, type, contract_ref, start_date, end_date} for the buyer
  existing_encumbrance_id uuid references public.encumbrances (id),
  financier_decision      text check (financier_decision in ('release', 'transfer_to_buyer', 'reject')),
  document_ids            uuid[] not null default '{}',
  buyer_signature_id      uuid references public.signatures (id),
  financier_signature_id  uuid references public.signatures (id),
  seller_signature_id     uuid references public.signatures (id),
  invite_token_hash       text unique,
  expires_at              timestamptz not null default now() + interval '14 days',
  completed_at            timestamptz,
  cancelled_reason        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index transfers_one_open on public.transfers (machine_id) where status in ('draft', 'awaiting_buyer', 'awaiting_financier');
create index transfers_to_idx on public.transfers (to_org_id, status);
create index transfers_from_idx on public.transfers (from_org_id, status);
create trigger transfers_updated before update on public.transfers for each row execute function app.set_updated_at();

-- ---------- Flags ----------
create table public.flags (
  id                 uuid primary key default gen_random_uuid(),
  machine_id         uuid not null references public.machines (id),
  type               public.flag_type not null,
  raised_by_org_id   uuid references public.organizations (id),
  raised_by_user_id  uuid,
  reference          text,
  description        text,
  occurred_at        timestamptz,
  location_text      text,
  signature_id       uuid references public.signatures (id),
  raised_at          timestamptz not null default now(),
  status             public.flag_status not null default 'active',
  cleared_at         timestamptz,
  cleared_by_user_id uuid,
  cleared_reason     text,
  external_ref       text,          -- e.g. Larmtjänst reference (TheftRegistrySync)
  created_at         timestamptz not null default now()
);
create unique index flags_one_active_per_type on public.flags (machine_id, type) where status = 'active';
create index flags_machine_idx on public.flags (machine_id);
create index flags_active_type_idx on public.flags (type) where status = 'active';

-- ---------- Checks ----------
create sequence public.check_receipt_seq;
create table public.check_receipts (
  id                   uuid primary key default gen_random_uuid(),
  receipt_number       text not null unique,
  machine_id           uuid references public.machines (id),
  query                jsonb not null,
  purpose              text,
  performed_by_org_id  uuid not null references public.organizations (id),
  performed_by_user_id uuid,
  api_key_id           uuid,
  result               jsonb not null,
  result_hash          text not null,
  pdf_path             text,
  created_at           timestamptz not null default now()
);
create index check_receipts_org_idx on public.check_receipts (performed_by_org_id, created_at desc);
create index check_receipts_machine_idx on public.check_receipts (machine_id, created_at desc);

-- ---------- Signature texts & lifecycle ----------
create or replace function app.label(p_key text, p_locale text)
returns text language sql immutable set search_path = '' as $$
  select case when p_locale = 'en' then
    case p_key
      when 'ownership_reservation' then 'retention of title' when 'leasing' then 'leasing' when 'rental' then 'rental'
      when 'other' then 'right' when 'scrapped' then 'scrapped' when 'exported' then 'exported permanently'
      when 'misregistered' then 'registered by mistake' when 'military' then 'transferred to the military register'
      when 'stolen_not_recovered' then 'stolen and not recovered' else p_key end
  else
    case p_key
      when 'ownership_reservation' then 'äganderättsförbehåll' when 'leasing' then 'leasing' when 'rental' then 'uthyrning'
      when 'other' then 'rättighet' when 'scrapped' then 'skrotad' when 'exported' then 'varaktigt utförd (export)'
      when 'misregistered' then 'felregistrerad' when 'military' then 'överförd till militärt register'
      when 'stolen_not_recovered' then 'stulen och inte återfunnen' else p_key end
  end
$$;

-- Human-readable text the user signs (SPEC §11.1), in the user's language. Built server-side from the subject so the
-- client cannot make the user sign something else than what is executed.
create or replace function app.signature_text(p_action text, p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare m public.machines; t public.transfers; e public.encumbrances; reg text; seller text; holder text; buyer text; en boolean := p_locale = 'en';
begin
  if p_action in ('accept_transfer', 'approve_transfer_financier') then
    select * into t from public.transfers where id = p_subject_id;
    select * into m from public.machines where id = t.machine_id;
  elsif p_action in ('release_encumbrance', 'transfer_encumbrance_holder', 'accept_encumbrance_transfer') then
    select * into e from public.encumbrances where id = p_subject_id;
    select * into m from public.machines where id = e.machine_id;
  else
    select * into m from public.machines where id = p_subject_id;
  end if;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  reg := app.format_reg_number(m.reg_number) || ' (' || coalesce(m.make, '') || ' ' || coalesce(m.model, '') || ')';
  case p_action
    when 'accept_transfer' then
      select name into seller from public.organizations where id = t.from_org_id;
      return case when en then format('I confirm the acquisition of machine %s from %s, effective %s.', reg, seller, t.effective_date)
                  else format('Jag bekräftar förvärv av maskin %s från %s med tillträde %s.', reg, seller, t.effective_date) end;
    when 'approve_transfer_financier' then
      select name into buyer from public.organizations where id = t.to_org_id;
      return case when en then format('I approve the transfer of machine %s to %s. Decision on our right: %s.', reg, coalesce(buyer, t.to_email, t.to_org_number), p_params ->> 'decision')
                  else format('Jag godkänner ägarbytet av maskin %s till %s. Beslut om vår rättighet: %s.', reg, coalesce(buyer, t.to_email, t.to_org_number),
                    case p_params ->> 'decision' when 'release' then 'släpps' when 'transfer_to_buyer' then 'överförs till köparen' else 'nekas' end) end;
    when 'register_encumbrance' then
      return case when en then format('I register %s on machine %s, contract %s, %s–%s.', app.label(p_params ->> 'type', 'en'), reg,
                    coalesce(p_params ->> 'contract_ref', '-'), p_params ->> 'start_date', coalesce(p_params ->> 'end_date', ''))
                  else format('Jag registrerar %s på maskin %s, avtal %s, %s–%s.', app.label(p_params ->> 'type', 'sv'), reg,
                    coalesce(p_params ->> 'contract_ref', '-'), p_params ->> 'start_date', coalesce(p_params ->> 'end_date', '')) end;
    when 'release_encumbrance' then
      select name into holder from public.organizations where id = e.holder_org_id;
      return case when en then format('I release %s''s %s on machine %s.', holder, app.label(e.type::text, 'en'), reg)
                  else format('Jag släpper %s:s %s på maskin %s.', holder, app.label(e.type::text, 'sv'), reg) end;
    when 'transfer_encumbrance_holder' then
      select name into holder from public.organizations where id = (p_params ->> 'new_holder_org_id')::uuid;
      return case when en then format('I transfer our %s on machine %s to %s.', app.label(e.type::text, 'en'), reg, holder)
                  else format('Jag överlåter vårt %s på maskin %s till %s.', app.label(e.type::text, 'sv'), reg, holder) end;
    when 'accept_encumbrance_transfer' then
      select name into holder from public.organizations where id = (select holder_org_id from public.encumbrances where id = e.transferred_from_encumbrance_id);
      return case when en then format('I take over %s''s %s on machine %s.', holder, app.label(e.type::text, 'en'), reg)
                  else format('Jag övertar %s:s %s på maskin %s.', holder, app.label(e.type::text, 'sv'), reg) end;
    when 'deregister_machine' then
      return case when en then format('I deregister machine %s. Reason: %s. The label is %s.', reg, app.label(p_params ->> 'reason', 'en'), p_params ->> 'label_disposition')
                  else format('Jag avregistrerar maskin %s. Orsak: %s. Märket är %s.', reg, app.label(p_params ->> 'reason', 'sv'),
                    case p_params ->> 'label_disposition' when 'destroyed' then 'förstört' when 'returned' then 'returnerat' else 'borttaget' end) end;
    when 'raise_flag_stolen' then
      return case when en then format('I report machine %s as stolen. Police report %s.', reg, coalesce(p_params ->> 'reference', '-'))
                  else format('Jag anmäler maskin %s som stulen. Polisanmälan %s.', reg, coalesce(p_params ->> 'reference', '-')) end;
    when 'raise_flag_scrapped', 'raise_flag_exported' then
      return case when en then format('I report machine %s as %s.', reg, app.label(replace(p_action, 'raise_flag_', ''), 'en'))
                  else format('Jag anmäler maskin %s som %s.', reg, app.label(replace(p_action, 'raise_flag_', ''), 'sv')) end;
    else perform app.raise('VALIDATION', jsonb_build_object('field', 'action'));
  end case;
  return null;
end $$;

create or replace function public.start_signature(p_org_id uuid, p_action text, p_subject_id uuid, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); s public.signatures; loc text;
begin
  if app.current_api_key_id() is not null then perform app.raise('SIGNATURE_REQUIRES_USER'); end if;
  select locale into loc from public.profiles where user_id = auth.uid();
  insert into public.signatures (provider, action, subject_type, subject_id, params, org_id, signer_user_id, signed_text)
  values (case when app.is_demo_mode() then 'mock' else 'bankid' end::public.signature_provider, p_action,
          case when p_action like '%transfer%' and p_action not like '%encumbrance%' then 'transfer'
               when p_action like '%encumbrance%' and p_action <> 'register_encumbrance' then 'encumbrance' else 'machine' end,
          p_subject_id, coalesce(p_params, '{}'), actor, auth.uid(), app.signature_text(p_action, p_subject_id, p_params, coalesce(loc, 'sv')))
  returning * into s;
  return jsonb_build_object('id', s.id, 'provider', s.provider, 'signed_text', s.signed_text, 'expires_at', s.expires_at);
end $$;

-- Demo-BankID: completes a pending signature of the current user (DEMO_MODE only).
create or replace function public.complete_mock_signature(p_signature_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.signatures;
begin
  if not app.is_demo_mode() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  update public.signatures set status = 'completed', signed_at = now(),
    evidence = jsonb_build_object('demo', true, 'at', app.iso_ts(now()))
  where id = p_signature_id and signer_user_id = auth.uid() and status = 'pending' and provider = 'mock' and expires_at > now()
  returning * into s;
  if s.id is null then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

-- BankID result from Edge Function bankid-sign (service role). The signer must be the same person as the account.
create or replace function public.record_signature(p_signature_id uuid, p_status public.signature_status, p_personal_number text, p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.signatures; h text;
begin
  select * into s from public.signatures where id = p_signature_id and status = 'pending' for update;
  if s.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_status = 'completed' then
    select personal_number_hash into h from public.profiles where user_id = s.signer_user_id;
    if h is null or h <> app.personal_number_hash(p_personal_number) then
      update public.signatures set status = 'failed', evidence = coalesce(p_evidence, '{}') || '{"reason":"signer_mismatch"}' where id = s.id;
      return jsonb_build_object('id', s.id, 'status', 'failed', 'reason', 'signer_mismatch');
    end if;
  end if;
  update public.signatures set status = p_status, signed_at = case when p_status = 'completed' then now() end,
    evidence = coalesce(p_evidence, '{}') where id = s.id returning * into s;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

-- Validates and consumes a signature for an action (single use). Outside DEMO_MODE only BankID signatures count
-- (SPEC §16.9). API keys may act without a personal signature for the actions in p_api_allowed (ADR 0010).
create or replace function app.consume_signature(p_signature_id uuid, p_action text, p_subject_id uuid, p_params jsonb default '{}'::jsonb,
  p_api_allowed boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.signatures;
begin
  if app.current_api_key_id() is not null and p_api_allowed then return null; end if;
  if p_signature_id is null then perform app.raise('SIGNATURE_REQUIRED', jsonb_build_object('action', p_action)); end if;
  select * into s from public.signatures where id = p_signature_id for update;
  if s.id is null or s.signer_user_id is distinct from auth.uid() or s.action <> p_action or s.subject_id <> p_subject_id then
    perform app.raise('SIGNATURE_INVALID');
  end if;
  if s.status <> 'completed' then perform app.raise('SIGNATURE_REQUIRED', jsonb_build_object('status', s.status)); end if;
  if s.consumed_at is not null then perform app.raise('SIGNATURE_ALREADY_USED'); end if;
  if s.signed_at < now() - interval '30 minutes' then perform app.raise('SIGNATURE_EXPIRED'); end if;
  if s.provider <> 'bankid' and not app.is_demo_mode() then perform app.raise('SIGNATURE_PROVIDER_NOT_ALLOWED'); end if;
  -- What was signed must be exactly what is executed (null-valued keys are ignored on both sides).
  if jsonb_strip_nulls(coalesce(s.params, '{}')) <> jsonb_strip_nulls(coalesce(p_params, '{}')) then
    perform app.raise('SIGNATURE_PARAMS_MISMATCH');
  end if;
  update public.signatures set consumed_at = now() where id = s.id;
  return s.id;
end $$;

-- ---------- Relations (extends step 3) ----------
create or replace function app.machine_relations(p_machine_id uuid, p_org_ids uuid[] default null)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare m public.machines; orgs uuid[] := coalesce(p_org_ids, app.current_org_ids()); rel text[] := '{}';
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then return rel; end if;
  if app.is_operator() then rel := array_append(rel, 'operator'); end if;
  if exists (select 1 from unnest(orgs) o where app.has_org_type(o, 'authority')) then rel := array_append(rel, 'authority'); end if;
  if m.owner_org_id = any (orgs) then rel := array_append(rel, 'owner'); end if;
  if m.user_org_id = any (orgs) then rel := array_append(rel, 'user'); end if;
  -- The registering org (e.g. a dealer registering for a customer) keeps access only during the first ownership
  -- period; after a completed transfer it must not see the new owner's data (ADR 0010).
  if m.registered_by_org_id = any (orgs) and m.status <> 'draft'
     and not exists (select 1 from public.ownerships w where w.machine_id = m.id and w.acquired_via = 'transfer') then
    rel := array_append(rel, 'registered_by');
  end if;
  if m.status = 'draft' and m.registered_by_org_id = any (orgs) then rel := array_append(rel, 'draft_owner'); end if;
  if exists (select 1 from public.ownerships w where w.machine_id = m.id and w.to_date is not null and w.owner_org_id = any (orgs)
             and w.owner_org_id is distinct from m.owner_org_id) then
    rel := array_append(rel, 'previous_owner');
  end if;
  if exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status in ('pending', 'active') and e.holder_org_id = any (orgs)) then
    rel := array_append(rel, 'holder');
  end if;
  if exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('awaiting_buyer', 'awaiting_financier')
             and t.to_org_id = any (orgs)) then
    rel := array_append(rel, 'transfer_party');
  end if;
  if exists (select 1 from public.check_receipts c where c.machine_id = m.id and c.performed_by_org_id = any (orgs)
             and c.created_at > now() - interval '24 hours') then
    rel := array_append(rel, 'checker');
  end if;
  rel := rel || app.machine_relations_more(m, orgs);
  return rel;
end $$;

-- Hook for later steps (insurer, assigned inspector, lessee, client).
create or replace function app.machine_relations_more(m public.machines, p_orgs uuid[])
returns text[] language sql stable security definer set search_path = '' as $$ select '{}'::text[] $$;

-- ---------- Financing & flags in the machine view ----------
create or replace function app.active_financing(p_machine_id uuid)
returns public.encumbrances language sql stable security definer set search_path = '' as $$
  select * from public.encumbrances where machine_id = p_machine_id and status = 'active'
    and type in ('ownership_reservation', 'leasing') limit 1
$$;

create or replace function app.encumbrance_json(e public.encumbrances, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'type', e.type, 'status', e.status, 'start_date', e.start_date, 'end_date', e.end_date,
    'holder', jsonb_build_object('id', e.holder_org_id, 'name', (select name from public.organizations where id = e.holder_org_id)),
    'confirmed_at', e.confirmed_at, 'released_at', e.released_at, 'created_at', e.created_at)
    || case when p_full then jsonb_build_object('contract_ref', e.contract_ref, 'notes', e.notes,
         'counterparty', app.org_brief(e.counterparty_org_id), 'transferred_from_encumbrance_id', e.transferred_from_encumbrance_id,
         'rejected_reason', e.rejected_reason) else '{}'::jsonb end
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
  x jsonb := '{}'::jsonb;
begin
  if sees_yes_no then
    x := x || jsonb_build_object('financing', jsonb_build_object(
      'has_active', af.id is not null,
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

create or replace function app.machine_view_extras_more(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;

create or replace function app.machine_list_extras(m public.machines, p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'has_active_financing', (app.active_financing(m.id)).id is not null,
    'active_flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
    'open_transfer_status', (select t.status from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1))
$$;

-- ---------- Status derived from flags (SPEC §3.2 priority) ----------
create or replace function app.recompute_machine_status(p_machine_id uuid)
returns public.machine_status language plpgsql security definer set search_path = '' as $$
declare m public.machines; st public.machine_status;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.status in ('draft', 'scrapped', 'exported', 'deregistered') then return m.status; end if;
  st := case
    when exists (select 1 from public.flags where machine_id = m.id and status = 'active' and type = 'stolen') then 'stolen'
    when exists (select 1 from public.flags where machine_id = m.id and status = 'active' and type in ('seized', 'blocked', 'under_investigation')) then 'blocked'
    when exists (select 1 from public.flags where machine_id = m.id and status = 'active' and type = 'disputed')
      or exists (select 1 from public.conflicts where status = 'open' and type in ('duplicate_identifier', 'ownership_dispute') and machine_id = m.id) then 'disputed'
    else 'active' end::public.machine_status;
  if st <> m.status then update public.machines set status = st where id = m.id; end if;
  return st;
end $$;

-- Blocks for register-changing actions (SPEC §6.8, §7.5).
create or replace function app.assert_not_blocked(p_machine_id uuid, p_action text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare f text;
begin
  select type::text into f from public.flags where machine_id = p_machine_id and status = 'active'
    and type in ('stolen', 'seized', 'blocked', 'under_investigation')
  order by case type when 'stolen' then 1 when 'seized' then 2 else 3 end limit 1;
  if f is not null then perform app.raise('MACHINE_' || upper(f), jsonb_build_object('action', p_action, 'flag', f)); end if;
  if exists (select 1 from public.machines where id = p_machine_id and status in ('scrapped', 'exported', 'deregistered', 'draft')) then
    perform app.raise('MACHINE_READ_ONLY', jsonb_build_object('action', p_action));
  end if;
end $$;

-- ---------- Encumbrances ----------
-- Conflict path (SPEC §6.6 step 4, §16.4): nothing of the requested encumbrance is written; a conflict row, notifications
-- to the existing holder (critical) and the owner, a webhook encumbrance.conflict and an event are. Returned, not raised
-- (ADR 0007).
create or replace function app.encumbrance_conflict(p_machine_id uuid, p_actor uuid, p_existing public.encumbrances, p_attempt jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.machines; c uuid; holder_name text; ev public.events;
begin
  select * into m from public.machines where id = p_machine_id;
  select name into holder_name from public.organizations where id = p_existing.holder_org_id;
  insert into public.conflicts (type, machine_id, involved_org_ids, details)
  values ('double_encumbrance', m.id, array_remove(array[p_actor, p_existing.holder_org_id, m.owner_org_id], null),
    jsonb_build_object('existing_encumbrance_id', p_existing.id, 'attempted_by_org_id', p_actor, 'attempt', p_attempt))
  returning id into c;
  ev := app.log_event('encumbrance.conflict', m.id, m.owner_org_id, p_actor,
    jsonb_build_object('conflict_id', c, 'existing_encumbrance_id', p_existing.id, 'existing_holder_org_id', p_existing.holder_org_id,
      'type', p_attempt ->> 'type'));
  perform app.notify_org(p_existing.holder_org_id, 'encumbrance.conflict',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'attempted_by', (select name from public.organizations where id = p_actor), 'conflict_id', c),
    '/machines/' || m.id, 'critical');
  perform app.notify_org(m.owner_org_id, 'encumbrance.conflict_owner',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'attempted_by', (select name from public.organizations where id = p_actor), 'conflict_id', c),
    '/machines/' || m.id, 'warning');
  perform app.notify_operators('conflict.created', jsonb_build_object('conflict_id', c, 'type', 'double_encumbrance'), '/admin/conflicts', 'warning');
  perform app.enqueue_webhook(p_existing.holder_org_id, 'encumbrance.conflict', m.id,
    jsonb_build_object('conflict_id', c, 'existing_encumbrance_id', p_existing.id), ev.id);
  return jsonb_build_object('ok', false, 'error', 'ACTIVE_ENCUMBRANCE_EXISTS', 'holder', holder_name, 'conflict_id', c);
end $$;

create or replace function app.validate_encumbrance_params(p_type public.encumbrance_type, p_start date, p_end date)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_type = 'ownership_reservation' and p_end is null then
    -- [v1.1] end date required for retention of title
    perform app.raise('VALIDATION', '{"field":"end_date","reason":"required_for_ownership_reservation"}');
  end if;
  if p_end is not null and p_end < coalesce(p_start, current_date) then perform app.raise('VALIDATION', '{"field":"end_date"}'); end if;
end $$;

create or replace function public.register_encumbrance(p_org_id uuid, p_machine_id uuid, p_type public.encumbrance_type,
  p_contract_ref text default null, p_start_date date default current_date, p_end_date date default null,
  p_counterparty_org_id uuid default null, p_notes text default null, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances;
  sig uuid; params jsonb; ev public.events;
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
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id, signature_id, confirmed_at, notes)
  values (m.id, p_type, actor, coalesce(p_counterparty_org_id, m.owner_org_id), nullif(trim(p_contract_ref), ''), coalesce(p_start_date, current_date),
    p_end_date, 'active', actor, auth.uid(), sig, now(), nullif(trim(p_notes), ''))
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

-- Hook: reminders (step 12) etc.
create or replace function app.after_encumbrance_change(p_encumbrance_id uuid)
returns void language sql volatile set search_path = '' as $$ select $$;

-- Owner/dealer asks a financier to confirm financing (registration wizard step 3, dealer sale). Status pending.
create or replace function public.request_encumbrance(p_org_id uuid, p_machine_id uuid, p_holder_org_id uuid, p_type public.encumbrance_type,
  p_contract_ref text default null, p_start_date date default current_date, p_end_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances; ev public.events;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if (m.owner_org_id = actor or m.registered_by_org_id = actor or m.first_sale_dealer_org_id = actor) is not true then perform app.raise('FORBIDDEN'); end if;
  perform app.assert_not_blocked(m.id, 'request_encumbrance');
  if not app.has_org_type(p_holder_org_id, 'financier') then perform app.raise('VALIDATION', '{"field":"holder_org_id"}'); end if;
  perform app.validate_encumbrance_params(p_type, p_start_date, p_end_date);
  if p_type in ('ownership_reservation', 'leasing') then
    select * into existing from public.encumbrances where machine_id = m.id and status = 'active' and type in ('ownership_reservation', 'leasing');
    if existing.id is not null then
      return app.encumbrance_conflict(m.id, actor, existing, jsonb_build_object('type', p_type, 'requested_holder_org_id', p_holder_org_id));
    end if;
  end if;
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id)
  values (m.id, p_type, p_holder_org_id, m.owner_org_id, nullif(trim(p_contract_ref), ''), coalesce(p_start_date, current_date), p_end_date,
    'pending', actor, auth.uid())
  returning * into e;
  ev := app.log_event('encumbrance.requested', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', p_holder_org_id));
  perform app.notify_org(p_holder_org_id, 'encumbrance.pending',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'requested_by', (select name from public.organizations where id = actor), 'encumbrance_id', e.id),
    '/inbox', 'warning');
  perform app.enqueue_webhook(p_holder_org_id, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true));
end $$;

create or replace function public.confirm_encumbrance(p_org_id uuid, p_encumbrance_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; m public.machines; existing public.encumbrances; ev public.events;
begin
  perform app.require_scope('encumbrances:write');
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if e.status <> 'pending' then perform app.raise('ENCUMBRANCE_NOT_PENDING'); end if;
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
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true));
end $$;

create or replace function public.reject_encumbrance(p_org_id uuid, p_encumbrance_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; m public.machines;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if e.status <> 'pending' then perform app.raise('ENCUMBRANCE_NOT_PENDING'); end if;
  update public.encumbrances set status = 'rejected', rejected_reason = left(p_reason, 500) where id = e.id;
  select * into m from public.machines where id = e.machine_id;
  perform app.log_event('encumbrance.rejected', m.id, m.owner_org_id, actor, jsonb_build_object('encumbrance_id', e.id));
  perform app.notify_org(coalesce(e.requested_by_org_id, m.owner_org_id), 'encumbrance.rejected',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'holder', (select name from public.organizations where id = actor)),
    '/machines/' || m.id, 'warning');
  return jsonb_build_object('ok', true);
end $$;

-- Only the holder may release (SPEC §16.5); operators may correct. Signature required.
create or replace function public.release_encumbrance(p_org_id uuid, p_encumbrance_id uuid, p_signature_id uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; m public.machines; sig uuid; ev public.events; t public.transfers;
begin
  perform app.require_scope('encumbrances:write');
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.holder_org_id <> actor and not app.is_operator('superadmin') then perform app.raise('FORBIDDEN'); end if;
  if e.status <> 'active' then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  sig := app.consume_signature(p_signature_id, 'release_encumbrance', e.id, '{}'::jsonb, true);
  update public.encumbrances set status = 'released', released_at = now(), released_by_user_id = auth.uid(), release_signature_id = sig
  where id = e.id returning * into e;
  select * into m from public.machines where id = e.machine_id;
  if e.type = 'leasing' and m.user_org_id is not null and m.user_org_id = e.counterparty_org_id and m.user_org_id <> m.owner_org_id then
    update public.machines set user_org_id = null where id = m.id;
  end if;
  ev := app.log_event('encumbrance.released', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'correction', e.holder_org_id <> actor, 'reason', left(p_reason, 500)));
  perform app.notify_org(m.owner_org_id, 'encumbrance.released',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'holder', (select name from public.organizations where id = e.holder_org_id)),
    '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.released', m.id, jsonb_build_object('encumbrance_id', e.id), ev.id);
  perform app.enqueue_webhook(e.holder_org_id, 'encumbrance.released', m.id, jsonb_build_object('encumbrance_id', e.id), ev.id);
  -- A transfer waiting for this financier can now go to the buyer.
  select * into t from public.transfers where existing_encumbrance_id = e.id and status = 'awaiting_financier' for update;
  if t.id is not null then
    update public.transfers set status = 'awaiting_buyer', financier_decision = 'release' where id = t.id;
    perform app.notify_transfer_buyer(t.id);
  end if;
  perform app.after_encumbrance_change(e.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true));
end $$;

-- Owner asks the holder to release ("Begär frisläppning", SPEC §6.6 step 5). Also used by dealers at trade-in.
create or replace function public.request_encumbrance_release(p_org_id uuid, p_encumbrance_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; m public.machines;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into m from public.machines where id = e.machine_id;
  if not (app.machine_relations(m.id, array[actor]) && array['owner', 'user', 'transfer_party']) then perform app.raise('FORBIDDEN'); end if;
  perform app.log_event('encumbrance.release_requested', m.id, m.owner_org_id, actor, jsonb_build_object('encumbrance_id', e.id));
  perform app.notify_org(e.holder_org_id, 'encumbrance.release_requested',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'requested_by', (select name from public.organizations where id = actor),
      'message', left(p_message, 1000), 'encumbrance_id', e.id), '/machines/' || m.id, 'warning');
  return jsonb_build_object('ok', true);
end $$;

-- Holder transfers the encumbrance to another financier: both sign; old row → transferred, new row → active (SPEC §6.7).
create or replace function public.transfer_encumbrance_holder(p_org_id uuid, p_encumbrance_id uuid, p_new_holder_org_id uuid, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; n public.encumbrances; m public.machines; sig uuid;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if e.status <> 'active' then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  if not app.has_org_type(p_new_holder_org_id, 'financier') or p_new_holder_org_id = actor then perform app.raise('VALIDATION', '{"field":"new_holder_org_id"}'); end if;
  if exists (select 1 from public.encumbrances where transferred_from_encumbrance_id = e.id and status = 'pending') then
    perform app.raise('ENCUMBRANCE_TRANSFER_PENDING');
  end if;
  sig := app.consume_signature(p_signature_id, 'transfer_encumbrance_holder', e.id, jsonb_build_object('new_holder_org_id', p_new_holder_org_id));
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    transferred_from_encumbrance_id, requested_by_org_id, registered_by_user_id, notes)
  values (e.machine_id, e.type, p_new_holder_org_id, e.counterparty_org_id, e.contract_ref, e.start_date, e.end_date, 'pending',
    e.id, actor, auth.uid(), e.notes) returning * into n;
  select * into m from public.machines where id = e.machine_id;
  perform app.log_event('encumbrance.transfer_initiated', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'new_encumbrance_id', n.id, 'new_holder_org_id', p_new_holder_org_id, 'signature_id', sig));
  perform app.notify_org(p_new_holder_org_id, 'encumbrance.transfer_offered',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'from', (select name from public.organizations where id = actor), 'encumbrance_id', n.id),
    '/inbox', 'warning');
  return jsonb_build_object('ok', true, 'new_encumbrance_id', n.id);
end $$;

create or replace function public.accept_encumbrance_transfer(p_org_id uuid, p_encumbrance_id uuid, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); n public.encumbrances; old public.encumbrances; m public.machines; sig uuid; ev public.events;
begin
  select * into n from public.encumbrances where id = p_encumbrance_id for update;
  if n.id is null or n.transferred_from_encumbrance_id is null then perform app.raise('NOT_FOUND'); end if;
  if n.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if n.status <> 'pending' then perform app.raise('ENCUMBRANCE_NOT_PENDING'); end if;
  select * into old from public.encumbrances where id = n.transferred_from_encumbrance_id for update;
  if old.status <> 'active' then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  sig := app.consume_signature(p_signature_id, 'accept_encumbrance_transfer', n.id);
  update public.encumbrances set status = 'transferred', released_at = now() where id = old.id;
  update public.encumbrances set status = 'active', confirmed_at = now(), signature_id = sig where id = n.id returning * into n;
  select * into m from public.machines where id = n.machine_id;
  ev := app.log_event('encumbrance.holder_transferred', m.id, m.owner_org_id, actor,
    jsonb_build_object('from_encumbrance_id', old.id, 'encumbrance_id', n.id, 'from_holder_org_id', old.holder_org_id, 'holder_org_id', actor));
  perform app.notify_org(m.owner_org_id, 'encumbrance.holder_transferred',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'from', (select name from public.organizations where id = old.holder_org_id),
      'to', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'warning');
  perform app.notify_org(old.holder_org_id, 'encumbrance.transfer_accepted',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'to', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', n.id, 'transferred_from', old.id), ev.id);
  perform app.after_encumbrance_change(n.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(n, true));
end $$;

-- ---------- Transfers ----------
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
    'new_financing', t.new_financing, 'created_at', t.created_at) end
$$;

-- [v1.1] effective date = sale date if reported within 10 days of the sale, otherwise the reporting date.
create or replace function app.transfer_effective_date(p_sale_date date, p_reported_at timestamptz)
returns date language sql immutable set search_path = '' as $$
  select case when (p_reported_at at time zone 'Europe/Stockholm')::date - p_sale_date <= 10 then p_sale_date
              else (p_reported_at at time zone 'Europe/Stockholm')::date end
$$;

create or replace function app.notify_transfer_buyer(p_transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.transfers; m public.machines; token text; seller text;
begin
  select * into t from public.transfers where id = p_transfer_id;
  select * into m from public.machines where id = t.machine_id;
  select name into seller from public.organizations where id = t.from_org_id;
  if t.to_org_id is not null and exists (select 1 from public.memberships where org_id = t.to_org_id and status = 'active') then
    perform app.notify_org(t.to_org_id, 'transfer.awaiting_you',
      jsonb_build_object('transfer_id', t.id, 'machine_id', m.id, 'reg_number', m.reg_number, 'seller', seller), '/inbox', 'warning');
    perform app.enqueue_webhook(t.to_org_id, 'transfer.awaiting_you', m.id, jsonb_build_object('transfer_id', t.id, 'role', 'buyer'));
  elsif t.to_email is not null then
    token := encode(extensions.gen_random_bytes(24), 'hex');
    update public.transfers set invite_token_hash = app.sha256_hex(token) where id = t.id;
    insert into public.email_outbox (to_email, org_id, template, data)
    values (t.to_email, t.to_org_id, 'transfer_invite', jsonb_build_object('token', token, 'transfer_id', t.id, 'reg_number', m.reg_number,
      'make', m.make, 'model', m.model, 'seller', seller));
  end if;
end $$;

-- Shared by initiate_transfer and approve_trade_in: decides between awaiting_financier and awaiting_buyer.
create or replace function app.open_transfer(p_transfer_id uuid)
returns public.transfers language plpgsql security definer set search_path = '' as $$
declare t public.transfers; m public.machines; fin public.encumbrances; ev public.events;
begin
  select * into t from public.transfers where id = p_transfer_id for update;
  select * into m from public.machines where id = t.machine_id;
  fin := app.active_financing(m.id);
  if fin.id is null then
    -- [v1.1] Rental/use right of ≥ 1 year held by someone else than the seller also needs the lessor's consent.
    select * into fin from public.encumbrances where machine_id = m.id and status = 'active' and type = 'rental'
      and holder_org_id <> t.from_org_id and coalesce(end_date, 'infinity'::date) >= start_date + 365 limit 1;
  end if;
  if fin.id is not null and fin.holder_org_id <> t.from_org_id then
    update public.transfers set status = 'awaiting_financier', existing_encumbrance_id = fin.id where id = t.id returning * into t;
    perform app.notify_org(fin.holder_org_id, 'transfer.awaiting_financier',
      jsonb_build_object('transfer_id', t.id, 'machine_id', m.id, 'reg_number', m.reg_number,
        'seller', (select name from public.organizations where id = t.from_org_id)), '/inbox', 'warning');
    perform app.enqueue_webhook(fin.holder_org_id, 'transfer.awaiting_you', m.id, jsonb_build_object('transfer_id', t.id, 'role', 'financier'));
  else
    update public.transfers set status = 'awaiting_buyer', existing_encumbrance_id = fin.id,
      financier_decision = case when fin.id is not null then 'transfer_to_buyer' end where id = t.id returning * into t;
    perform app.notify_transfer_buyer(t.id);
  end if;
  ev := app.log_event('transfer.initiated', m.id, m.owner_org_id, t.initiated_by_org_id,
    jsonb_build_object('transfer_id', t.id, 'to_org_id', t.to_org_id, 'sale_date', t.sale_date, 'effective_date', t.effective_date,
      'status', t.status, 'is_trade_in', t.is_trade_in));
  perform app.enqueue_webhook(m.owner_org_id, 'transfer.initiated', m.id, jsonb_build_object('transfer_id', t.id, 'status', t.status), ev.id);
  return t;
end $$;

create or replace function public.initiate_transfer(p_org_id uuid, p_machine_id uuid, p_sale_date date default current_date,
  p_to_org_id uuid default null, p_to_org_number text default null, p_to_email text default null,
  p_new_financing jsonb default null, p_document_ids uuid[] default '{}', p_is_trade_in boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; buyer uuid; t public.transfers; fin public.encumbrances;
begin
  perform app.require_scope('transfers:write');
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  fin := app.active_financing(m.id);
  -- Seller: current owner (dealer for stock machines), the holder of a leasing object, or an operator.
  if (m.owner_org_id = actor or (fin.type = 'leasing' and fin.holder_org_id = actor) or app.is_operator('superadmin')) is not true then
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
  if p_new_financing is not null and not app.has_org_type((p_new_financing ->> 'holder_org_id')::uuid, 'financier') then
    perform app.raise('VALIDATION', '{"field":"new_financing.holder_org_id"}');
  end if;
  insert into public.transfers (machine_id, from_org_id, to_org_id, to_org_number, to_email, initiated_by_user_id, initiated_by_org_id,
    sale_date, reported_at, effective_date, status, is_trade_in, new_financing, document_ids)
  values (m.id, m.owner_org_id, buyer, app.normalize_org_number(p_to_org_number), lower(nullif(trim(p_to_email), '')), auth.uid(), actor,
    p_sale_date, now(), app.transfer_effective_date(p_sale_date, now()), 'draft', coalesce(p_is_trade_in, false), p_new_financing,
    coalesce(p_document_ids, '{}'))
  returning * into t;
  t := app.open_transfer(t.id);
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

-- Dealer starts a trade-in after scanning the label; the owner must approve (SPEC §6.7 step 5).
create or replace function public.request_trade_in(p_org_id uuid, p_machine_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; t public.transfers;
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if m.owner_org_id = actor then perform app.raise('VALIDATION', '{"reason":"already_owner"}'); end if;
  perform app.assert_not_blocked(m.id, 'request_trade_in');
  if exists (select 1 from public.transfers where machine_id = m.id and status in ('draft', 'awaiting_buyer', 'awaiting_financier')) then
    perform app.raise('TRANSFER_ALREADY_OPEN');
  end if;
  insert into public.transfers (machine_id, from_org_id, to_org_id, initiated_by_user_id, initiated_by_org_id, sale_date, effective_date,
    status, is_trade_in)
  values (m.id, m.owner_org_id, actor, auth.uid(), actor, current_date, current_date, 'draft', true) returning * into t;
  perform app.log_event('transfer.trade_in_requested', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id));
  perform app.notify_org(m.owner_org_id, 'transfer.trade_in_requested',
    jsonb_build_object('transfer_id', t.id, 'machine_id', m.id, 'reg_number', m.reg_number, 'dealer', (select name from public.organizations where id = actor),
      'message', left(p_message, 1000)), '/inbox', 'warning');
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

create or replace function public.approve_trade_in(p_org_id uuid, p_transfer_id uuid, p_sale_date date default current_date, p_document_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); t public.transfers;
begin
  select * into t from public.transfers where id = p_transfer_id for update;
  if t.id is null or t.status <> 'draft' or not t.is_trade_in then perform app.raise('NOT_FOUND'); end if;
  if t.from_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  perform app.assert_not_blocked(t.machine_id, 'approve_trade_in');
  if p_sale_date > current_date then perform app.raise('VALIDATION', '{"field":"sale_date"}'); end if;
  update public.transfers set sale_date = p_sale_date, reported_at = now(), effective_date = app.transfer_effective_date(p_sale_date, now()),
    document_ids = coalesce(p_document_ids, '{}'), initiated_by_user_id = auth.uid() where id = t.id;
  t := app.open_transfer(t.id);
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

create or replace function public.approve_transfer_financier(p_org_id uuid, p_transfer_id uuid, p_decision text, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); t public.transfers; e public.encumbrances; m public.machines; sig uuid;
begin
  perform app.require_scope('transfers:write');
  select * into t from public.transfers where id = p_transfer_id for update;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into e from public.encumbrances where id = t.existing_encumbrance_id for update;
  if e.holder_org_id is distinct from actor then perform app.raise('FORBIDDEN'); end if;
  if t.status <> 'awaiting_financier' then perform app.raise('TRANSFER_NOT_AWAITING_FINANCIER'); end if;
  if p_decision not in ('release', 'transfer_to_buyer', 'reject') then perform app.raise('VALIDATION', '{"field":"decision"}'); end if;
  sig := app.consume_signature(p_signature_id, 'approve_transfer_financier', t.id, jsonb_build_object('decision', p_decision), true);
  select * into m from public.machines where id = t.machine_id;
  if p_decision = 'reject' then
    update public.transfers set status = 'cancelled', financier_decision = 'reject', financier_signature_id = sig,
      cancelled_reason = 'financier_rejected' where id = t.id returning * into t;
    perform app.log_event('transfer.financier_rejected', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id));
    perform app.notify_org(t.from_org_id, 'transfer.financier_rejected', jsonb_build_object('transfer_id', t.id, 'reg_number', m.reg_number,
      'holder', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'warning');
    return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
  end if;
  if p_decision = 'release' then
    update public.encumbrances set status = 'released', released_at = now(), released_by_user_id = auth.uid(), release_signature_id = sig
    where id = e.id;
    perform app.log_event('encumbrance.released', m.id, m.owner_org_id, actor, jsonb_build_object('encumbrance_id', e.id, 'transfer_id', t.id));
    perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.released', m.id, jsonb_build_object('encumbrance_id', e.id));
  end if;
  update public.transfers set status = 'awaiting_buyer', financier_decision = p_decision, financier_signature_id = sig where id = t.id returning * into t;
  perform app.log_event('transfer.financier_approved', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id, 'decision', p_decision));
  perform app.notify_org(t.from_org_id, 'transfer.financier_approved', jsonb_build_object('transfer_id', t.id, 'reg_number', m.reg_number,
    'decision', p_decision), '/machines/' || m.id, 'info');
  perform app.notify_transfer_buyer(t.id);
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

-- Buyer accepts with signature (SPEC §6.7 step 3, §16.9). Completes the transfer atomically.
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

  nf := t.new_financing;
  if nf is not null then
    insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
      requested_by_org_id, registered_by_user_id)
    values (m.id, coalesce(nf ->> 'type', 'ownership_reservation')::public.encumbrance_type, (nf ->> 'holder_org_id')::uuid, actor,
      nf ->> 'contract_ref', coalesce((nf ->> 'start_date')::date, t.effective_date), (nf ->> 'end_date')::date, 'pending', t.initiated_by_org_id, auth.uid())
    returning * into newe;
    update public.transfers set new_encumbrance_id = newe.id where id = t.id;
    perform app.notify_org(newe.holder_org_id, 'encumbrance.pending',
      jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'requested_by', (select name from public.organizations where id = t.initiated_by_org_id),
        'encumbrance_id', newe.id), '/inbox', 'warning');
    perform app.enqueue_webhook(newe.holder_org_id, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', newe.id));
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

-- Hook: documents that follow the machine, ownership certificate PDF, market alerts (later steps).
create or replace function app.after_transfer_completed(p_transfer_id uuid)
returns void language sql volatile set search_path = '' as $$ select $$;

create or replace function public.cancel_transfer(p_org_id uuid, p_transfer_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); t public.transfers; m public.machines; declined boolean;
begin
  perform app.require_scope('transfers:write');
  select * into t from public.transfers where id = p_transfer_id for update;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  if t.status not in ('draft', 'awaiting_buyer', 'awaiting_financier') then perform app.raise('TRANSFER_NOT_OPEN'); end if;
  declined := t.to_org_id = actor and t.from_org_id <> actor;
  if (t.from_org_id = actor or t.initiated_by_org_id = actor or t.to_org_id = actor or app.is_operator('superadmin')) is not true then
    perform app.raise('FORBIDDEN');
  end if;
  update public.transfers set status = 'cancelled', cancelled_reason = coalesce(left(p_reason, 500), case when declined then 'buyer_declined' else 'seller_cancelled' end)
  where id = t.id returning * into t;
  select * into m from public.machines where id = t.machine_id;
  perform app.log_event('transfer.cancelled', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id, 'reason', t.cancelled_reason));
  perform app.notify_org(case when declined then t.from_org_id else t.to_org_id end, 'transfer.cancelled',
    jsonb_build_object('transfer_id', t.id, 'reg_number', m.reg_number, 'reason', t.cancelled_reason), '/machines/' || m.id, 'info');
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

create or replace function public.get_transfer(p_org_id uuid, p_transfer_id uuid, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); t public.transfers; e public.encumbrances; m public.machines;
begin
  select * into t from public.transfers where id = p_transfer_id;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into e from public.encumbrances where id = t.existing_encumbrance_id;
  if not (t.from_org_id = actor or t.to_org_id = actor or t.initiated_by_org_id = actor or e.holder_org_id = actor or app.is_operator()
          or app.acts_as('authority') or (p_token is not null and t.invite_token_hash = app.sha256_hex(p_token))) then
    perform app.raise('NOT_FOUND');
  end if;
  select * into m from public.machines where id = t.machine_id;
  -- The buyer sees the machine card, history summary and financing before signing (SPEC §6.7 step 3).
  return app.transfer_json(t) || jsonb_build_object('machine', app.machine_base_json(m)
    || jsonb_build_object('identifiers', (select jsonb_agg(jsonb_build_object('type', type, 'value', value)) from public.machine_identifiers where machine_id = m.id),
       'flags', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'status', status)), '[]') from public.flags where machine_id = m.id and status = 'active'),
       'owner_ordinal', (select count(*) from public.ownerships where machine_id = m.id)));
end $$;

create or replace function app.expire_transfers()
returns int language plpgsql security definer set search_path = '' as $$
declare t record; n int := 0;
begin
  for t in update public.transfers set status = 'expired' where status in ('draft', 'awaiting_buyer', 'awaiting_financier') and expires_at < now()
           returning * loop
    perform app.log_event('transfer.expired', t.machine_id, t.from_org_id, null, jsonb_build_object('transfer_id', t.id));
    perform app.notify_org(t.from_org_id, 'transfer.expired', jsonb_build_object('transfer_id', t.id), '/machines/' || t.machine_id, 'info');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Flags ----------
create or replace function app.can_raise_flag(p_machine_id uuid, p_actor uuid, p_type public.flag_type)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare rel text[] := app.machine_relations(p_machine_id, array[p_actor]); holder boolean;
begin
  holder := exists (select 1 from public.encumbrances where machine_id = p_machine_id and status = 'active' and holder_org_id = p_actor);
  return case p_type
    when 'stolen' then rel && array['owner', 'user', 'insurer'] or holder or app.has_org_type(p_actor, 'authority') or app.is_operator('verifier')
    when 'seized' then app.has_org_type(p_actor, 'authority')
    when 'blocked' then app.has_org_type(p_actor, 'authority') or app.is_operator('verifier')
    when 'under_investigation' then app.has_org_type(p_actor, 'authority') or app.is_operator('verifier')
    when 'disputed' then app.is_operator('verifier')
    when 'scrapped' then 'owner' = any (rel) or holder or app.is_operator('superadmin')
    when 'exported' then 'owner' = any (rel) or holder or app.is_operator('superadmin')
    else false end;
end $$;

create or replace function public.raise_flag(p_org_id uuid, p_machine_id uuid, p_type public.flag_type, p_reference text default null,
  p_description text default null, p_occurred_at timestamptz default null, p_location_text text default null, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; f public.flags; sig uuid; ev public.events; st public.machine_status;
  sev public.notification_severity;
begin
  perform app.require_scope('flags:write');
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if not app.can_raise_flag(m.id, actor, p_type) then perform app.raise('FORBIDDEN'); end if;
  if p_type in ('scrapped', 'exported') then
    -- Scrapped/exported is a deregistration (labels revoked, serial released) – SPEC §6.8/§6.9.
    return public.deregister_machine(actor, m.id, p_type::text::public.deregistration_reason, 'removed', p_signature_id, p_description, p_occurred_at::date);
  end if;
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  if exists (select 1 from public.flags where machine_id = m.id and type = p_type and status = 'active') then
    perform app.raise('FLAG_ALREADY_ACTIVE');
  end if;
  if p_type = 'stolen' and nullif(trim(p_reference), '') is null and not app.has_org_type(actor, 'authority') then
    perform app.raise('VALIDATION', '{"field":"reference","reason":"police_report_required"}');
  end if;
  if p_type = 'stolen' then
    sig := app.consume_signature(p_signature_id, 'raise_flag_stolen', m.id, jsonb_build_object('reference', nullif(trim(p_reference), '')), true);
  end if;
  insert into public.flags (machine_id, type, raised_by_org_id, raised_by_user_id, reference, description, occurred_at, location_text, signature_id)
  values (m.id, p_type, actor, auth.uid(), upper(nullif(trim(p_reference), '')), nullif(trim(p_description), ''), p_occurred_at,
          nullif(trim(p_location_text), ''), sig)
  returning * into f;
  st := app.recompute_machine_status(m.id);
  ev := app.log_event('flag.raised', m.id, m.owner_org_id, actor, jsonb_build_object('flag_id', f.id, 'type', f.type, 'reference', f.reference,
    'status', st, 'by_authority', app.has_org_type(actor, 'authority')));
  sev := case when p_type = 'stolen' then 'critical' else 'warning' end;
  perform app.notify_org(m.owner_org_id, 'flag.raised', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'type', f.type,
    'by', (select name from public.organizations where id = actor)), '/machines/' || m.id, sev);
  if actor <> m.owner_org_id then
    perform app.notify_org(actor, 'flag.raised', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'type', f.type), '/machines/' || m.id, 'info');
  end if;
  perform app.enqueue_webhook(m.owner_org_id, 'flag.raised', m.id, jsonb_build_object('flag_id', f.id, 'type', f.type), ev.id);
  perform app.enqueue_webhook(e.holder_org_id, 'flag.raised', m.id, jsonb_build_object('flag_id', f.id, 'type', f.type), ev.id)
    from public.encumbrances e where e.machine_id = m.id and e.status = 'active' and e.holder_org_id <> m.owner_org_id;
  perform app.after_flag_raised(f.id);
  return jsonb_build_object('ok', true, 'flag', to_jsonb(f), 'status', st);
end $$;

-- Hook: insurer webhooks, market matching, theft register sync, marketplace partners (later steps).
create or replace function app.after_flag_raised(p_flag_id uuid)
returns void language sql volatile set search_path = '' as $$ select $$;

create or replace function public.clear_flag(p_org_id uuid, p_flag_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); f public.flags; m public.machines; st public.machine_status; ev public.events;
begin
  perform app.require_scope('flags:write');
  select * into f from public.flags where id = p_flag_id for update;
  if f.id is null then perform app.raise('NOT_FOUND'); end if;
  if f.status <> 'active' then perform app.raise('FLAG_NOT_ACTIVE'); end if;
  -- Same party that raised it, or an authority/operator (SPEC §6.8).
  if (f.raised_by_org_id = actor or app.has_org_type(actor, 'authority') or app.is_operator('verifier')) is not true then
    perform app.raise('FORBIDDEN');
  end if;
  if nullif(trim(p_reason), '') is null then perform app.raise('VALIDATION', '{"field":"reason"}'); end if;
  update public.flags set status = 'cleared', cleared_at = now(), cleared_by_user_id = auth.uid(), cleared_reason = trim(p_reason) where id = f.id
  returning * into f;
  st := app.recompute_machine_status(f.machine_id);
  select * into m from public.machines where id = f.machine_id;
  ev := app.log_event('flag.cleared', m.id, m.owner_org_id, actor, jsonb_build_object('flag_id', f.id, 'type', f.type, 'reason', f.cleared_reason, 'status', st));
  perform app.notify_org(m.owner_org_id, 'flag.cleared', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'type', f.type),
    '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'flag.cleared', m.id, jsonb_build_object('flag_id', f.id, 'type', f.type), ev.id);
  perform app.enqueue_webhook(e.holder_org_id, 'flag.cleared', m.id, jsonb_build_object('flag_id', f.id, 'type', f.type), ev.id)
    from public.encumbrances e where e.machine_id = m.id and e.status = 'active' and e.holder_org_id <> m.owner_org_id;
  return jsonb_build_object('ok', true, 'flag', to_jsonb(f), 'status', st);
end $$;

-- ---------- Deregistration (SPEC §6.9) ----------
create or replace function public.deregister_machine(p_org_id uuid, p_machine_id uuid, p_reason public.deregistration_reason,
  p_label_disposition text default 'removed', p_signature_id uuid default null, p_note text default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; fin public.encumbrances; is_holder boolean; sig uuid;
  st public.machine_status; ev public.events; revoked int;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  if p_label_disposition not in ('destroyed', 'removed', 'returned') then perform app.raise('VALIDATION', '{"field":"label_disposition"}'); end if;
  fin := app.active_financing(m.id);
  is_holder := fin.holder_org_id = actor;
  if p_reason = 'stolen_not_recovered' then
    if not app.is_operator('superadmin') then perform app.raise('FORBIDDEN'); end if;
  else
    if (m.owner_org_id = actor or is_holder or app.is_operator('superadmin')) is not true then perform app.raise('FORBIDDEN'); end if;
    -- Stolen or seized machines cannot be deregistered (SPEC §7.5).
    perform app.assert_not_blocked(m.id, 'deregister_machine');
    if fin.id is not null and not is_holder and not app.is_operator('superadmin') then
      perform app.raise('ENCUMBRANCE_BLOCKS_DEREGISTRATION', jsonb_build_object('holder', (select name from public.organizations where id = fin.holder_org_id)));
    end if;
  end if;
  sig := app.consume_signature(p_signature_id, 'deregister_machine', m.id,
    jsonb_build_object('reason', p_reason, 'label_disposition', p_label_disposition));
  st := case p_reason when 'scrapped' then 'scrapped' when 'exported' then 'exported' else 'deregistered' end::public.machine_status;
  update public.machines set status = st, deregistered_at = coalesce(p_date::timestamptz, now()), deregistration_reason = p_reason where id = m.id;
  -- [v1.1] the label is revoked in the same step so a deregistered label can never stay on a machine.
  update public.labels set status = 'revoked', revoked_at = now(), revoked_reason = 'deregistered:' || p_label_disposition
  where machine_id = m.id and status = 'bound';
  get diagnostics revoked = row_count;
  update public.transfers set status = 'cancelled', cancelled_reason = 'machine_deregistered'
  where machine_id = m.id and status in ('draft', 'awaiting_buyer', 'awaiting_financier');
  ev := app.log_event('machine.deregistered', m.id, m.owner_org_id, actor, jsonb_build_object('reason', p_reason, 'status', st,
    'label_disposition', p_label_disposition, 'labels_revoked', revoked, 'note', left(p_note, 500), 'by_holder', is_holder));
  if actor <> m.owner_org_id then
    perform app.notify_org(m.owner_org_id, 'machine.deregistered', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
      'reason', p_reason, 'by', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'warning');
  end if;
  perform app.enqueue_webhook(m.owner_org_id, 'flag.raised', m.id, jsonb_build_object('type', st), ev.id);
  return jsonb_build_object('ok', true, 'status', st, 'labels_revoked', revoked);
end $$;

-- ---------- Financing check with receipt (SPEC §6.6, §12 POST /checks) ----------
create or replace function app.receipt_number()
returns text language sql volatile set search_path = '' as $$
  select 'K-' || to_char(now() at time zone 'Europe/Stockholm', 'YYYY') || '-' || lpad(nextval('public.check_receipt_seq')::text, 6, '0')
$$;

-- Market observations hook (step 16): active listings for a machine.
create or replace function app.market_listings_for(p_machine_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$ select '[]'::jsonb $$;

create or replace function app.check_one(p_actor uuid, p_query jsonb, p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q text; typ text; mid uuid; m public.machines; fin public.encumbrances; res jsonb; rn text; r public.check_receipts; see_holder boolean;
begin
  typ := coalesce(p_query ->> 'type', case when p_query ? 'reg' then 'reg' when p_query ? 'pin' then 'pin' when p_query ? 'vin' then 'vin'
                                           when p_query ? 'road_reg' then 'road_reg' else 'serial' end);
  q := app.normalize_identifier(coalesce(p_query ->> 'value', p_query ->> typ));
  if q is null then perform app.raise('VALIDATION', '{"field":"query"}'); end if;
  if typ = 'reg' then
    if not app.is_valid_reg_number(q) then perform app.raise('VALIDATION', '{"field":"reg","reason":"check_character"}'); end if;
    select id into mid from public.machines where reg_number = q and status <> 'draft';
  else
    select x.machine_id into mid from public.machine_identifiers x join public.machines mm on mm.id = x.machine_id
      where x.normalized_value = q and (typ = 'any' or x.type::text = typ) and mm.status <> 'draft'
      order by x.unique_active desc limit 1;
  end if;
  see_holder := app.has_org_type(p_actor, 'financier') or app.has_org_type(p_actor, 'authority') or app.is_operator();
  if mid is null then
    res := jsonb_build_object('found', false);
  else
    select * into m from public.machines where id = mid;
    fin := app.active_financing(m.id);
    res := jsonb_build_object('found', true, 'machine_id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year,
      'status', m.status, 'verification_level', m.verification_level,
      'owner_org_name', case when see_holder or app.has_org_type(p_actor, 'dealer') or app.has_org_type(p_actor, 'insurer') then (select name from public.organizations where id = m.owner_org_id) end,
      'owner_org_number', case when see_holder then app.org_number_display(m.owner_org_id) end,
      'has_active_financing', fin.id is not null,
      'financing', case when fin.id is not null and see_holder then jsonb_build_object('type', fin.type, 'start_date', fin.start_date,
        'holder', (select name from public.organizations where id = fin.holder_org_id)) end,
      'flags', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'raised_at', raised_at)) from public.flags where machine_id = m.id and status = 'active'), '[]'::jsonb),
      'last_transfer_date', (select max(effective_date) from public.transfers where machine_id = m.id and status = 'completed'),
      'market_listings', app.market_listings_for(m.id));
  end if;
  rn := app.receipt_number();
  insert into public.check_receipts (receipt_number, machine_id, query, purpose, performed_by_org_id, performed_by_user_id, api_key_id, result, result_hash)
  values (rn, mid, jsonb_build_object('type', typ, 'value', q), left(p_purpose, 200), p_actor, auth.uid(), app.current_api_key_id(),
          res || jsonb_build_object('performed_by', (select name from public.organizations where id = p_actor), 'performed_at', app.iso_ts(now())),
          app.sha256_hex(rn || '|' || res::text))
  returning * into r;
  if mid is not null then
    perform app.log_event('machine.checked', mid, m.owner_org_id, p_actor, jsonb_build_object('receipt_number', rn, 'has_active_financing', fin.id is not null));
    perform app.after_lookup(p_actor, array[mid], 'check');
  end if;
  return jsonb_build_object('receipt_number', r.receipt_number, 'id', r.id, 'created_at', r.created_at, 'result', r.result, 'result_hash', r.result_hash);
end $$;

create or replace function public.perform_check(p_org_id uuid, p_query jsonb, p_purpose text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false);
begin
  perform app.require_scope('checks:write');
  if not (app.has_org_type(actor, 'financier') or app.has_org_type(actor, 'dealer') or app.has_org_type(actor, 'insurer')
          or app.has_org_type(actor, 'marketplace') or app.has_org_type(actor, 'authority') or app.has_org_type(actor, 'inspector')
          or app.is_operator()) then
    perform app.raise('FORBIDDEN');
  end if;
  return app.check_one(actor, p_query, p_purpose);
end $$;

create or replace function public.perform_check_batch(p_org_id uuid, p_queries jsonb, p_purpose text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); q jsonb; out jsonb := '[]'::jsonb;
begin
  perform app.require_scope('checks:write');
  if not (app.has_org_type(actor, 'financier') or app.has_org_type(actor, 'dealer') or app.has_org_type(actor, 'insurer')
          or app.has_org_type(actor, 'marketplace') or app.has_org_type(actor, 'authority') or app.is_operator()) then
    perform app.raise('FORBIDDEN');
  end if;
  if jsonb_typeof(p_queries) <> 'array' or jsonb_array_length(p_queries) = 0 or jsonb_array_length(p_queries) > 500 then
    perform app.raise('VALIDATION', '{"field":"queries","max":500}');
  end if;
  for q in select * from jsonb_array_elements(p_queries) loop
    begin
      out := out || jsonb_build_array(app.check_one(actor, q, p_purpose));
    exception when others then
      out := out || jsonb_build_array(jsonb_build_object('query', q, 'error', sqlerrm));
    end;
  end loop;
  return out;
end $$;

create or replace function public.list_check_receipts(p_org_id uuid, p_limit int default 100, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(r) - 'api_key_id' order by r.created_at desc) from (
    select * from public.check_receipts where performed_by_org_id = actor and (p_before is null or created_at < p_before)
    order by created_at desc limit least(greatest(p_limit, 1), 500)) r), '[]'::jsonb);
end $$;

create or replace function public.get_check_receipt(p_receipt_number text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.check_receipts;
begin
  select * into r from public.check_receipts where receipt_number = upper(trim(p_receipt_number));
  if r.id is null then perform app.raise('NOT_FOUND'); end if;
  if not (r.performed_by_org_id = any (app.current_org_ids()) or app.is_operator() or app.acts_as('authority')) then perform app.raise('NOT_FOUND'); end if;
  return to_jsonb(r) - 'api_key_id';
end $$;

-- Private buyer (BankID, no organisation) may see yes/no for a scanned machine – never the holder (SPEC §6.6 step 6).
create or replace function public.private_financing_status(p_code text default null, p_reg text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.machines; c jsonb;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if not app.is_verified_user() then perform app.raise('IDENTITY_NOT_VERIFIED'); end if;
  c := public.public_machine_card(p_code, p_reg);
  if not (c ->> 'found')::boolean then return c; end if;
  select * into m from public.machines where reg_number = c -> 'card' ->> 'reg_number';
  perform app.log_event('machine.checked', m.id, m.owner_org_id, null, jsonb_build_object('private', true));
  perform app.after_lookup(null, array[m.id], 'check');
  return c || jsonb_build_object('has_active_financing', (app.active_financing(m.id)).id is not null);
end $$;

-- ---------- Counterparty visibility for organisations (SPEC §11.2) ----------
drop policy organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated using (
  id = any (app.current_org_ids())
  or app.is_operator()
  or app.acts_as('authority')
  or (status = 'approved' and types && array['financier', 'dealer', 'inspector', 'insurer', 'manufacturer']::public.org_type[])
  or exists (select 1 from public.transfers t where (t.from_org_id = organizations.id and t.to_org_id = any (app.current_org_ids()))
                                              or (t.to_org_id = organizations.id and t.from_org_id = any (app.current_org_ids())))
  or exists (select 1 from public.encumbrances e where (e.holder_org_id = organizations.id and e.counterparty_org_id = any (app.current_org_ids()))
                                                 or (e.counterparty_org_id = organizations.id and e.holder_org_id = any (app.current_org_ids())))
);

-- ---------- RLS ----------
alter table public.signatures enable row level security;
alter table public.encumbrances enable row level security;
alter table public.transfers enable row level security;
alter table public.flags enable row level security;
alter table public.check_receipts enable row level security;
revoke all on public.signatures, public.encumbrances, public.transfers, public.flags, public.check_receipts from anon, authenticated;
grant select on public.signatures, public.encumbrances, public.flags, public.check_receipts to authenticated;
grant select (id, machine_id, from_org_id, to_org_id, to_org_number, to_email, initiated_by_user_id, initiated_by_org_id, sale_date,
  reported_at, effective_date, status, is_trade_in, new_encumbrance_id, new_financing, existing_encumbrance_id, financier_decision,
  document_ids, expires_at, completed_at, cancelled_reason, created_at, updated_at) on public.transfers to authenticated;

create policy signatures_read on public.signatures for select to authenticated using (signer_user_id = auth.uid());

create policy encumbrances_read on public.encumbrances for select to authenticated using (
  holder_org_id = any (app.current_org_ids())
  or counterparty_org_id = any (app.current_org_ids())
  or app.machine_relations(machine_id) && array['owner', 'user', 'operator', 'authority']
);

create policy transfers_read on public.transfers for select to authenticated using (
  from_org_id = any (app.current_org_ids()) or to_org_id = any (app.current_org_ids()) or initiated_by_org_id = any (app.current_org_ids())
  or exists (select 1 from public.encumbrances e where e.id = existing_encumbrance_id and e.holder_org_id = any (app.current_org_ids()))
  or app.is_operator() or app.acts_as('authority')
);

create policy flags_read on public.flags for select to authenticated using (
  raised_by_org_id = any (app.current_org_ids())
  or app.machine_relations(machine_id) && array['owner', 'user', 'holder', 'insurer', 'operator', 'authority']
);

create policy check_receipts_read on public.check_receipts for select to authenticated using (
  performed_by_org_id = any (app.current_org_ids()) or app.is_operator() or app.acts_as('authority')
);

grant execute on function
  public.start_signature(uuid, text, uuid, jsonb), public.complete_mock_signature(uuid),
  public.register_encumbrance(uuid, uuid, public.encumbrance_type, text, date, date, uuid, text, uuid),
  public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date),
  public.confirm_encumbrance(uuid, uuid), public.reject_encumbrance(uuid, uuid, text),
  public.release_encumbrance(uuid, uuid, uuid, text), public.request_encumbrance_release(uuid, uuid, text),
  public.transfer_encumbrance_holder(uuid, uuid, uuid, uuid), public.accept_encumbrance_transfer(uuid, uuid, uuid),
  public.initiate_transfer(uuid, uuid, date, uuid, text, text, jsonb, uuid[], boolean),
  public.request_trade_in(uuid, uuid, text), public.approve_trade_in(uuid, uuid, date, uuid[]),
  public.approve_transfer_financier(uuid, uuid, text, uuid), public.accept_transfer(uuid, uuid, uuid, text),
  public.cancel_transfer(uuid, uuid, text), public.get_transfer(uuid, uuid, text),
  public.raise_flag(uuid, uuid, public.flag_type, text, text, timestamptz, text, uuid), public.clear_flag(uuid, uuid, text),
  public.deregister_machine(uuid, uuid, public.deregistration_reason, text, uuid, text, date),
  public.perform_check(uuid, jsonb, text), public.perform_check_batch(uuid, jsonb, text),
  public.list_check_receipts(uuid, int, timestamptz), public.get_check_receipt(text), public.private_financing_status(text, text)
  to authenticated;
grant execute on function public.record_signature(uuid, public.signature_status, text, jsonb) to service_role;
