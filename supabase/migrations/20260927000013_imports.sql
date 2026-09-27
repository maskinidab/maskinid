-- Step 11: bulk import (SPEC §6.5). The browser parses CSV/XLSX and sends the rows with the chosen column mapping;
-- the database validates every row (required fields, duplicates in the file and against the register, org number
-- format, encumbrance rules), the user previews, and import_commit creates the machines in one transaction per row.

create table public.imports (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id),
  created_by_user_id uuid not null,
  filename           text not null check (length(filename) <= 255),
  file_path          text,
  status             text not null default 'uploaded' check (status in ('uploaded', 'mapped', 'validated', 'committed', 'failed')),
  mapping            jsonb not null default '{}'::jsonb,
  with_encumbrances  boolean not null default false,
  rows_total         int not null default 0,
  rows_ok            int not null default 0,
  rows_error         int not null default 0,
  rows_committed     int not null default 0,
  created_at         timestamptz not null default now(),
  committed_at       timestamptz
);
create index imports_org_idx on public.imports (org_id, created_at desc);

create table public.import_rows (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references public.imports (id) on delete cascade,
  row_no      int not null,
  data        jsonb not null,
  errors      jsonb not null default '[]'::jsonb,
  machine_id  uuid references public.machines (id),
  action      text check (action in ('create', 'encumber_existing')),
  status      text not null default 'pending' check (status in ('pending', 'ok', 'error', 'skipped', 'committed')),
  unique (import_id, row_no)
);

alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
revoke all on public.imports, public.import_rows from anon, authenticated;
grant select on public.imports, public.import_rows to authenticated;
create policy imports_read on public.imports for select to authenticated using (org_id = any (app.current_org_ids()) or app.is_operator());
create policy import_rows_read on public.import_rows for select to authenticated using (
  exists (select 1 from public.imports i where i.id = import_rows.import_id and (i.org_id = any (app.current_org_ids()) or app.is_operator())));

-- Free-text category (Swedish/English label, enum key or common synonym) → machine_category.
create or replace function app.category_from_text(p text)
returns public.machine_category language plpgsql immutable set search_path = '' as $$
declare v text := lower(trim(coalesce(p, '')));
begin
  if v = '' then return null; end if;
  if v in (select unnest(enum_range(null::public.machine_category))::text) then return v::public.machine_category; end if;
  v := translate(v, 'åäö', 'aao');
  return case
    when v ~ '(hjulgrav|grav.*hjul|wheeled excavator)' then 'excavator_wheeled'
    when v ~ '(minigrav|bandgrav|gravmaskin|gravare|excavator|grav)' then 'excavator_tracked'
    when v ~ '(hjullast|wheel loader|lastmaskin|lastare)' and v !~ 'teleskop' then 'wheel_loader'
    when v ~ '(traktorgrav|backhoe)' then 'backhoe'
    when v ~ '(dumper|dumpers|articulated hauler)' then 'dumper'
    when v ~ '(bandschakt|dozer|bulldozer)' then 'dozer'
    when v ~ '(vaghyvel|grader)' then 'grader'
    when v ~ '(valt|roller)' then 'roller'
    when v ~ '(asfalt|paver)' then 'paver'
    when v ~ '(teleskop|telehandler)' then 'telehandler'
    when v ~ '(truck|forklift|gaffel)' then 'forklift'
    when v ~ '(kran|crane)' then 'crane_mobile'
    when v ~ '(borr|drill)' then 'drill_rig'
    when v ~ '(kross|crusher)' then 'crusher'
    when v ~ '(sikt|screen)' then 'screener'
    when v ~ '(kompressor|compressor)' then 'compressor'
    when v ~ '(elverk|generator)' then 'generator'
    when v ~ '(skordare|harvester)' then 'forestry_harvester'
    when v ~ '(skotare|forwarder)' then 'forestry_forwarder'
    when v ~ '(skidder)' then 'skidder'
    when v ~ '(traktor|tractor)' then 'tractor'
    when v ~ '(slap|trailer)' then 'trailer_heavy'
    when v ~ '(redskap|attachment|skopa|bucket)' then 'attachment'
    when v ~ '(ovrig|other)' then 'other'
    else null end::public.machine_category;
end $$;

