-- =====================================================================
-- Payoff ("lösen"): the bank gets a real work item, and the block is released in one approved step.
--
-- Until now the only way to ask a lender to release a financing was request_encumbrance_release, which wrote a
-- single bell notification linked to /machines/:id. No row, no entry in get_inbox, no webhook — so a bank had
-- nothing to work through and no record that the question had ever been asked. That is the whole reason
-- "Väntar på långivaren" felt like a dead end.
--
-- NO AMOUNT IS STORED (CLAUDE.md rule 5, SPEC §0). The payoff figure lives only inside the document the bank
-- uploads; the register keeps status, contract reference, validity date and the document id. That keeps the
-- register free of debt figures, which is exactly what lowers the threshold for the banks (ADR 0025).
-- =====================================================================

create table public.payoff_requests (
  id                        uuid primary key default gen_random_uuid(),
  machine_id                uuid not null references public.machines (id),
  encumbrance_id            uuid not null references public.encumbrances (id),
  requested_by_org_id       uuid not null references public.organizations (id),
  holder_org_id             uuid not null references public.organizations (id),
  transfer_id               uuid references public.transfers (id),
  purpose                   text not null check (purpose in ('trade_in', 'sale', 'export', 'owner_request')),
  status                    public.payoff_status not null default 'requested',
  message                   text check (message is null or length(message) <= 1000),
  quote_document_id         uuid references public.documents (id),
  quote_reference           text check (quote_reference is null or length(quote_reference) <= 100),
  quote_valid_until         date,
  quoted_at                 timestamptz,
  settlement_document_id    uuid references public.documents (id),
  settlement_submitted_at   timestamptz,
  settled_at                timestamptz,
  settled_signature_id      uuid references public.signatures (id),
  declined_reason           text check (declined_reason is null or length(declined_reason) <= 500),
  -- Captured when the payoff is requested in order to export, so the export is one click once the bank approves.
  export_country            char(2),
  export_customs_ref        text,
  created_by_user_id        uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on table public.payoff_requests is
  'Payoff requests between the party selling/exporting a machine and the lender. Deliberately holds no amount: the figure lives in quote_document_id.';

-- One open request per encumbrance: two parallel payoff conversations about the same credit is never right.
create unique index payoff_requests_one_open on public.payoff_requests (encumbrance_id)
  where status in ('requested', 'quoted', 'settlement_submitted');
create index payoff_requests_holder_idx on public.payoff_requests (holder_org_id, status);
create index payoff_requests_requester_idx on public.payoff_requests (requested_by_org_id, status);
create index payoff_requests_machine_idx on public.payoff_requests (machine_id, created_at desc);
create trigger payoff_requests_updated before update on public.payoff_requests
  for each row execute function app.set_updated_at();

alter table public.payoff_requests enable row level security;
revoke all on public.payoff_requests from anon, authenticated;
grant select on public.payoff_requests to authenticated;
create policy payoff_requests_read on public.payoff_requests for select to authenticated using (
  holder_org_id = any (app.current_org_ids())
  or requested_by_org_id = any (app.current_org_ids())
  or app.machine_relations(machine_id) && array['owner', 'user', 'operator']
);

create or replace function app.payoff_json(p public.payoff_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'machine_id', p.machine_id, 'encumbrance_id', p.encumbrance_id,
    'purpose', p.purpose, 'status', p.status, 'message', p.message,
    'requested_by', app.org_brief(p.requested_by_org_id), 'holder', app.org_brief(p.holder_org_id),
    'transfer_id', p.transfer_id,
    'quote_document_id', p.quote_document_id, 'quote_reference', p.quote_reference,
    'quote_valid_until', p.quote_valid_until, 'quoted_at', p.quoted_at,
    'settlement_document_id', p.settlement_document_id, 'settlement_submitted_at', p.settlement_submitted_at,
    'settled_at', p.settled_at, 'declined_reason', p.declined_reason,
    'export_country', p.export_country, 'export_customs_ref', p.export_customs_ref,
    'reg_number', (select reg_number from public.machines where id = p.machine_id),
    'created_at', p.created_at, 'updated_at', p.updated_at)
$$;

-- Attaches a document to the payoff conversation: it must belong to the acting org (or already to this machine),
-- becomes visible to owner and lender, and is pinned to the machine.
create or replace function app.attach_payoff_document(p_actor uuid, p_machine_id uuid, p_document_id uuid, p_type public.document_type)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  if p_document_id is null then return null; end if;
  select * into d from public.documents where id = p_document_id;
  if d.id is null then perform app.raise('NOT_FOUND', '{"field":"document_id"}'); end if;
  if d.org_id <> p_actor then perform app.raise('FORBIDDEN', '{"field":"document_id"}'); end if;
  if d.machine_id is not null and d.machine_id <> p_machine_id then
    perform app.raise('VALIDATION', '{"field":"document_id","reason":"belongs_to_other_machine"}');
  end if;
  if d.status not in ('clean', 'scanning') then perform app.raise('VALIDATION', '{"field":"document_id","reason":"not_scanned"}'); end if;
  update public.documents set machine_id = p_machine_id, type = p_type, visibility = 'owner_and_financier'
  where id = d.id;
  return d.id;
end $$;

-- ---------- Asking the lender to settle ----------
-- p_export_country is text, not char(2), for the same reason as in deregister_machine: the browser demo
-- backend builds its parameter cast from format_type(type, null), which truncates a char(2) value to one
-- character. The column stays char(2).
-- The write is split from the authorisation on purpose. request_trade_in has already established that the caller
-- is a dealer starting a trade-in, but at that moment the transfer is still `draft`, so the dealer is not yet a
-- `transfer_party` (app.machine_relations only grants that for awaiting_buyer/awaiting_financier). Widening that
-- relation would hand out machine-view read access well beyond this flow, so the internal helper takes the actor
-- as given and every public entry point does its own gate.
create or replace function app.create_payoff_request(p_actor uuid, p_encumbrance_id uuid, p_purpose text,
  p_message text default null, p_transfer_id uuid default null, p_export_country text default null,
  p_export_customs_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.encumbrances; m public.machines; p public.payoff_requests; ev public.events; country text;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.status <> 'active' then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  if e.holder_org_id = p_actor then perform app.raise('VALIDATION', '{"field":"encumbrance_id","reason":"own_encumbrance"}'); end if;
  if p_purpose not in ('trade_in', 'sale', 'export', 'owner_request') then perform app.raise('VALIDATION', '{"field":"purpose"}'); end if;
  country := upper(nullif(trim(p_export_country), ''));
  if country is not null and country !~ '^[A-Z][A-Z]$' then perform app.raise('VALIDATION', '{"field":"export_country"}'); end if;
  select * into m from public.machines where id = e.machine_id;
  if exists (select 1 from public.payoff_requests where encumbrance_id = e.id
             and status in ('requested', 'quoted', 'settlement_submitted')) then
    perform app.raise('PAYOFF_ALREADY_OPEN');
  end if;
  insert into public.payoff_requests (machine_id, encumbrance_id, requested_by_org_id, holder_org_id, transfer_id, purpose,
    message, export_country, export_customs_ref, created_by_user_id)
  values (m.id, e.id, p_actor, e.holder_org_id, p_transfer_id, p_purpose, nullif(trim(p_message), ''), country,
    nullif(trim(p_export_customs_ref), ''), auth.uid())
  returning * into p;
  ev := app.log_event('payoff.requested', m.id, m.owner_org_id, p_actor,
    jsonb_build_object('payoff_request_id', p.id, 'encumbrance_id', e.id, 'purpose', p.purpose));
  perform app.notify_org(e.holder_org_id, 'payoff.requested',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'payoff_request_id', p.id, 'purpose', p.purpose,
      'requested_by', (select name from public.organizations where id = p_actor), 'message', left(p_message, 1000)),
    '/inbox', 'warning');
  perform app.enqueue_webhook(e.holder_org_id, 'payoff.requested', m.id,
    jsonb_build_object('payoff_request_id', p.id, 'encumbrance_id', e.id, 'purpose', p.purpose), ev.id);
  return jsonb_build_object('ok', true, 'payoff_request', app.payoff_json(p));
end $$;

create or replace function public.request_payoff(p_org_id uuid, p_encumbrance_id uuid, p_purpose text default 'owner_request',
  p_message text default null, p_transfer_id uuid default null, p_export_country text default null,
  p_export_customs_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  -- Same relation gate as request_encumbrance_release: owner, user, or a dealer inside an open transfer.
  if not (app.machine_relations(e.machine_id, array[actor]) && array['owner', 'user', 'transfer_party']) then perform app.raise('FORBIDDEN'); end if;
  return app.create_payoff_request(actor, p_encumbrance_id, p_purpose, p_message, p_transfer_id, p_export_country, p_export_customs_ref);
end $$;

-- "Begär frisläppning" keeps its name and its callers, but the question now leaves a tracked row behind.
create or replace function public.request_encumbrance_release(p_org_id uuid, p_encumbrance_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.request_payoff(p_org_id, p_encumbrance_id, 'owner_request', p_message, null, null, null);
end $$;

-- ---------- The lender answers with a payoff statement ----------
create or replace function public.submit_payoff_quote(p_org_id uuid, p_payoff_request_id uuid, p_document_id uuid default null,
  p_reference text default null, p_valid_until date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); p public.payoff_requests; m public.machines; doc uuid; ev public.events;
begin
  perform app.require_scope('encumbrances:write');
  select * into p from public.payoff_requests where id = p_payoff_request_id for update;
  if p.id is null then perform app.raise('NOT_FOUND'); end if;
  if p.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if p.status <> 'requested' then perform app.raise('PAYOFF_NOT_PENDING', jsonb_build_object('status', p.status)); end if;
  if p_valid_until is not null and p_valid_until < current_date then perform app.raise('VALIDATION', '{"field":"valid_until"}'); end if;
  select * into m from public.machines where id = p.machine_id;
  doc := app.attach_payoff_document(actor, p.machine_id, p_document_id, 'payoff_statement');
  update public.payoff_requests set status = 'quoted', quote_document_id = doc, quote_reference = nullif(trim(p_reference), ''),
    quote_valid_until = p_valid_until, quoted_at = now()
  where id = p.id returning * into p;
  ev := app.log_event('payoff.quoted', m.id, m.owner_org_id, actor,
    jsonb_build_object('payoff_request_id', p.id, 'has_document', doc is not null, 'valid_until', p.quote_valid_until));
  perform app.notify_org(p.requested_by_org_id, 'payoff.quoted',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'payoff_request_id', p.id,
      'holder', (select name from public.organizations where id = actor), 'valid_until', p.quote_valid_until), '/inbox', 'warning');
  perform app.enqueue_webhook(p.requested_by_org_id, 'payoff.quoted', m.id, jsonb_build_object('payoff_request_id', p.id), ev.id);
  -- The quote's validity is worth a reminder for the requester; 'custom' avoids a new reminder_type.
  if p.quote_valid_until is not null then
    perform app.upsert_reminder(p.requested_by_org_id, m.id, 'custom', 'Lösenbesked går ut', p.quote_valid_until, null, p.id);
  end if;
  return jsonb_build_object('ok', true, 'payoff_request', app.payoff_json(p));
end $$;

-- ---------- The requester uploads proof that the credit is settled ----------
-- Note what this does NOT do: it does not touch the encumbrance. The block can only be released by the lender
-- (settle_payoff or release_encumbrance), both holder-only and both signed.
create or replace function public.submit_payoff_settlement(p_org_id uuid, p_payoff_request_id uuid, p_document_id uuid,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); p public.payoff_requests; m public.machines; doc uuid; ev public.events;
begin
  select * into p from public.payoff_requests where id = p_payoff_request_id for update;
  if p.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into m from public.machines where id = p.machine_id;
  if (p.requested_by_org_id = actor or m.owner_org_id = actor) is not true then perform app.raise('FORBIDDEN'); end if;
  if p.status not in ('requested', 'quoted') then perform app.raise('PAYOFF_NOT_PENDING', jsonb_build_object('status', p.status)); end if;
  if p_document_id is null then perform app.raise('VALIDATION', '{"field":"document_id"}'); end if;
  doc := app.attach_payoff_document(actor, p.machine_id, p_document_id, 'payoff_statement');
  update public.payoff_requests set status = 'settlement_submitted', settlement_document_id = doc,
    settlement_submitted_at = now(), message = coalesce(nullif(trim(p_note), ''), message)
  where id = p.id returning * into p;
  ev := app.log_event('payoff.settlement_submitted', m.id, m.owner_org_id, actor,
    jsonb_build_object('payoff_request_id', p.id, 'document_id', doc));
  perform app.notify_org(p.holder_org_id, 'payoff.settlement_submitted',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'payoff_request_id', p.id,
      'submitted_by', (select name from public.organizations where id = actor)), '/inbox', 'warning');
  perform app.enqueue_webhook(p.holder_org_id, 'payoff.settlement_submitted', m.id,
    jsonb_build_object('payoff_request_id', p.id), ev.id);
  return jsonb_build_object('ok', true, 'payoff_request', app.payoff_json(p));
end $$;

-- ---------- The lender approves: credit settled, block released, in one step ----------
-- Holder only, signed. Reuses the release_encumbrance signature action so the signed sentence is the same legal
-- statement a plain release carries, and no new signature text is introduced.
create or replace function public.settle_payoff(p_org_id uuid, p_payoff_request_id uuid, p_signature_id uuid default null,
  p_release boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); p public.payoff_requests; e public.encumbrances; m public.machines;
  sig uuid; ev public.events; t public.transfers;
begin
  perform app.require_scope('encumbrances:write');
  select * into p from public.payoff_requests where id = p_payoff_request_id for update;
  if p.id is null then perform app.raise('NOT_FOUND'); end if;
  if p.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if p.status not in ('requested', 'quoted', 'settlement_submitted') then
    perform app.raise('PAYOFF_NOT_PENDING', jsonb_build_object('status', p.status));
  end if;
  select * into e from public.encumbrances where id = p.encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.status <> 'active' then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  if e.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  select * into m from public.machines where id = p.machine_id;
  sig := app.consume_signature(p_signature_id, 'release_encumbrance', e.id, '{}'::jsonb, true);
  update public.payoff_requests set status = 'settled', settled_at = now(), settled_signature_id = sig where id = p.id returning * into p;
  if coalesce(p_release, true) then
    update public.encumbrances set status = 'released', released_at = now(), released_by_user_id = auth.uid(), release_signature_id = sig
    where id = e.id returning * into e;
    if e.type = 'leasing' and m.user_org_id is not null and m.user_org_id = e.counterparty_org_id and m.user_org_id <> m.owner_org_id then
      update public.machines set user_org_id = null where id = m.id;
    end if;
    ev := app.log_event('encumbrance.released', m.id, m.owner_org_id, actor,
      jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'payoff_request_id', p.id, 'reason', 'payoff_settled'));
    perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.released', m.id, jsonb_build_object('encumbrance_id', e.id), ev.id);
    perform app.enqueue_webhook(e.holder_org_id, 'encumbrance.released', m.id, jsonb_build_object('encumbrance_id', e.id), ev.id);
    perform app.after_encumbrance_change(e.id);
    -- A transfer that was waiting for this lender can now go to the buyer.
    select * into t from public.transfers where existing_encumbrance_id = e.id and status = 'awaiting_financier' for update;
    if t.id is not null then
      update public.transfers set status = 'awaiting_buyer', financier_decision = 'release' where id = t.id;
      perform app.notify_transfer_buyer(t.id);
    end if;
  end if;
  perform app.log_event('payoff.settled', m.id, m.owner_org_id, actor,
    jsonb_build_object('payoff_request_id', p.id, 'released', coalesce(p_release, true), 'purpose', p.purpose));
  perform app.notify_org(p.requested_by_org_id, 'payoff.settled',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'payoff_request_id', p.id, 'purpose', p.purpose,
      'holder', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'info');
  if p.requested_by_org_id <> m.owner_org_id then
    perform app.notify_org(m.owner_org_id, 'payoff.settled',
      jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'payoff_request_id', p.id,
        'holder', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'info');
  end if;
  perform app.enqueue_webhook(p.requested_by_org_id, 'payoff.settled', m.id, jsonb_build_object('payoff_request_id', p.id));
  return jsonb_build_object('ok', true, 'payoff_request', app.payoff_json(p), 'encumbrance', app.encumbrance_json(e, true));
