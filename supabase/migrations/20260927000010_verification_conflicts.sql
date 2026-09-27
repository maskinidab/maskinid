-- =====================================================================
-- Step 7 – verification & conflicts (SPEC §3.1, §4.4, §6.4, §11.4,
-- §11.7 owner correction), inbox ("Väntar på mig", SPEC §9.2)
-- =====================================================================

create table public.verification_requests (
  id                    uuid primary key default gen_random_uuid(),
  machine_id            uuid not null references public.machines (id),
  requested_level       smallint not null check (requested_level in (1, 2)),
  requested_by_org_id   uuid not null references public.organizations (id),
  requested_by_user_id  uuid,
  reviewer_org_id       uuid references public.organizations (id),   -- chosen partner; null = operator queue
  status                public.verification_request_status not null default 'open',
  assigned_to_user_id   uuid,
  document_ids          uuid[] not null default '{}',
  note                  text,
  preferred_date        date,
  site_address          text,
  nameplate_check       jsonb,          -- level 2: {read_serial, registered_serial, match, source}
  decision_note         text,
  decided_by_org_id     uuid references public.organizations (id),
  decided_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index verification_requests_one_open on public.verification_requests (machine_id, requested_level)
  where status in ('open', 'in_review', 'needs_info');
create index verification_requests_reviewer_idx on public.verification_requests (reviewer_org_id, status);
create index verification_requests_status_idx on public.verification_requests (status, created_at);
create trigger verification_requests_updated before update on public.verification_requests for each row execute function app.set_updated_at();

create table public.owner_corrections (
  id                  uuid primary key default gen_random_uuid(),
  machine_id          uuid not null references public.machines (id),
  from_org_id         uuid not null references public.organizations (id),
  to_org_id           uuid not null references public.organizations (id),
  reason              text not null,
  obvious_typo        boolean not null default false,
  conflict_id         uuid references public.conflicts (id),
  proposed_by_user_id uuid not null,
  proposed_signature_id uuid references public.signatures (id),
  approved_by_user_id uuid,
  approved_signature_id uuid references public.signatures (id),
  status              text not null default 'proposed' check (status in ('proposed', 'objection_period', 'objected', 'applied', 'cancelled')),
  effective_after     timestamptz,
  objection_note      text,
  applied_at          timestamptz,
  created_at          timestamptz not null default now()
);
create unique index owner_corrections_one_open on public.owner_corrections (machine_id) where status in ('proposed', 'objection_period', 'objected');

-- ---------- Relations: assigned inspector/partner ----------
create or replace function app.machine_relations_more(m public.machines, p_orgs uuid[])
returns text[] language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.verification_requests v where v.machine_id = m.id and v.reviewer_org_id = any (p_orgs)
                           and v.status in ('open', 'in_review', 'needs_info'))
              then array['inspector_assigned'] else '{}'::text[] end
$$;