create or replace function app.encumbrance_type_from_text(p text)
returns public.encumbrance_type language sql immutable set search_path = '' as $$
  select case
    when p is null or trim(p) = '' then null
    when lower(trim(p)) in ('ownership_reservation', 'äganderättsförbehåll', 'aganderattsforbehall', 'avbetalning', 'kreditköp', 'kreditkop', 'retention of title') then 'ownership_reservation'
    when lower(trim(p)) in ('leasing', 'lease', 'finansiell leasing', 'operationell leasing') then 'leasing'
    when lower(trim(p)) in ('rental', 'hyra', 'uthyrning') then 'rental'
    when lower(trim(p)) in ('other', 'annan', 'övrigt', 'ovrigt') then 'other'
    else null end::public.encumbrance_type
$$;

-- Maps one raw row with the mapping and validates it. Returns {data, errors[], action, machine_id}.
create or replace function app.import_prepare_row(p_actor uuid, p_raw jsonb, p_mapping jsonb, p_financier boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  get text; d jsonb := '{}'::jsonb; errs jsonb := '[]'::jsonb; k text; col text; v text;
  cat public.machine_category; mm public.machine_models; y int; ids jsonb := '[]'::jsonb; typ text; existing public.machines;
  fin public.encumbrances; et public.encumbrance_type; action text := 'create'; sd date; ed date;
begin
  for k, col in select key, value #>> '{}' from jsonb_each(coalesce(p_mapping, '{}'::jsonb)) loop
    if col is not null and col <> '' then
      v := nullif(trim(p_raw ->> col), '');
      if v is not null then d := d || jsonb_build_object(k, v); end if;
    end if;
  end loop;
  -- Identifiers: at least one of PIN / serial / VIN.
  foreach typ in array array['pin', 'serial', 'vin', 'road_reg'] loop
    if d ? typ then
      if app.normalize_identifier(d ->> typ) is null or length(app.normalize_identifier(d ->> typ)) < 3 or length(d ->> typ) > 64 then
        errs := errs || jsonb_build_object('field', typ, 'code', 'invalid');
      elsif typ = 'road_reg' and app.normalize_identifier(d ->> typ) !~ '^[A-Z]{3}[0-9]{2}[0-9A-Z]$' then
        errs := errs || jsonb_build_object('field', typ, 'code', 'invalid');
      else
        ids := ids || jsonb_build_object('type', typ, 'value', d ->> typ, 'source', 'manual');
      end if;
    end if;
  end loop;
  if not (d ? 'pin' or d ? 'serial' or d ? 'vin') then errs := errs || jsonb_build_object('field', 'serial', 'code', 'required'); end if;

  -- Existing machine in the register with the same PIN/serial/VIN.
  select m.* into existing from public.machine_identifiers x join public.machines m on m.id = x.machine_id
    where x.unique_active and x.type::text in ('pin', 'serial', 'vin')
      and (x.type::text, x.normalized_value) in (select e ->> 'type', app.normalize_identifier(e ->> 'value') from jsonb_array_elements(ids) e)
    limit 1;

  if existing.id is not null then
    if p_financier and d ? 'contract_ref' or p_financier and d ? 'encumbrance_type' then
      -- A financier importing its portfolio attaches the encumbrance to the machine that is already registered.
      action := 'encumber_existing';
      fin := app.active_financing(existing.id);
      if fin.id is not null and fin.holder_org_id <> p_actor then
        errs := errs || jsonb_build_object('field', 'serial', 'code', 'active_encumbrance_exists', 'reg_number', existing.reg_number);
      elsif fin.id is not null then
        errs := errs || jsonb_build_object('field', 'serial', 'code', 'already_encumbered_by_you', 'reg_number', existing.reg_number);
      end if;
      if existing.status in ('stolen', 'blocked', 'scrapped', 'exported', 'deregistered') then
        errs := errs || jsonb_build_object('field', 'serial', 'code', 'machine_' || existing.status, 'reg_number', existing.reg_number);
      end if;
    else
      errs := errs || jsonb_build_object('field', 'serial', 'code', 'duplicate_in_register', 'reg_number', existing.reg_number);
    end if;
  end if;

  if action = 'create' then
    -- Make/model/category; the model catalogue fills the category when the column is empty (an unknown value is an error).
    if not (d ? 'make') then errs := errs || jsonb_build_object('field', 'make', 'code', 'required'); end if;
    if not (d ? 'model') then errs := errs || jsonb_build_object('field', 'model', 'code', 'required'); end if;
    cat := app.category_from_text(d ->> 'category');
    if cat is null and not (d ? 'category') and d ? 'make' and d ? 'model' then
      select * into mm from public.machine_models where lower(make) = lower(d ->> 'make') and lower(model) = lower(d ->> 'model') limit 1;
      cat := mm.category;
      if mm.id is not null then d := d || jsonb_build_object('model_id', mm.id); end if;
    end if;
    if cat is null then errs := errs || jsonb_build_object('field', 'category', 'code', case when d ? 'category' then 'unknown' else 'required' end);
    else d := d || jsonb_build_object('category', cat); end if;
    if d ? 'year' then
      y := case when d ->> 'year' ~ '^\d{4}$' then (d ->> 'year')::int end;
      if y is null or y < 1950 or y > extract(year from current_date)::int + 1 then errs := errs || jsonb_build_object('field', 'year', 'code', 'invalid'); end if;
    end if;
    if d ? 'hour_meter' and replace(d ->> 'hour_meter', ' ', '') !~ '^\d{1,7}$' then
      errs := errs || jsonb_build_object('field', 'hour_meter', 'code', 'invalid');
    elsif d ? 'hour_meter' then d := d || jsonb_build_object('hour_meter', replace(d ->> 'hour_meter', ' ', ''));
    end if;
    if d ? 'owner_org_number' and app.normalize_org_number(d ->> 'owner_org_number') is null then
      errs := errs || jsonb_build_object('field', 'owner_org_number', 'code', 'invalid');
    end if;
    if p_financier and not (d ? 'owner_org_number') then
      errs := errs || jsonb_build_object('field', 'owner_org_number', 'code', 'required');
    end if;
  end if;

  -- Financier portfolio: encumbrance columns (no amounts, ever).
  if p_financier and (d ? 'contract_ref' or d ? 'encumbrance_type' or d ? 'start_date' or d ? 'end_date') then
    et := coalesce(app.encumbrance_type_from_text(d ->> 'encumbrance_type'),
      case when d ? 'encumbrance_type' then null else 'ownership_reservation'::public.encumbrance_type end);
    if et is null then errs := errs || jsonb_build_object('field', 'encumbrance_type', 'code', 'unknown'); end if;
    begin
      sd := coalesce((d ->> 'start_date')::date, current_date);
    exception when others then errs := errs || jsonb_build_object('field', 'start_date', 'code', 'invalid');
    end;
    begin
      ed := (d ->> 'end_date')::date;
    exception when others then errs := errs || jsonb_build_object('field', 'end_date', 'code', 'invalid');
    end;
    if et = 'ownership_reservation' and ed is null and not (errs @> '[{"field":"end_date"}]') then
      errs := errs || jsonb_build_object('field', 'end_date', 'code', 'required_for_ownership_reservation');
    end if;
    if ed is not null and sd is not null and ed < sd then errs := errs || jsonb_build_object('field', 'end_date', 'code', 'before_start'); end if;
    d := d || jsonb_build_object('encumbrance', jsonb_strip_nulls(jsonb_build_object('type', et, 'contract_ref', d ->> 'contract_ref',
      'start_date', sd, 'end_date', ed)));
  end if;

  return jsonb_build_object('data', d || jsonb_build_object('identifiers', ids), 'errors', errs, 'action', action,
    'machine_id', existing.id);
end $$;

-- Creates an import from parsed rows (max 5000) and validates it. Rows are raw objects keyed by the file's headers.
create or replace function public.create_import(p_org_id uuid, p_filename text, p_mapping jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); imp public.imports; r jsonb; n int := 0; prep jsonb; fin boolean;
  errs jsonb; key text; seen jsonb := '{}'::jsonb; ident jsonb;
begin
  perform app.require_scope('machines:write');
  if not app.can_register(actor) then perform app.raise('FORBIDDEN'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then perform app.raise('VALIDATION', '{"field":"rows"}'); end if;
  if jsonb_array_length(p_rows) > 5000 then perform app.raise('VALIDATION', '{"field":"rows","max":5000}'); end if;
  if jsonb_typeof(coalesce(p_mapping, '{}'::jsonb)) <> 'object' then perform app.raise('VALIDATION', '{"field":"mapping"}'); end if;
  fin := app.has_org_type(actor, 'financier');
  insert into public.imports (org_id, created_by_user_id, filename, mapping, status, rows_total)
  values (actor, auth.uid(), left(coalesce(nullif(trim(p_filename), ''), 'import.csv'), 255), coalesce(p_mapping, '{}'::jsonb), 'mapped',
          jsonb_array_length(p_rows))
  returning * into imp;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    prep := app.import_prepare_row(actor, r, p_mapping, fin);
    errs := prep -> 'errors';
    -- Duplicates within the file.
    for ident in select * from jsonb_array_elements(prep -> 'data' -> 'identifiers') loop
      if ident ->> 'type' in ('pin', 'serial', 'vin') then
        key := (ident ->> 'type') || ':' || app.normalize_identifier(ident ->> 'value');
        if seen ? key then
          errs := errs || jsonb_build_object('field', ident ->> 'type', 'code', 'duplicate_in_file', 'row_no', (seen ->> key)::int);
        else
          seen := seen || jsonb_build_object(key, n);
        end if;
      end if;
    end loop;
    insert into public.import_rows (import_id, row_no, data, errors, machine_id, action, status)
    values (imp.id, n, prep -> 'data', errs, (prep ->> 'machine_id')::uuid, prep ->> 'action',
            case when jsonb_array_length(errs) = 0 then 'ok' else 'error' end);
  end loop;
  update public.imports set status = 'validated',
    rows_ok = (select count(*) from public.import_rows where import_id = imp.id and status = 'ok'),
    rows_error = (select count(*) from public.import_rows where import_id = imp.id and status = 'error'),
    with_encumbrances = exists (select 1 from public.import_rows where import_id = imp.id and data ? 'encumbrance')
  where id = imp.id returning * into imp;
  return app.import_json(imp, true);
end $$;

create or replace function app.import_json(i public.imports, p_rows boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'filename', i.filename, 'status', i.status, 'mapping', i.mapping,
    'with_encumbrances', i.with_encumbrances, 'encumbrance_rows', (select count(*) from public.import_rows r where r.import_id = i.id and r.status = 'ok' and r.data ? 'encumbrance'),
    'rows_total', i.rows_total, 'rows_ok', i.rows_ok, 'rows_error', i.rows_error, 'rows_committed', i.rows_committed,
    'created_at', i.created_at, 'committed_at', i.committed_at)
    || case when p_rows then jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('row_no', r.row_no, 'data', r.data - 'identifiers',
         'identifiers', r.data -> 'identifiers', 'errors', r.errors, 'status', r.status, 'action', r.action, 'machine_id', r.machine_id,
         'reg_number', (select reg_number from public.machines where id = r.machine_id)) order by r.row_no)
       from public.import_rows r where r.import_id = i.id), '[]'::jsonb)) else '{}'::jsonb end