end $$;

-- ---------- Decline, list, expire ----------
create or replace function public.decline_payoff(p_org_id uuid, p_payoff_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); p public.payoff_requests; m public.machines;
begin
  select * into p from public.payoff_requests where id = p_payoff_request_id for update;
  if p.id is null then perform app.raise('NOT_FOUND'); end if;
  if p.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if p.status not in ('requested', 'quoted', 'settlement_submitted') then
    perform app.raise('PAYOFF_NOT_PENDING', jsonb_build_object('status', p.status));
  end if;
  update public.payoff_requests set status = 'declined', declined_reason = left(nullif(trim(p_reason), ''), 500)
  where id = p.id returning * into p;
  select * into m from public.machines where id = p.machine_id;
  perform app.log_event('payoff.declined', m.id, m.owner_org_id, actor, jsonb_build_object('payoff_request_id', p.id));
  perform app.notify_org(p.requested_by_org_id, 'payoff.declined',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'payoff_request_id', p.id,
      'holder', (select name from public.organizations where id = actor), 'reason', p.declined_reason), '/machines/' || m.id, 'warning');
  perform app.enqueue_webhook(p.requested_by_org_id, 'payoff.declined', m.id, jsonb_build_object('payoff_request_id', p.id));
  return jsonb_build_object('ok', true, 'payoff_request', app.payoff_json(p));