-- ---------- Signature texts for corrections (extends step 5) ----------
create or replace function app.signature_text_more(p_action text, p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare c public.owner_corrections; m public.machines; f text; t text; en boolean := p_locale = 'en';
begin
  if p_action in ('propose_owner_correction', 'approve_owner_correction') then
    if p_action = 'propose_owner_correction' then
      select * into m from public.machines where id = p_subject_id;
      f := (select name from public.organizations where id = m.owner_org_id);
      t := (select name from public.organizations where id = (p_params ->> 'to_org_id')::uuid);
    else
      select * into c from public.owner_corrections where id = p_subject_id;
      select * into m from public.machines where id = c.machine_id;
      f := (select name from public.organizations where id = c.from_org_id);
      t := (select name from public.organizations where id = c.to_org_id);
    end if;
    return case when en then format('I %s the correction of the registered owner of machine %s from %s to %s.',
                  case when p_action like 'propose%' then 'propose' else 'approve' end, app.format_reg_number(m.reg_number), f, t)
                else format('Jag %s rättelse av registrerad ägare för maskin %s från %s till %s.',
                  case when p_action like 'propose%' then 'föreslår' else 'godkänner' end, app.format_reg_number(m.reg_number), f, t) end;
  end if;
  perform app.raise('VALIDATION', jsonb_build_object('field', 'action'));
  return null;
end $$;

-- Wrap the step-5 text builder: unknown actions fall through to the extension point.
alter function app.signature_text(text, uuid, jsonb, text) rename to signature_text_core;
create or replace function app.signature_text(p_action text, p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if p_action in ('propose_owner_correction', 'approve_owner_correction') or p_action like 'x_%' then
    return app.signature_text_more(p_action, p_subject_id, p_params, p_locale);
  end if;
  return app.signature_text_core(p_action, p_subject_id, p_params, p_locale);
end $$;

-- ---------- Verification requests (SPEC §6.4) ----------
create or replace function app.verification_json(v public.verification_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'machine_id', v.machine_id, 'requested_level', v.requested_level, 'status', v.status,
    'reg_number', (select reg_number from public.machines where id = v.machine_id),
    'machine', (select jsonb_build_object('make', make, 'model', model, 'year', year, 'category', category, 'verification_level', verification_level)
                from public.machines where id = v.machine_id),
    'requested_by', app.org_brief(v.requested_by_org_id), 'reviewer', app.org_brief(v.reviewer_org_id),
    'document_ids', to_jsonb(v.document_ids), 'note', v.note, 'preferred_date', v.preferred_date, 'site_address', v.site_address,
    'nameplate_check', v.nameplate_check, 'decision_note', v.decision_note, 'decided_at', v.decided_at,
    'assigned_to', (select full_name from public.profiles where user_id = v.assigned_to_user_id), 'created_at', v.created_at)
$$;

-- Who may verify at which level (SPEC §2.6, §3.1, §18): level 1 – operator, approved dealer/inspector/financier;
-- level 2 – operator, approved dealer/inspector.
create or replace function app.can_verify(p_org_id uuid, p_level int)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_operator('verifier') or app.has_org_type(p_org_id, 'dealer') or app.has_org_type(p_org_id, 'inspector')
    or (p_level = 1 and app.has_org_type(p_org_id, 'financier'))
$$;

create or replace function public.request_verification(p_org_id uuid, p_machine_id uuid, p_level int, p_document_ids uuid[] default '{}',
  p_reviewer_org_id uuid default null, p_note text default null, p_preferred_date date default null, p_site_address text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; v public.verification_requests; types_ text[];
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if (m.owner_org_id = actor or m.user_org_id = actor) is not true then perform app.raise('FORBIDDEN'); end if;
  if m.status in ('draft', 'scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  if p_level not in (1, 2) or p_level <= m.verification_level then perform app.raise('VALIDATION', '{"field":"level"}'); end if;
  -- A partner reviewer must be another org of a type allowed to verify at that level (financiers only level 1).
  if p_reviewer_org_id is not null and (p_reviewer_org_id = actor or not (app.has_org_type(p_reviewer_org_id, 'dealer')
      or app.has_org_type(p_reviewer_org_id, 'inspector') or (p_level = 1 and app.has_org_type(p_reviewer_org_id, 'financier')))) then
    perform app.raise('VALIDATION', '{"field":"reviewer_org_id"}');
  end if;
  if p_level = 1 then
    -- Level 1 needs proof of acquisition plus a nameplate photo (SPEC §6.4).
    select array_agg(distinct d.type::text) into types_ from public.documents d
      where d.id = any (coalesce(p_document_ids, '{}')) and d.machine_id = m.id and d.archived_at is null;
    if not (coalesce(types_, '{}') && array['invoice', 'purchase_agreement', 'ownership_certificate'])
       or not ('photo_nameplate' = any (coalesce(types_, '{}'))) then
      perform app.raise('VALIDATION', '{"field":"documents","reason":"invoice_and_nameplate_photo_required"}');
    end if;
    -- Reviewers must be able to see the documents.
    update public.documents set visibility = 'verifiers' where id = any (p_document_ids) and visibility = 'owner';
  end if;
  insert into public.verification_requests (machine_id, requested_level, requested_by_org_id, requested_by_user_id, reviewer_org_id,
    document_ids, note, preferred_date, site_address)
  values (m.id, p_level, actor, auth.uid(), p_reviewer_org_id, coalesce(p_document_ids, '{}'), nullif(trim(p_note), ''), p_preferred_date,
    nullif(trim(p_site_address), ''))
  returning * into v;
  perform app.log_event('verification.requested', m.id, m.owner_org_id, actor,
    jsonb_build_object('request_id', v.id, 'level', p_level, 'reviewer_org_id', p_reviewer_org_id));
  if p_reviewer_org_id is not null then
    perform app.notify_org(p_reviewer_org_id, 'verification.requested', jsonb_build_object('request_id', v.id, 'reg_number', m.reg_number,
      'level', p_level, 'by', (select name from public.organizations where id = actor)), '/verify', 'info');
  else
    perform app.notify_operators('verification.requested', jsonb_build_object('request_id', v.id, 'reg_number', m.reg_number, 'level', p_level),
      '/admin/verifications', 'info');
  end if;
  return app.verification_json(v);
end $$;

create or replace function public.update_verification_request(p_org_id uuid, p_request_id uuid, p_document_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); v public.verification_requests;
begin
  select * into v from public.verification_requests where id = p_request_id for update;
  if v.id is null or v.requested_by_org_id <> actor then perform app.raise('NOT_FOUND'); end if;
  if v.status <> 'needs_info' then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.documents set visibility = 'verifiers' where id = any (p_document_ids) and visibility = 'owner' and machine_id = v.machine_id;
  update public.verification_requests set document_ids = (select array_agg(distinct x) from unnest(v.document_ids || coalesce(p_document_ids, '{}')) x),
    note = coalesce(nullif(trim(p_note), ''), note), status = 'open', assigned_to_user_id = null
  where id = v.id returning * into v;
  perform app.log_event('verification.updated', v.machine_id, actor, actor, jsonb_build_object('request_id', v.id));
  if v.reviewer_org_id is not null then
    perform app.notify_org(v.reviewer_org_id, 'verification.updated', jsonb_build_object('request_id', v.id), '/verify', 'info');
  else
    perform app.notify_operators('verification.updated', jsonb_build_object('request_id', v.id), '/admin/verifications', 'info');
  end if;
  return app.verification_json(v);
end $$;

create or replace function public.cancel_verification_request(p_org_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); v public.verification_requests;
begin
  update public.verification_requests set status = 'rejected', decision_note = 'cancelled_by_requester', decided_at = now()
  where id = p_request_id and requested_by_org_id = actor and status in ('open', 'needs_info') returning * into v;
  if v.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('verification.cancelled', v.machine_id, actor, actor, jsonb_build_object('request_id', v.id));
  return app.verification_json(v);
end $$;

-- Queue for a partner org (requests assigned to it) or the operator (all; SPEC §6.4 "Kö i operatörsadmin och hos
-- betrodda partner").
create or replace function public.list_verification_queue(p_org_id uuid, p_status public.verification_request_status default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); op boolean := app.is_operator() and app.has_org_type(p_org_id, 'operator');
begin
  return coalesce((select jsonb_agg(app.verification_json(v) order by v.created_at) from public.verification_requests v
    where (case when op then true else v.reviewer_org_id = actor end)
      and (case when p_status is null then v.status in ('open', 'in_review', 'needs_info') else v.status = p_status end)), '[]'::jsonb);
end $$;

create or replace function public.list_my_verification_requests(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.verification_json(v) order by v.created_at desc) from public.verification_requests v
    where v.requested_by_org_id = actor), '[]'::jsonb);
end $$;

create or replace function public.claim_verification(p_org_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); v public.verification_requests;
begin
  select * into v from public.verification_requests where id = p_request_id for update;
  if v.id is null then perform app.raise('NOT_FOUND'); end if;
  if ((v.reviewer_org_id = actor) or (v.reviewer_org_id is null and app.is_operator('verifier'))) is not true then perform app.raise('FORBIDDEN'); end if;
  if v.status not in ('open', 'in_review') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.verification_requests set status = 'in_review', assigned_to_user_id = auth.uid() where id = v.id returning * into v;
  return app.verification_json(v) || jsonb_build_object('machine_view', app.machine_view(v.machine_id, actor),
    'documents', coalesce((select jsonb_agg(app.document_json(d)) from public.documents d where d.id = any (v.document_ids)), '[]'::jsonb));
end $$;

-- Applies a verification level to the machine (shared by decide_verification and verify_on_site).
create or replace function app.apply_verification(p_machine_id uuid, p_level int, p_method public.verification_method, p_org uuid, p_extra jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.machines; ev public.events;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.verification_level >= p_level then return; end if;
  update public.machines set verification_level = p_level, verification_method = p_method, verified_by_org_id = p_org, verified_at = now()
  where id = m.id;
  ev := app.log_event('machine.verified', m.id, m.owner_org_id, p_org, jsonb_build_object('level', p_level, 'method', p_method) || coalesce(p_extra, '{}'));
  perform app.notify_org(m.owner_org_id, 'machine.verified', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'level', p_level,
    'by', (select name from public.organizations where id = p_org)), '/machines/' || m.id, 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'machine.verified', m.id, jsonb_build_object('level', p_level, 'method', p_method), ev.id);
end $$;

-- Level 2 requires the nameplate reading (OCR in the app) to match the registered serial/PIN (SPEC §6.4).
create or replace function app.nameplate_check(p_machine_id uuid, p_read_serial text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('read_serial', app.normalize_identifier(p_read_serial),
    'match', exists (select 1 from public.machine_identifiers i where i.machine_id = p_machine_id and i.type in ('pin', 'serial', 'vin')
                     and i.normalized_value = app.normalize_identifier(p_read_serial)))
$$;

create or replace function public.decide_verification(p_org_id uuid, p_request_id uuid, p_decision text, p_note text default null,
  p_nameplate_serial text default null, p_label_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); v public.verification_requests; m public.machines; chk jsonb; lbl jsonb;
begin
  select * into v from public.verification_requests where id = p_request_id for update;
  if v.id is null then perform app.raise('NOT_FOUND'); end if;
  if ((v.reviewer_org_id = actor) or (v.reviewer_org_id is null and app.is_operator('verifier'))) is not true then perform app.raise('FORBIDDEN'); end if;
  if not app.can_verify(actor, v.requested_level) then perform app.raise('FORBIDDEN', '{"reason":"level_not_allowed_for_org_type"}'); end if;
  if v.status not in ('open', 'in_review') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  if p_decision not in ('approved', 'rejected', 'needs_info') then perform app.raise('VALIDATION', '{"field":"decision"}'); end if;
  if p_decision <> 'approved' and nullif(trim(p_note), '') is null then perform app.raise('VALIDATION', '{"field":"note"}'); end if;
  select * into m from public.machines where id = v.machine_id;
  if p_decision = 'approved' and v.requested_level = 2 then
    chk := app.nameplate_check(m.id, p_nameplate_serial);
    if not (chk ->> 'match')::boolean then
      update public.verification_requests set nameplate_check = chk where id = v.id;
      perform app.raise('NAMEPLATE_MISMATCH', chk);
    end if;
    if nullif(p_label_code, '') is not null then
      lbl := public.bind_label(actor, m.id, p_label_code, 'primary');
      if not coalesce((lbl ->> 'ok')::boolean, false) then perform app.raise('LABEL_ALREADY_USED', lbl); end if;
    end if;
    update public.machine_identifiers set verified = true where machine_id = m.id and normalized_value = app.normalize_identifier(p_nameplate_serial);
  end if;
  update public.verification_requests set status = p_decision::public.verification_request_status, decision_note = nullif(trim(p_note), ''),
    decided_by_org_id = actor, decided_at = case when p_decision <> 'needs_info' then now() end, nameplate_check = coalesce(chk, nameplate_check),
    assigned_to_user_id = coalesce(assigned_to_user_id, auth.uid())
  where id = v.id returning * into v;
  if p_decision = 'approved' then
    perform app.apply_verification(m.id, v.requested_level, case when v.requested_level = 1 then 'documents' else 'physical' end::public.verification_method,
      actor, jsonb_build_object('request_id', v.id));
  else
    perform app.log_event('verification.' || p_decision, m.id, m.owner_org_id, actor, jsonb_build_object('request_id', v.id));
    perform app.notify_org(v.requested_by_org_id, 'verification.' || p_decision, jsonb_build_object('request_id', v.id, 'reg_number', m.reg_number,
      'note', v.decision_note), '/machines/' || m.id, 'warning');
  end if;
  return app.verification_json(v);
end $$;

-- On-site physical verification by a dealer/inspector without a prior request (e.g. at trade-in, SPEC §7.2).
create or replace function public.verify_on_site(p_org_id uuid, p_machine_id uuid, p_nameplate_serial text, p_label_code text default null,
  p_photo_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; chk jsonb; lbl jsonb;
begin
  if not app.can_verify(actor, 2) then perform app.raise('FORBIDDEN'); end if;
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status in ('draft', 'scrapped', 'exported', 'deregistered') then perform app.raise('NOT_FOUND'); end if;
  if not (app.machine_relations(m.id, array[actor]) && array['owner', 'transfer_party', 'inspector_assigned', 'registered_by', 'operator']) then
    -- A partner must have a reason to be at the machine: own stock, a trade-in, an assigned request.
    perform app.raise('FORBIDDEN');
  end if;
  chk := app.nameplate_check(m.id, p_nameplate_serial);
  if not (chk ->> 'match')::boolean then perform app.raise('NAMEPLATE_MISMATCH', chk); end if;
  if nullif(p_label_code, '') is not null then
    lbl := public.bind_label(actor, m.id, p_label_code, 'primary');
    if not coalesce((lbl ->> 'ok')::boolean, false) then perform app.raise('LABEL_ALREADY_USED', lbl); end if;
  end if;
  update public.machine_identifiers set verified = true where machine_id = m.id and normalized_value = app.normalize_identifier(p_nameplate_serial);
  perform app.apply_verification(m.id, 2, 'physical', actor, jsonb_build_object('on_site', true, 'photo_document_id', p_photo_document_id));
  update public.verification_requests set status = 'approved', decided_at = now(), decided_by_org_id = actor, decision_note = 'on_site'
  where machine_id = m.id and status in ('open', 'in_review', 'needs_info');
  return app.machine_view(m.id, actor);
end $$;

-- Partners offering verification near a city ("Boka verifiering", no map integration in v1).
create or replace function public.list_verification_partners(p_level int default 2, p_city text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  return coalesce((select jsonb_agg(app.org_brief(o.id) || jsonb_build_object('address', o.address, 'phone', o.phone, 'email', o.email)
      order by (o.city ilike coalesce(p_city, '')) desc, o.name)
    from public.organizations o where o.status = 'approved'
      and o.types && (case when p_level = 1 then array['dealer', 'inspector', 'financier'] else array['dealer', 'inspector'] end)::public.org_type[]
      and coalesce((o.settings ->> 'partner_verification')::boolean, true)), '[]'::jsonb);
end $$;

-- ---------- Conflicts (SPEC §4.4, operator queue) ----------
create or replace function app.conflict_json(c public.conflicts)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'type', c.type, 'status', c.status, 'details', c.details, 'created_at', c.created_at,
    'resolved_at', c.resolved_at, 'resolution_note', c.resolution_note,
    'machine', (select jsonb_build_object('id', id, 'reg_number', reg_number, 'status', status, 'owner', app.org_brief(owner_org_id), 'make', make, 'model', model)
                from public.machines where id = c.machine_id),
    'related_machine', (select jsonb_build_object('id', id, 'reg_number', reg_number, 'status', status, 'owner', app.org_brief(owner_org_id), 'make', make, 'model', model)
                from public.machines where id = c.related_machine_id),
    'involved', (select coalesce(jsonb_agg(app.org_brief(x)), '[]'::jsonb) from unnest(c.involved_org_ids) x))
$$;

create or replace function public.list_conflicts(p_status public.conflict_status default 'open', p_type public.conflict_type default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return coalesce((select jsonb_agg(app.conflict_json(c) order by c.created_at) from public.conflicts c
    where (p_status is null or c.status = p_status) and (p_type is null or c.type = p_type)), '[]'::jsonb);
end $$;

create or replace function public.list_my_conflicts(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.conflict_json(c) order by c.created_at desc) from public.conflicts c
    where actor = any (c.involved_org_ids) and c.status = 'open'), '[]'::jsonb);
end $$;

-- Resolutions: duplicate_identifier → keep_existing (new machine deregistered as misregistered) | keep_new (existing
-- deregistered, the new machine takes the unique slot) | dismiss (both stay, new without unique slot);
-- other types → resolved | dismiss (with a note; any register change is done with the ordinary RPCs).
create or replace function public.resolve_conflict(p_conflict_id uuid, p_resolution text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); c public.conflicts; keep_id uuid; drop_id uuid;
begin
  select * into c from public.conflicts where id = p_conflict_id for update;
  if c.id is null then perform app.raise('NOT_FOUND'); end if;
  if c.status <> 'open' then perform app.raise('CONFLICT_NOT_OPEN'); end if;
  if nullif(trim(p_note), '') is null then perform app.raise('VALIDATION', '{"field":"note"}'); end if;
  if c.type = 'duplicate_identifier' and p_resolution in ('keep_existing', 'keep_new') then
    drop_id := case when p_resolution = 'keep_existing' then c.machine_id else c.related_machine_id end;
    keep_id := case when p_resolution = 'keep_existing' then c.related_machine_id else c.machine_id end;
    update public.machines set status = 'deregistered', deregistration_reason = 'misregistered', deregistered_at = now() where id = drop_id;
    update public.labels set status = 'revoked', revoked_at = now(), revoked_reason = 'conflict_resolution' where machine_id = drop_id and status = 'bound';
    perform app.log_event('machine.deregistered', drop_id, (select owner_org_id from public.machines where id = drop_id), op,
      jsonb_build_object('reason', 'misregistered', 'conflict_id', c.id));
    update public.machine_identifiers set conflict_id = null where machine_id = keep_id and conflict_id = c.id;
  elsif p_resolution not in ('resolved', 'dismiss') then
    perform app.raise('VALIDATION', '{"field":"resolution"}');
  end if;
  update public.conflicts set status = case when p_resolution = 'dismiss' then 'dismissed' else 'resolved' end::public.conflict_status,
    resolved_by_user_id = auth.uid(), resolution_note = trim(p_note), resolved_at = now() where id = c.id returning * into c;
  if c.machine_id is not null then perform app.recompute_machine_status(c.machine_id); end if;
  if c.related_machine_id is not null then perform app.recompute_machine_status(c.related_machine_id); end if;
  perform app.log_event('conflict.resolved', c.machine_id, null, op, jsonb_build_object('conflict_id', c.id, 'type', c.type, 'resolution', p_resolution));
  perform app.notify_org(x, 'conflict.resolved', jsonb_build_object('conflict_id', c.id, 'type', c.type, 'resolution', p_resolution), '/inbox', 'info')
    from unnest(c.involved_org_ids) x;
  return app.conflict_json(c);
end $$;

-- A party reports an ownership dispute (e.g. the machine is registered to someone else).
create or replace function public.report_ownership_dispute(p_org_id uuid, p_machine_id uuid, p_description text, p_document_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; c uuid;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if nullif(trim(p_description), '') is null then perform app.raise('VALIDATION', '{"field":"description"}'); end if;
  if not app.rate_limit_hit('dispute:' || actor, 10, interval '1 day') then perform app.raise('RATE_LIMITED'); end if;
  insert into public.conflicts (type, machine_id, involved_org_ids, details)
  values ('ownership_dispute', m.id, array[actor, m.owner_org_id], jsonb_build_object('description', left(p_description, 2000),
    'reported_by_org_id', actor, 'document_ids', p_document_ids)) returning id into c;
  perform app.log_event('conflict.created', m.id, m.owner_org_id, actor, jsonb_build_object('conflict_id', c, 'type', 'ownership_dispute'));
  perform app.notify_operators('conflict.created', jsonb_build_object('conflict_id', c, 'type', 'ownership_dispute'), '/admin/conflicts', 'warning');
  perform app.notify_org(m.owner_org_id, 'conflict.ownership_dispute', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
    'by', (select name from public.organizations where id = actor)), '/machines/' || m.id, 'warning');
  return jsonb_build_object('ok', true, 'conflict_id', c);
end $$;

-- ---------- Owner correction: four eyes + right to object (SPEC §11.4, §11.7) ----------
create or replace function public.propose_owner_correction(p_machine_id uuid, p_to_org_id uuid, p_reason text, p_obvious_typo boolean default false,
  p_signature_id uuid default null, p_conflict_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); m public.machines; c public.owner_corrections; sig uuid;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_to_org_id = m.owner_org_id or not exists (select 1 from public.organizations where id = p_to_org_id) then
    perform app.raise('VALIDATION', '{"field":"to_org_id"}');
  end if;
  if nullif(trim(p_reason), '') is null then perform app.raise('VALIDATION', '{"field":"reason"}'); end if;
  sig := app.consume_signature(p_signature_id, 'propose_owner_correction', m.id, jsonb_build_object('to_org_id', p_to_org_id));
  insert into public.owner_corrections (machine_id, from_org_id, to_org_id, reason, obvious_typo, conflict_id, proposed_by_user_id, proposed_signature_id)
  values (m.id, m.owner_org_id, p_to_org_id, trim(p_reason), coalesce(p_obvious_typo, false), p_conflict_id, auth.uid(), sig) returning * into c;
  perform app.log_event('correction.proposed', m.id, m.owner_org_id, op, jsonb_build_object('correction_id', c.id, 'to_org_id', p_to_org_id,
    'obvious_typo', c.obvious_typo));
  perform app.notify_operators('correction.needs_second_approval', jsonb_build_object('correction_id', c.id, 'reg_number', m.reg_number),
    '/admin/corrections', 'warning');
  return to_jsonb(c);
end $$;

create or replace function public.approve_owner_correction(p_correction_id uuid, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); c public.owner_corrections; m public.machines; sig uuid;
begin
  select * into c from public.owner_corrections where id = p_correction_id for update;
  if c.id is null or c.status <> 'proposed' then perform app.raise('NOT_FOUND'); end if;
  if c.proposed_by_user_id = auth.uid() then perform app.raise('FOUR_EYES_REQUIRED'); end if;
  sig := app.consume_signature(p_signature_id, 'approve_owner_correction', c.id);
  select * into m from public.machines where id = c.machine_id for update;
  if c.obvious_typo then
    update public.owner_corrections set approved_by_user_id = auth.uid(), approved_signature_id = sig where id = c.id;
    return app.apply_owner_correction(c.id);
  end if;
  -- The affected org gets 14 days to object; the machine is disputed meanwhile.
  update public.owner_corrections set approved_by_user_id = auth.uid(), approved_signature_id = sig, status = 'objection_period',
    effective_after = now() + interval '14 days' where id = c.id returning * into c;
  update public.machines set status = 'disputed' where id = m.id and status = 'active';
  perform app.log_event('correction.approved', m.id, m.owner_org_id, op, jsonb_build_object('correction_id', c.id, 'effective_after', c.effective_after));
  perform app.notify_org(c.from_org_id, 'correction.objection_period', jsonb_build_object('correction_id', c.id, 'reg_number', m.reg_number,
    'effective_after', c.effective_after, 'to', (select name from public.organizations where id = c.to_org_id)), '/inbox', 'critical');
  perform app.notify_org(c.to_org_id, 'correction.pending', jsonb_build_object('correction_id', c.id, 'reg_number', m.reg_number,
    'effective_after', c.effective_after), '/inbox', 'info');
  return to_jsonb(c);
end $$;

create or replace function public.object_owner_correction(p_org_id uuid, p_correction_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); c public.owner_corrections;
begin
  select * into c from public.owner_corrections where id = p_correction_id for update;
  if c.id is null or c.from_org_id <> actor or c.status <> 'objection_period' then perform app.raise('NOT_FOUND'); end if;
  if nullif(trim(p_note), '') is null then perform app.raise('VALIDATION', '{"field":"note"}'); end if;
  update public.owner_corrections set status = 'objected', objection_note = trim(p_note) where id = c.id returning * into c;
  perform app.log_event('correction.objected', c.machine_id, c.from_org_id, actor, jsonb_build_object('correction_id', c.id));
  perform app.notify_operators('correction.objected', jsonb_build_object('correction_id', c.id), '/admin/corrections', 'warning');
  return to_jsonb(c);
end $$;

create or replace function public.cancel_owner_correction(p_correction_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); c public.owner_corrections;
begin
  update public.owner_corrections set status = 'cancelled', objection_note = coalesce(objection_note, '') || ' ' || coalesce(p_note, '')
  where id = p_correction_id and status in ('proposed', 'objection_period', 'objected') returning * into c;
  if c.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.recompute_machine_status(c.machine_id);
  perform app.log_event('correction.cancelled', c.machine_id, c.from_org_id, op, jsonb_build_object('correction_id', c.id));
  return to_jsonb(c);
end $$;

create or replace function app.apply_owner_correction(p_correction_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.owner_corrections;
begin
  select * into c from public.owner_corrections where id = p_correction_id for update;
  update public.ownerships set to_date = current_date where machine_id = c.machine_id and to_date is null;
  insert into public.ownerships (machine_id, owner_org_id, from_date, acquired_via) values (c.machine_id, c.to_org_id, current_date, 'correction');
  update public.machines set owner_org_id = c.to_org_id, stock_status = null where id = c.machine_id;
  update public.owner_corrections set status = 'applied', applied_at = now() where id = c.id returning * into c;
  perform app.recompute_machine_status(c.machine_id);
  perform app.log_event('ownership.corrected', c.machine_id, c.to_org_id, app.operator_org_id(), jsonb_build_object('correction_id', c.id,
    'from_org_id', c.from_org_id, 'to_org_id', c.to_org_id, 'obvious_typo', c.obvious_typo, 'reason', c.reason));
  perform app.notify_org(c.from_org_id, 'correction.applied', jsonb_build_object('correction_id', c.id), '/machines/' || c.machine_id, 'warning');
  perform app.notify_org(c.to_org_id, 'correction.applied', jsonb_build_object('correction_id', c.id), '/machines/' || c.machine_id, 'info');
  return to_jsonb(c);
end $$;

-- Job: apply corrections whose objection period passed without objection.
create or replace function app.apply_due_corrections()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.owner_corrections where status = 'objection_period' and effective_after <= now() loop
    perform app.apply_owner_correction(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.list_owner_corrections(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('reg_number', (select reg_number from public.machines where id = c.machine_id),
      'from', app.org_brief(c.from_org_id), 'to', app.org_brief(c.to_org_id)) order by c.created_at desc)
    from public.owner_corrections c where p_status is null or c.status = p_status), '[]'::jsonb);
end $$;

-- ---------- Inbox: "Väntar på mig" (SPEC §9.2) ----------
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
  -- Invitations for the user (not org-bound)
  items := items || coalesce((select jsonb_agg(jsonb_build_object('kind', 'invitation', 'id', m.id, 'created_at', m.created_at, 'org', app.org_brief(m.org_id), 'role', m.role))
    from public.memberships m where m.status = 'invited' and lower(m.invite_email) = me and (m.invite_expires_at is null or m.invite_expires_at > now())), '[]'::jsonb);
  return jsonb_build_object('count', jsonb_array_length(items),
    'items', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from jsonb_array_elements(items) x), '[]'::jsonb));
end $$;

-- ---------- Fix: NULL-safe authorisation in get_transfer (an e-mail transfer has no to_org_id) ----------
create or replace function public.get_transfer(p_org_id uuid, p_transfer_id uuid, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); t public.transfers; e public.encumbrances; m public.machines;
begin
  select * into t from public.transfers where id = p_transfer_id;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into e from public.encumbrances where id = t.existing_encumbrance_id;
  if (t.from_org_id = actor or t.to_org_id = actor or t.initiated_by_org_id = actor or e.holder_org_id = actor or app.is_operator()
          or app.acts_as('authority') or (p_token is not null and t.invite_token_hash = app.sha256_hex(p_token))) is not true then
    perform app.raise('NOT_FOUND');
  end if;
  select * into m from public.machines where id = t.machine_id;
  -- The buyer sees the machine card, history summary and financing before signing (SPEC §6.7 step 3).
  return app.transfer_json(t) || jsonb_build_object('machine', app.machine_base_json(m)
    || jsonb_build_object('identifiers', (select jsonb_agg(jsonb_build_object('type', type, 'value', value)) from public.machine_identifiers where machine_id = m.id),
       'flags', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'status', status)), '[]') from public.flags where machine_id = m.id and status = 'active'),
       'owner_ordinal', (select count(*) from public.ownerships where machine_id = m.id)));
