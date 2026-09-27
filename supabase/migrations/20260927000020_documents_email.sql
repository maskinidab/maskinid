-- Step 18: PDFs and e-mail (SPEC §10 "PDF:er", §13). The PDFs themselves are rendered from snapshots (client or PDF
-- function); the database issues numbered, hashed snapshots that anyone can verify on /verify-document:
--   B-YYYY-NNNNNN  ownership certificate (ägarbevis / registreringsbekräftelse)
--   R-YYYY-NNNNNN  machine report (maskinrapport, SPEC §6.10 buyer_report)
-- plus the e-mail outbox worker RPCs used by the email-send Edge Function.

alter table public.report_snapshots drop constraint report_snapshots_kind_check;
alter table public.report_snapshots add constraint report_snapshots_kind_check
  check (kind in ('fleet_report', 'project_list', 'register_extract', 'ownership_certificate', 'machine_report'));
create index report_snapshots_machine_idx on public.report_snapshots ((params ->> 'machine_id')) where params ? 'machine_id';

create sequence public.ownership_certificate_seq;
create sequence public.machine_report_seq;
revoke all on sequence public.ownership_certificate_seq, public.machine_report_seq from anon, authenticated;

create or replace function app.snapshot(p_kind text, p_prefix text, p_seq text, p_org uuid, p_params jsonb, p_result jsonb)
returns public.report_snapshots language plpgsql security definer set search_path = '' as $$
declare rn text; s public.report_snapshots;
begin
  rn := p_prefix || '-' || to_char(now() at time zone 'Europe/Stockholm', 'YYYY') || '-' || lpad(nextval(p_seq)::text, 6, '0');
  insert into public.report_snapshots (kind, report_number, org_id, params, result, result_hash, created_by_user_id)
  values (p_kind, rn, p_org, p_params, p_result, app.sha256_hex(rn || '|' || p_result::text), auth.uid()) returning * into s;
  return s;
end $$;

-- ---------- Ownership certificate ----------
-- What the certificate states: the machine, its identifiers, the registered owner since when, verification level,
-- label, and whether financing is registered (yes/no + holder – the owner may see the holder). Never amounts,
-- never personal numbers (sole traders masked as everywhere else).
create or replace function app.ownership_certificate_json(m public.machines)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('generated_at', app.iso_ts(now()),
    'machine', app.machine_base_json(m) - 'description' - 'primary_photo_path' - 'hour_meter_updated_at',
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('type', i.type, 'value', i.value, 'verified', i.verified) order by i.type)
      from public.machine_identifiers i where i.machine_id = m.id), '[]'::jsonb),
    'owner', (select jsonb_build_object('name', o.name, 'org_number', case when o.is_sole_trader then '19XXXXXX-XXXX' else o.org_number end, 'city', o.city)
      from public.organizations o where o.id = m.owner_org_id),
    'owner_since', (select max(w.from_date) from public.ownerships w where w.machine_id = m.id and w.owner_org_id = m.owner_org_id and w.to_date is null),
    'owner_ordinal', (select count(*) from public.ownerships where machine_id = m.id),
    'label_code', (select l.code from public.labels l where l.machine_id = m.id and l.status = 'bound' and l.role = 'primary' limit 1),
    'financing', (select jsonb_build_object('has_active', e.id is not null, 'type', e.type,
        'holder', (select name from public.organizations where id = e.holder_org_id)) from (select (app.active_financing(m.id)).*) e),
    'first_sale_dealer', (select name from public.organizations where id = m.first_sale_dealer_org_id),
    'org_name', (select name from public.organizations where id = m.owner_org_id))
$$;

create or replace function app.issue_ownership_certificate(p_machine_id uuid, p_issuer uuid)
returns public.report_snapshots language plpgsql security definer set search_path = '' as $$
declare m public.machines; s public.report_snapshots;
begin
  select * into m from public.machines where id = p_machine_id;
  s := app.snapshot('ownership_certificate', 'B', 'public.ownership_certificate_seq', coalesce(p_issuer, m.owner_org_id),
    jsonb_build_object('machine_id', m.id, 'owner_org_id', m.owner_org_id), app.ownership_certificate_json(m));
  perform app.log_event('ownership_certificate.issued', m.id, m.owner_org_id, p_issuer, jsonb_build_object('certificate_number', s.report_number));
  return s;