end $$;

create or replace function public.list_payoff_requests(p_org_id uuid, p_status public.payoff_status default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  perform app.require_scope('encumbrances:write');
  return coalesce((select jsonb_agg(app.payoff_json(p) order by p.created_at desc) from public.payoff_requests p
    where (p.holder_org_id = actor or p.requested_by_org_id = actor
           or exists (select 1 from public.machines m where m.id = p.machine_id and m.owner_org_id = actor))
      and (p_status is null or p.status = p_status)), '[]'::jsonb);
end $$;

create or replace function app.expire_payoff_quotes()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.payoff_requests; n int := 0; m public.machines;
begin
  for p in update public.payoff_requests set status = 'expired'
           where status = 'quoted' and quote_valid_until is not null and quote_valid_until < current_date
           returning * loop
    select * into m from public.machines where id = p.machine_id;
    perform app.log_event('payoff.expired', p.machine_id, m.owner_org_id, null, jsonb_build_object('payoff_request_id', p.id));
    perform app.notify_org(p.requested_by_org_id, 'payoff.expired',
      jsonb_build_object('machine_id', p.machine_id, 'reg_number', m.reg_number, 'payoff_request_id', p.id), '/machines/' || p.machine_id, 'warning');
    perform app.notify_org(p.holder_org_id, 'payoff.expired',
      jsonb_build_object('machine_id', p.machine_id, 'reg_number', m.reg_number, 'payoff_request_id', p.id), '/inbox', 'info');
    n := n + 1;
  end loop;
  return jsonb_build_object('expired', n);
end $$;

insert into public.jobs (name, description, schedule, kind, target) values
  ('expire-payoff-quotes', 'Expire payoff quotes past their validity date', '25 4 * * *', 'sql', 'expire_payoff_quotes')
on conflict (name) do nothing;

revoke all on function public.request_payoff(uuid, uuid, text, text, uuid, text, text),
  public.submit_payoff_quote(uuid, uuid, uuid, text, date),
  public.submit_payoff_settlement(uuid, uuid, uuid, text),
  public.settle_payoff(uuid, uuid, uuid, boolean),
  public.decline_payoff(uuid, uuid, text),
  public.list_payoff_requests(uuid, public.payoff_status) from public;
grant execute on function public.request_payoff(uuid, uuid, text, text, uuid, text, text),
  public.submit_payoff_quote(uuid, uuid, uuid, text, date),
  public.submit_payoff_settlement(uuid, uuid, uuid, text),
  public.settle_payoff(uuid, uuid, uuid, boolean),
  public.decline_payoff(uuid, uuid, text),
  public.list_payoff_requests(uuid, public.payoff_status) to authenticated, service_role;

-- A transfer that dies must not leave the buyer's bank holding a pending request for ever, and the lender who
-- was asked to decide must be told it is over. Shared by cancel_transfer, expire_transfers and the financier's
-- own rejection.
create or replace function app.reject_pending_new_financing(p_transfer_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.transfers; e public.encumbrances; m public.machines;
begin
  select * into t from public.transfers where id = p_transfer_id;
  if t.new_encumbrance_id is null then return; end if;
  select * into e from public.encumbrances where id = t.new_encumbrance_id for update;
  if e.id is null or e.status <> 'pending' then return; end if;
  update public.encumbrances set status = 'rejected', rejected_reason = p_reason where id = e.id;
  select * into m from public.machines where id = t.machine_id;
  perform app.log_event('encumbrance.rejected', m.id, m.owner_org_id, null,
    jsonb_build_object('encumbrance_id', e.id, 'reason', p_reason, 'transfer_id', t.id));
  perform app.notify_org(e.holder_org_id, 'encumbrance.rejected',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'reason', p_reason), '/inbox', 'info');
  perform app.after_encumbrance_change(e.id);
end $$;

create or replace function public.cancel_transfer(p_org_id uuid, p_transfer_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); t public.transfers; m public.machines; declined boolean; e public.encumbrances;
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
  -- The lender that was asked to decide no longer has anything to decide: without this their inbox item
  -- simply vanished with no explanation.
  select * into e from public.encumbrances where id = t.existing_encumbrance_id;
  if e.id is not null and e.holder_org_id is not null and e.holder_org_id <> actor then
    perform app.notify_org(e.holder_org_id, 'transfer.cancelled',
      jsonb_build_object('transfer_id', t.id, 'reg_number', m.reg_number, 'reason', t.cancelled_reason), '/machines/' || m.id, 'info');
  end if;
  perform app.reject_pending_new_financing(t.id, 'transfer_cancelled');
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

create or replace function app.expire_transfers()
returns int language plpgsql security definer set search_path = '' as $$
declare t record; n int := 0; e public.encumbrances;
begin
  for t in update public.transfers set status = 'expired' where status in ('draft', 'awaiting_buyer', 'awaiting_financier') and expires_at < now()
           returning * loop
    perform app.log_event('transfer.expired', t.machine_id, t.from_org_id, null, jsonb_build_object('transfer_id', t.id));
    perform app.notify_org(t.from_org_id, 'transfer.expired', jsonb_build_object('transfer_id', t.id), '/machines/' || t.machine_id, 'info');
    select * into e from public.encumbrances where id = t.existing_encumbrance_id;
    if e.id is not null and e.holder_org_id is not null then
      perform app.notify_org(e.holder_org_id, 'transfer.expired', jsonb_build_object('transfer_id', t.id), '/machines/' || t.machine_id, 'info');
    end if;
    perform app.reject_pending_new_financing(t.id, 'transfer_expired');
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- Defects in the same flows, fixed here rather than left for later.
-- =====================================================================

-- 1. confirm_encumbrance treated a holder-transfer row as an ordinary pending request. Confirming one therefore
--    hit the active-conflict check against its OWN predecessor, raising a double_encumbrance conflict, a critical
--    notification to the previous lender and an operator ticket. A takeover must go through
--    accept_encumbrance_transfer; this guard makes that explicit instead of corrupting data.
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
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true));
end $$;