end $$;


-- ---------- RLS ----------
alter table public.verification_requests enable row level security;
alter table public.owner_corrections enable row level security;
revoke all on public.verification_requests, public.owner_corrections from anon, authenticated;
grant select on public.verification_requests, public.owner_corrections to authenticated;
create policy verification_requests_read on public.verification_requests for select to authenticated using (
  requested_by_org_id = any (app.current_org_ids()) or reviewer_org_id = any (app.current_org_ids()) or app.is_operator()
);
create policy owner_corrections_read on public.owner_corrections for select to authenticated using (
  from_org_id = any (app.current_org_ids()) or to_org_id = any (app.current_org_ids()) or app.is_operator()
);

grant execute on function
  public.request_verification(uuid, uuid, int, uuid[], uuid, text, date, text), public.update_verification_request(uuid, uuid, uuid[], text),
  public.cancel_verification_request(uuid, uuid), public.list_verification_queue(uuid, public.verification_request_status),
  public.list_my_verification_requests(uuid), public.claim_verification(uuid, uuid),
  public.decide_verification(uuid, uuid, text, text, text, text), public.verify_on_site(uuid, uuid, text, text, uuid),
  public.list_verification_partners(int, text), public.list_conflicts(public.conflict_status, public.conflict_type),
  public.list_my_conflicts(uuid), public.resolve_conflict(uuid, text, text), public.report_ownership_dispute(uuid, uuid, text, uuid[]),
  public.propose_owner_correction(uuid, uuid, text, boolean, uuid, uuid), public.approve_owner_correction(uuid, uuid),
  public.object_owner_correction(uuid, uuid, text), public.cancel_owner_correction(uuid, text), public.list_owner_corrections(text),
  public.get_inbox(uuid)
  to authenticated;