end $$;

-- Owner, or the dealer that sold the machine new within the last 30 days (sale flow hands the certificate to the buyer).
create or replace function public.create_ownership_certificate(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); m public.machines; s public.report_snapshots;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if m.owner_org_id <> actor and (m.first_sale_dealer_org_id = actor and m.first_sale_date >= current_date - 30) is not true then
    perform app.raise('FORBIDDEN');
  end if;
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('INVALID_STATE', jsonb_build_object('status', m.status)); end if;
  s := app.issue_ownership_certificate(m.id, actor);
  return jsonb_build_object('report_number', s.report_number, 'created_at', s.created_at, 'result_hash', s.result_hash, 'result', s.result);
end $$;

-- Latest certificates of a machine (owner): lets the UI re-download without issuing a new number.
create or replace function public.list_ownership_certificates(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if not exists (select 1 from public.machines where id = p_machine_id and (owner_org_id = actor or first_sale_dealer_org_id = actor)) then
    perform app.raise('NOT_FOUND');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('report_number', s.report_number, 'created_at', s.created_at, 'result_hash', s.result_hash,
      'result', s.result) order by s.created_at desc)
    from public.report_snapshots s where s.kind = 'ownership_certificate' and s.params ->> 'machine_id' = p_machine_id::text
      and s.params ->> 'owner_org_id' = (select owner_org_id::text from public.machines where id = p_machine_id)), '[]'::jsonb);
end $$;

-- New owner ⇒ new certificate, e-mailed to the new owner's admins (SPEC §6.3, §6.7). Keeps step 13's new-sale logic.
create or replace function app.after_transfer_completed(p_transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.transfers; m public.machines; s public.report_snapshots; u record;
begin
  select * into t from public.transfers where id = p_transfer_id;
  if t.is_new_sale then
    update public.machines set first_sale_date = t.effective_date, first_sale_dealer_org_id = t.from_org_id,
      origin = case when origin = 'retro' then 'new_sale' else origin end
    where id = t.machine_id returning * into m;
    if m.verification_level < 2 then
      perform app.apply_verification(m.id, 2, 'new_sale', t.from_org_id, jsonb_build_object('transfer_id', t.id, 'new_sale', true));
    end if;
  end if;
  select * into m from public.machines where id = t.machine_id;
  s := app.issue_ownership_certificate(m.id, t.from_org_id);
  for u in select p.email, p.locale, p.user_id from public.memberships ms join public.profiles p on p.user_id = ms.user_id
           where ms.org_id = m.owner_org_id and ms.status = 'active' and ms.role = 'admin' and p.email is not null and p.deleted_at is null loop
    insert into public.email_outbox (to_email, user_id, org_id, template, locale, data)
    values (u.email, u.user_id, m.owner_org_id, 'ownership_certificate', u.locale, jsonb_build_object(
      'certificate_number', s.report_number, 'result_hash', s.result_hash, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model,
      'org_name', s.result ->> 'org_name', 'seller', (select name from public.organizations where id = t.from_org_id), 'machine_id', m.id));
  end loop;
end $$;

-- Buyer report: internal events (market alerts, generated documents, authority reads) are not part of the machine's
-- history as shown to a prospective buyer.
create or replace function app.buyer_report(p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.machines; af public.encumbrances;
begin
  select * into m from public.machines where id = p_machine_id;
  af := app.active_financing(m.id);
  return app.machine_base_json(m) || jsonb_build_object(
    'owner_ordinal', (select count(*) from public.ownerships where machine_id = m.id),
    'serial_masked', app.mask_serial(app.machine_primary_serial(m.id)),
    'financing', jsonb_build_object('has_active', af.id is not null,
      'holder', case when af.id is not null then (select name from public.organizations where id = af.holder_org_id) end,
      'type', af.type),
    'flags', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'raised_at', raised_at)) from public.flags where machine_id = m.id and status = 'active'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'created_at', e.created_at,
        'actor_org', (select name from public.organizations where id = e.actor_org_id)) order by e.seq desc)
      from public.events e where e.machine_id = m.id and e.type not in ('machine.checked', 'document.visibility_changed', 'share_link.created',
        'share_link.revoked', 'market.alert', 'market.alert_reviewed', 'ownership_certificate.issued', 'machine_report.created',
        'register_extract.created', 'authority.search', 'report.viewed', 'insurance.requirement_set')), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'filename', d.filename, 'created_at', d.created_at, 'sha256', d.sha256))
      from public.documents d where d.machine_id = m.id and d.visibility in ('verifiers', 'public') and d.status = 'clean' and d.archived_at is null), '[]'::jsonb)
  ) || app.buyer_report_extras(m.id);