-- 2. approve_transfer_financier's `release` branch never called app.after_encumbrance_change, so the
--    encumbrance_end / lease_end reminders stayed open for both owner and lender after a release at sale.
--    3. The waiting lender is also told when the transfer they were holding is cancelled or expires.
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
    perform app.reject_pending_new_financing(t.id, 'financier_rejected');
    return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
  end if;
  if p_decision = 'release' then
    update public.encumbrances set status = 'released', released_at = now(), released_by_user_id = auth.uid(), release_signature_id = sig
    where id = e.id;
    perform app.log_event('encumbrance.released', m.id, m.owner_org_id, actor, jsonb_build_object('encumbrance_id', e.id, 'transfer_id', t.id));
    perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.released', m.id, jsonb_build_object('encumbrance_id', e.id));
    perform app.after_encumbrance_change(e.id);
    -- A payoff conversation about this credit is now resolved.
    update public.payoff_requests set status = 'settled', settled_at = now(), settled_signature_id = sig
    where encumbrance_id = e.id and status in ('requested', 'quoted', 'settlement_submitted');
  end if;
  update public.transfers set status = 'awaiting_buyer', financier_decision = p_decision, financier_signature_id = sig where id = t.id returning * into t;
  perform app.log_event('transfer.financier_approved', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id, 'decision', p_decision));
  perform app.notify_org(t.from_org_id, 'transfer.financier_approved', jsonb_build_object('transfer_id', t.id, 'reg_number', m.reg_number,
    'decision', p_decision), '/machines/' || m.id, 'info');
  perform app.notify_transfer_buyer(t.id);
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