$$;

create or replace function public.get_import(p_org_id uuid, p_import_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); i public.imports;
begin
  select * into i from public.imports where id = p_import_id and (org_id = actor or app.is_operator());
  if i.id is null then perform app.raise('NOT_FOUND'); end if;
  return app.import_json(i, true);
end $$;

create or replace function public.list_imports(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.import_json(i) order by i.created_at desc) from public.imports i where i.org_id = actor), '[]'::jsonb);
end $$;

-- Commits the valid rows. With financier encumbrances one signature covers the whole batch (ADR 0012).
create or replace function public.import_commit(p_org_id uuid, p_import_id uuid, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); i public.imports; r public.import_rows; res jsonb; mid uuid; sig uuid;
  n_ok int := 0; n_err int := 0; n_enc int; e public.encumbrances; m public.machines; ev public.events; enc jsonb;
  fin public.encumbrances;
begin
  perform app.require_scope('machines:write');
  select * into i from public.imports where id = p_import_id and org_id = actor for update;
  if i.id is null then perform app.raise('NOT_FOUND'); end if;
  if i.status <> 'validated' then perform app.raise('IMPORT_NOT_VALIDATED', jsonb_build_object('status', i.status)); end if;
  n_enc := (select count(*) from public.import_rows where import_id = i.id and status = 'ok' and data ? 'encumbrance');
  if n_enc > 0 then
    if not app.has_org_type(actor, 'financier') then perform app.raise('FORBIDDEN'); end if;
    sig := app.consume_signature(p_signature_id, 'import_commit', i.id, jsonb_build_object('rows', i.rows_ok, 'encumbrances', n_enc), true);
  end if;
  for r in select * from public.import_rows where import_id = i.id and status = 'ok' order by row_no for update loop
    enc := r.data -> 'encumbrance';
    -- An existing machine may have been encumbered by someone else since validation: never overwrite, record the
    -- conflict (outside the row's subtransaction so it is kept) exactly like register_encumbrance.
    if r.action = 'encumber_existing' and enc is not null then
      fin := app.active_financing(r.machine_id);
      if fin.id is not null and (enc ->> 'type') in ('ownership_reservation', 'leasing') then
        perform app.encumbrance_conflict(r.machine_id, actor, fin, enc);
        update public.import_rows set status = 'error', errors = errors || '[{"field":"row","code":"ACTIVE_ENCUMBRANCE_EXISTS"}]'::jsonb where id = r.id;
        n_err := n_err + 1;
        continue;
      end if;
    end if;
    begin
      if r.action = 'encumber_existing' then
        mid := r.machine_id;
      else
        res := app.create_machine(actor, r.data - 'encumbrance', 'import');
        mid := (res ->> 'id')::uuid;
      end if;
      if enc is not null then
        select * into m from public.machines where id = mid for update;
        perform app.assert_not_blocked(m.id, 'register_encumbrance');
        insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
          requested_by_org_id, registered_by_user_id, signature_id, confirmed_at, notes)
        values (m.id, (enc ->> 'type')::public.encumbrance_type, actor, m.owner_org_id, enc ->> 'contract_ref',
          coalesce((enc ->> 'start_date')::date, current_date), (enc ->> 'end_date')::date, 'active', actor, auth.uid(), sig, now(), 'import')
        returning * into e;
        ev := app.log_event('encumbrance.registered', m.id, m.owner_org_id, actor, jsonb_build_object('encumbrance_id', e.id, 'type', e.type,
          'holder_org_id', actor, 'start_date', e.start_date, 'end_date', e.end_date, 'import_id', i.id));
        perform app.notify_org(m.owner_org_id, 'encumbrance.registered', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
          'holder', (select name from public.organizations where id = actor), 'type', e.type), '/machines/' || m.id, 'info');
        perform app.enqueue_webhook(m.owner_org_id, 'encumbrance.confirmed', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
        perform app.after_encumbrance_change(e.id);
      end if;
      update public.import_rows set status = 'committed', machine_id = mid where id = r.id;
      n_ok := n_ok + 1;
    exception when others then
      update public.import_rows set status = 'error', errors = errors || jsonb_build_array(jsonb_build_object('field', 'row', 'code', sqlerrm)) where id = r.id;
      n_err := n_err + 1;
    end;
  end loop;
  update public.import_rows set status = 'skipped' where import_id = i.id and status = 'error' and not (errors @> '[{"field":"row"}]');
  update public.imports set status = 'committed', committed_at = now(), rows_committed = n_ok,
    rows_error = (select count(*) from public.import_rows where import_id = i.id and status in ('error', 'skipped'))
  where id = i.id returning * into i;
  perform app.log_event('import.committed', null, actor, actor, jsonb_build_object('import_id', i.id, 'filename', i.filename,
    'rows_committed', n_ok, 'rows_failed', n_err, 'encumbrances', n_enc));
  return app.import_json(i, true);
end $$;

-- Signature text for the batch (dispatch by action name: app.sigtext_<action>).
create or replace function app.sigtext_import_commit(p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare i public.imports; org text;
begin
  select * into i from public.imports where id = p_subject_id;
  if i.id is null then perform app.raise('NOT_FOUND'); end if;
  org := (select name from public.organizations where id = i.org_id);
  return case when p_locale = 'en'
    then format('I import %s machines from %s for %s and register %s encumbrances held by %s.', p_params ->> 'rows', i.filename, org, p_params ->> 'encumbrances', org)
    else format('Jag importerar %s maskiner från %s för %s och registrerar %s förbehåll med %s som innehavare.', p_params ->> 'rows', i.filename, org, p_params ->> 'encumbrances', org) end;
end $$;

-- Signature texts for new actions live in app.sigtext_<action>(subject, params, locale); earlier ones keep their paths.
create or replace function app.signature_text(p_action text, p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare t text;
begin
  if p_action ~ '^[a-z_]+$' and to_regprocedure('app.sigtext_' || p_action || '(uuid,jsonb,text)') is not null then
    execute format('select app.%I($1, $2, $3)', 'sigtext_' || p_action) into t using p_subject_id, p_params, p_locale;
    return t;
  end if;
  if p_action in ('propose_owner_correction', 'approve_owner_correction') or p_action like 'x_%' then
    return app.signature_text_more(p_action, p_subject_id, p_params, p_locale);
  end if;
  return app.signature_text_core(p_action, p_subject_id, p_params, p_locale);
end $$;

grant execute on function
  public.create_import(uuid, text, jsonb, jsonb), public.get_import(uuid, uuid), public.list_imports(uuid),
  public.import_commit(uuid, uuid, uuid)
  to authenticated;