end $$;

-- Buyer report (share link + machine report) includes hours, service and inspections (SPEC §6.10). Internal notes and
-- who performed work for private individuals are left out; the workshop name is shown as recorded.
create or replace function app.buyer_report_extras(p_machine_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'hour_meter', (select hour_meter from public.machines where id = p_machine_id),
    'maintenance', coalesce((select jsonb_agg(jsonb_build_object('type', x.type, 'performed_at', x.performed_at, 'hours', x.hours,
        'performed_by_text', coalesce((select name from public.organizations where id = x.performed_by_org_id), x.performed_by_text))
        order by x.performed_at desc) from (select * from public.maintenance_entries where machine_id = p_machine_id order by performed_at desc limit 50) x), '[]'::jsonb),
    'inspections', coalesce((select jsonb_agg(jsonb_build_object('type', i.type, 'performed_at', i.performed_at, 'result', i.result,
        'valid_until', i.valid_until, 'inspection_body_name', coalesce(i.inspection_body_name, (select name from public.organizations where id = i.inspection_body_org_id)))
        order by i.performed_at desc) from public.inspections i where i.machine_id = p_machine_id), '[]'::jsonb))
$$;

-- The registration result tells the client who became owner (the done screen offers the certificate to the owner).
create or replace function public.register_machine(p_org_id uuid, p_data jsonb, p_draft_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); r jsonb;
begin
  perform app.require_scope('machines:write');
  if not app.can_register(actor) then perform app.raise('FORBIDDEN'); end if;
  r := app.create_machine(actor, p_data, 'retro', p_draft_id);
  if nullif(p_data ->> 'label_code', '') is not null and r ->> 'status' = 'active' then
    r := r || jsonb_build_object('label', public.bind_label(actor, (r ->> 'id')::uuid, p_data ->> 'label_code', 'primary'));
  end if;
  return r || jsonb_build_object('owner_org_id', (select owner_org_id from public.machines where id = (r ->> 'id')::uuid));
end $$;