-- ---------- Inbox: the lender finally has something to work through ----------
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
      'id', e.id, 'created_at', e.created_at, 'encumbrance', app.encumbrance_json(e, true),
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
  -- Invitations for the user (not org-bound)
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'invitation', 'id', m.id, 'created_at', m.created_at, 'org', app.org_brief(m.org_id), 'role', m.role))
    from public.memberships m where m.status = 'invited' and lower(m.invite_email) = me and (m.invite_expires_at is null or m.invite_expires_at > now())), '[]'::jsonb);
  return jsonb_build_object('count', jsonb_array_length(items),
    'items', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from jsonb_array_elements(items) x), '[]'::jsonb));
end $$;

-- ---------- Webhook events for the new flows (so a bank can automate all of it) ----------
create or replace function app.webhook_event_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['machine.registered', 'machine.verified', 'encumbrance.pending', 'encumbrance.confirmed', 'encumbrance.conflict',
    'encumbrance.released', 'transfer.initiated', 'transfer.awaiting_you', 'transfer.completed', 'flag.raised', 'flag.cleared',
    'machine.scanned', 'market.alert', 'label.bound', 'lead.created', 'ping',
    'payoff.requested', 'payoff.quoted', 'payoff.settlement_submitted', 'payoff.settled', 'payoff.declined',
    'machine.exported', 'machine.reimported']
$$;

-- ---------- Trade-in can ask the lender for a payoff straight away ----------
-- The 3-argument signature is dropped so the added default cannot leave an ambiguous overload behind.
drop function if exists public.request_trade_in(uuid, uuid, text);

create or replace function public.request_trade_in(p_org_id uuid, p_machine_id uuid, p_message text default null,
  p_request_payoff boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; t public.transfers; fin public.encumbrances; po jsonb;
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
  -- A bank-owned leasing object is the common case at trade-in. Asking for the payoff here means the lender
  -- hears about it when the dealer starts the deal, instead of only after the owner has approved the transfer
  -- (app.open_transfer is not reached until approve_trade_in).
  fin := app.active_financing(m.id);
  if coalesce(p_request_payoff, false) and fin.id is not null and fin.holder_org_id <> actor
     and not exists (select 1 from public.payoff_requests where encumbrance_id = fin.id
                     and status in ('requested', 'quoted', 'settlement_submitted')) then
    po := app.create_payoff_request(actor, fin.id, 'trade_in', p_message, t.id, null, null);
  end if;
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t), 'payoff_request', po -> 'payoff_request');
end $$;

revoke all on function public.request_trade_in(uuid, uuid, text, boolean) from public;
grant execute on function public.request_trade_in(uuid, uuid, text, boolean) to authenticated, service_role;