-- ---------- Machine report (maskinrapport) ----------
create or replace function app.issue_machine_report(p_machine_id uuid, p_org uuid, p_via text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.machines; s public.report_snapshots;
begin
  select * into m from public.machines where id = p_machine_id;
  s := app.snapshot('machine_report', 'R', 'public.machine_report_seq', p_org, jsonb_build_object('machine_id', m.id, 'via', p_via),
    jsonb_build_object('generated_at', app.iso_ts(now()), 'org_name', (select name from public.organizations where id = p_org),
      'machine', app.buyer_report(m.id)));
  perform app.log_event('machine_report.created', m.id, m.owner_org_id, p_org, jsonb_build_object('report_number', s.report_number, 'via', p_via));
  return jsonb_build_object('report_number', s.report_number, 'created_at', s.created_at, 'result_hash', s.result_hash, 'result', s.result);
end $$;

create or replace function public.create_machine_report(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); m public.machines;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if (app.machine_relations(m.id, array[actor]) && array['owner', 'user', 'operator']) is not true then perform app.raise('FORBIDDEN'); end if;
  return app.issue_machine_report(m.id, actor, 'owner');
end $$;

-- Machine report from a buyer_report share link (called by share-view with the service key). Same validity rules as
-- the view; at most 10 reports per link and day.
create or replace function public.create_shared_machine_report(p_token text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.share_links;
begin
  if p_ip_hash is not null and not app.rate_limit_hit('share-report:' || p_ip_hash, 10, interval '1 minute') then perform app.raise('RATE_LIMITED'); end if;
  select * into s from public.share_links where token_hash = app.sha256_hex(coalesce(p_token, ''));
  if s.id is null or s.revoked_at is not null or s.expires_at <= now() or s.scope <> 'buyer_report' or s.machine_id is null then
    perform app.raise('NOT_FOUND');
  end if;
  if not app.rate_limit_hit('share-report-link:' || s.id, 10, interval '1 day') then perform app.raise('RATE_LIMITED'); end if;
  insert into public.access_log (machine_id, viewer_type, via, ip_hash, visible_to_owner, purpose) values (s.machine_id, 'public', 'share_link', p_ip_hash, true, 'machine_report');
  return app.issue_machine_report(s.machine_id, s.org_id, 'share_link');
end $$;

-- ---------- Verification (/verify-document) ----------
create or replace function public.verify_report(p_report_number text, p_result_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.report_snapshots; newer text;
begin
  if not app.rate_limit_hit('report_verify:' || coalesce(auth.uid()::text,
       app.sha256_hex(coalesce(split_part(app.request_header('x-forwarded-for'), ',', 1), 'anon'))), 60, interval '1 hour') then
    perform app.raise('RATE_LIMITED');
  end if;
  select * into s from public.report_snapshots where report_number = upper(trim(p_report_number)) and result_hash = lower(trim(p_result_hash));
  if s.id is null then return jsonb_build_object('valid', false); end if;
  -- A certificate is superseded when the machine has changed owner since it was issued.
  if s.kind = 'ownership_certificate' and not exists (select 1 from public.machines where id = (s.params ->> 'machine_id')::uuid
      and owner_org_id = (s.params ->> 'owner_org_id')::uuid) then
    newer := 'owner_changed';
  end if;
  return jsonb_build_object('valid', true, 'report_number', s.report_number, 'kind', s.kind, 'created_at', s.created_at,
    'org_name', s.result ->> 'org_name',
    'machines', case when s.kind in ('register_extract', 'ownership_certificate', 'machine_report') then 1 else jsonb_array_length(s.result -> 'machines') end,
    'reg_number', s.result -> 'machine' ->> 'reg_number', 'superseded', newer);
end $$;

-- ---------- E-mail outbox worker (email-send Edge Function, service role) ----------
-- Claims due messages with a 10-minute lease (attempts + 1, send_after pushed); the worker reports each result.
create or replace function public.claim_email_outbox(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  with c as (
    select id from public.email_outbox where status = 'pending' and send_after <= now()
    order by send_after limit least(greatest(coalesce(p_limit, 50), 1), 200) for update skip locked
  ), u as (
    update public.email_outbox o set attempts = attempts + 1, send_after = now() + interval '10 minutes' from c where o.id = c.id
    returning o.id, o.to_email, o.template, o.locale, o.data, o.attachments, o.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into res from u;
  return res;
end $$;

create or replace function public.record_email_result(p_id uuid, p_ok boolean, p_error text default null, p_skip boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.email_outbox set
    status = case when p_skip then 'skipped' when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    -- Backoff 1 min, 5 min, 30 min, 2 h before giving up after 5 attempts.
    send_after = case when p_ok or p_skip then send_after
      else now() + (array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours', interval '2 hours'])[least(attempts, 5)] end
  where id = p_id;
end $$;

revoke execute on function public.create_shared_machine_report(text, text), public.claim_email_outbox(int), public.record_email_result(uuid, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_shared_machine_report(text, text), public.claim_email_outbox(int), public.record_email_result(uuid, boolean, text, boolean)
  to service_role;
grant execute on function public.create_ownership_certificate(uuid, uuid), public.list_ownership_certificates(uuid, uuid),
  public.create_machine_report(uuid, uuid) to authenticated;
select app.grant_api_access();
