-- Step 25 (SPEC §7.8 "förberett men ej byggt i v1", now built behind flags – ADR 0022): NFC labels, telematics
-- (ISO 15143-3 / AEMP 2.0 feeds: Volvo CareTrack, Komatsu Komtrax, Trackunit), Transportstyrelsen lookups via an Edge
-- Function, and theft-register sync with Larmtjänst. All external calls live in Edge Functions behind adapters.

insert into app.secrets (name, value) values ('integration_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- ============================================================ NFC labels
-- An NFC label carries the same URL as the QR code. The tag's chip serial (read with Web NFC) is bound at first scan by
-- the owner; a later public scan with a different chip serial means the tag may have been cloned.
alter table public.labels add column nfc_uid_hash text;

drop function if exists public.order_labels(uuid, int, jsonb);
create or replace function public.order_labels(p_org_id uuid, p_quantity int, p_shipping_address jsonb default null, p_medium public.label_medium default 'qr')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); b public.label_batches;
begin
  if p_quantity not in (10, 25, 50, 100, 250, 500) then perform app.raise('VALIDATION', '{"field":"quantity"}'); end if;
  if p_medium = 'nfc' and not (app.flag('FEATURE_NFC') or app.is_demo_mode()) then perform app.raise('FEATURE_DISABLED'); end if;
  insert into public.label_batches (quantity, status, medium, assigned_org_id, ordered_by_org_id, shipping_address, created_by)
  values (p_quantity, 'ordered', coalesce(p_medium, 'qr'), actor, actor, p_shipping_address, auth.uid()) returning * into b;
  perform app.log_event('labels.ordered', null, actor, actor, jsonb_build_object('batch_id', b.id, 'quantity', p_quantity, 'medium', b.medium));
  perform app.notify_operators('labels.ordered', jsonb_build_object('batch_id', b.id, 'quantity', p_quantity, 'medium', b.medium,
    'org', (select name from public.organizations where id = actor)), '/admin/labels', 'info', 'superadmin');
  return to_jsonb(b);
end $$;

-- The owner/user registers the chip serial of a bound NFC label (first time only; a replacement needs a new label).
create or replace function public.register_nfc_tag(p_org_id uuid, p_code text, p_uid text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); l public.labels; uid text := upper(regexp_replace(coalesce(p_uid, ''), '[^0-9A-Fa-f]', '', 'g'));
begin
  if length(uid) not between 8 and 20 then perform app.raise('VALIDATION', '{"field":"uid"}'); end if;
  select * into l from public.labels where code = p_code for update;
  if l.id is null or l.medium <> 'nfc' or l.status <> 'bound' then perform app.raise('LABEL_NOT_FOUND'); end if;
  perform app.require_fleet_access(l.machine_id, actor);
  if l.nfc_uid_hash is not null then
    if l.nfc_uid_hash = app.sha256_hex('nfc:' || uid) then return jsonb_build_object('ok', true, 'already', true); end if;
    perform app.raise('LABEL_ALREADY_USED');
  end if;
  update public.labels set nfc_uid_hash = app.sha256_hex('nfc:' || uid) where id = l.id;
  perform app.log_event('label.nfc_registered', l.machine_id, (select owner_org_id from public.machines where id = l.machine_id), actor,
    jsonb_build_object('label_id', l.id));
  return jsonb_build_object('ok', true);
end $$;

-- Public NFC scan (scan-log function, service role): does the chip match the one registered for the label?
create or replace function public.check_nfc_tag(p_code text, p_uid text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.labels; m public.machines; uid text := upper(regexp_replace(coalesce(p_uid, ''), '[^0-9A-Fa-f]', '', 'g'));
begin
  if not app.rate_limit_hit('nfc:' || coalesce(p_ip_hash, '-'), 30, interval '1 minute') then perform app.raise('RATE_LIMITED'); end if;
  select * into l from public.labels where code = p_code;
  if l.id is null or l.medium <> 'nfc' or l.nfc_uid_hash is null or length(uid) < 8 then return jsonb_build_object('result', 'unknown'); end if;
  if l.nfc_uid_hash = app.sha256_hex('nfc:' || uid) then return jsonb_build_object('result', 'match'); end if;
  select * into m from public.machines where id = l.machine_id;
  if app.rate_limit_hit('nfc-mismatch:' || l.id, 1, interval '1 day') then
    perform app.log_event('label.nfc_mismatch', m.id, m.owner_org_id, null, jsonb_build_object('label_id', l.id));
    perform app.notify_org(m.owner_org_id, 'label.nfc_mismatch', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id),
      '/machines/' || m.id, 'warning');
    perform app.notify_operators('label.nfc_mismatch', jsonb_build_object('reg_number', m.reg_number, 'label_id', l.id), '/admin/labels', 'warning', 'verifier');
  end if;
  return jsonb_build_object('result', 'mismatch');
end $$;

-- Label list with medium and whether the NFC chip is registered (redefines step 3).
create or replace function public.list_labels(p_org_id uuid, p_status public.label_status default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return jsonb_build_object(
    'batches', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.label_batches b
      where b.assigned_org_id = actor or b.ordered_by_org_id = actor), '[]'::jsonb),
    'labels', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'serial', right(l.code, 6), 'status', l.status,
        'role', l.role, 'machine_id', l.machine_id, 'reg_number', m.reg_number, 'bound_at', l.bound_at,
        'medium', l.medium, 'nfc_registered', l.nfc_uid_hash is not null) order by l.created_at desc)
      from (select * from public.labels l2 where l2.assigned_org_id = actor and (p_status is null or l2.status = p_status)
            order by l2.created_at desc limit least(greatest(p_limit, 1), 1000)) l
      left join public.machines m on m.id = l.machine_id), '[]'::jsonb));
end $$;

-- ============================================================ Telematics
create table public.telematics_connections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id),
  provider        text not null check (provider in ('caretrack', 'komtrax', 'trackunit', 'iso15143', 'mock')),
  name            text not null check (length(trim(name)) between 1 and 80),
  base_url        text check (base_url is null or base_url ~ '^https://'),
  credential_enc  bytea,
  status          text not null default 'active' check (status in ('active', 'paused', 'error')),
  sync_requested  boolean not null default true,
  last_sync_at    timestamptz,
  last_error      text,
  last_counts     jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create table public.telematics_links (
  connection_id uuid not null references public.telematics_connections (id) on delete cascade,
  external_id   text not null,
  machine_id    uuid not null references public.machines (id),
  created_at    timestamptz not null default now(),
  primary key (connection_id, external_id)
);
-- Latest position only – no track history is stored (privacy, ADR 0022).
create table public.machine_positions (
  machine_id    uuid primary key references public.machines (id),
  lat           numeric(8, 5) not null check (lat between -90 and 90),
  lon           numeric(8, 5) not null check (lon between -180 and 180),
  reported_at   timestamptz not null,
  connection_id uuid references public.telematics_connections (id) on delete set null
);
alter table public.telematics_connections enable row level security;
alter table public.telematics_links enable row level security;
alter table public.machine_positions enable row level security;

create or replace function app.telematics_json(c public.telematics_connections)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'provider', c.provider, 'name', c.name, 'base_url', c.base_url, 'status', c.status,
    'has_credential', c.credential_enc is not null, 'last_sync_at', c.last_sync_at, 'last_error', c.last_error, 'last_counts', c.last_counts,
    'sync_requested', c.sync_requested, 'machines', (select count(*) from public.telematics_links l where l.connection_id = c.id), 'created_at', c.created_at)
$$;

create or replace function public.create_telematics_connection(p_org_id uuid, p_provider text, p_name text, p_base_url text, p_credential jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); c public.telematics_connections;
begin
  if not (app.flag('FEATURE_TELEMATICS') or app.is_demo_mode()) then perform app.raise('FEATURE_DISABLED'); end if;
  if p_provider <> 'mock' and (p_base_url is null or p_credential is null) then perform app.raise('VALIDATION', '{"field":"credential"}'); end if;
  if p_provider = 'mock' and not app.is_demo_mode() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  if (select count(*) from public.telematics_connections where org_id = actor) >= 10 then perform app.raise('RATE_LIMITED'); end if;
  insert into public.telematics_connections (org_id, provider, name, base_url, credential_enc, created_by)
  values (actor, p_provider, trim(p_name), nullif(trim(p_base_url), ''),
    case when p_credential is not null then extensions.pgp_sym_encrypt(p_credential::text, app.secret('integration_key')) end, auth.uid())
  returning * into c;
  perform app.log_event('telematics.connected', null, actor, actor, jsonb_build_object('connection_id', c.id, 'provider', c.provider));
  return app.telematics_json(c);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"connection"}');
end $$;

create or replace function public.list_telematics_connections(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.telematics_json(c) order by c.created_at) from public.telematics_connections c where c.org_id = actor), '[]'::jsonb);
end $$;

create or replace function public.update_telematics_connection(p_org_id uuid, p_connection_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); c public.telematics_connections;
begin
  select * into c from public.telematics_connections where id = p_connection_id and org_id = actor for update;
  if c.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_action = 'sync' then update public.telematics_connections set sync_requested = true where id = c.id;
  elsif p_action = 'pause' then update public.telematics_connections set status = 'paused' where id = c.id;
  elsif p_action = 'resume' then update public.telematics_connections set status = 'active', sync_requested = true, last_error = null where id = c.id;
  elsif p_action = 'delete' then
    delete from public.machine_positions where connection_id = c.id;
    delete from public.telematics_connections where id = c.id;
    perform app.log_event('telematics.disconnected', null, actor, actor, jsonb_build_object('connection_id', c.id));
    return jsonb_build_object('ok', true, 'deleted', true);
  else perform app.raise('VALIDATION', '{"field":"action"}');
  end if;
  return app.telematics_json((select x from public.telematics_connections x where x.id = c.id));
end $$;

-- Service: connections to sync now (requested, or not synced for an hour), with the decrypted credential and the org's
-- machine identifiers (the mock provider answers for these).
create or replace function public.telematics_due_connections(p_limit int default 20)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'org_id', c.org_id, 'provider', c.provider, 'base_url', c.base_url, 'last_sync_at', c.last_sync_at,
      'credential', case when c.credential_enc is not null then extensions.pgp_sym_decrypt(c.credential_enc, app.secret('integration_key'))::jsonb end,
      'machines', (select coalesce(jsonb_agg(jsonb_build_object('machine_id', m.id, 'serial', (select i.value from public.machine_identifiers i
          where i.machine_id = m.id and i.type in ('serial', 'pin', 'vin') order by i.type limit 1), 'hour_meter', m.hour_meter)), '[]'::jsonb)
        from public.machines m where (m.owner_org_id = c.org_id or m.user_org_id = c.org_id) and m.status in ('active', 'stolen', 'blocked', 'disputed')))),
    '[]'::jsonb)
  from (select * from public.telematics_connections where status in ('active', 'error')
          and (sync_requested or last_sync_at is null or last_sync_at < now() - interval '1 hour') order by last_sync_at nulls first limit p_limit) c
$$;

-- Service: readings [{external_id, serial?, pin?, vin?, hours?, hours_at?, lat?, lon?, position_at?}] for one connection.
-- Matches the org's own machines only; hours only go up; latest position replaces the previous one. A stolen machine
-- that reports a position notifies its owner and the flagging authority at once.
create or replace function public.telematics_ingest(p_connection_id uuid, p_readings jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.telematics_connections; r jsonb; mid uuid; m public.machines; h int; matched int := 0; unmatched int := 0; hours_n int := 0;
  pos_n int := 0; counts jsonb;
begin
  select * into c from public.telematics_connections where id = p_connection_id for update;
  if c.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_error is not null then
    update public.telematics_connections set status = 'error', last_error = left(p_error, 300), sync_requested = false, last_sync_at = now() where id = c.id;
    perform app.notify_org(c.org_id, 'telematics.error', jsonb_build_object('name', c.name), '/settings?tab=integrations', 'warning', 'admin');
    return jsonb_build_object('ok', false);
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) loop
    mid := (select l.machine_id from public.telematics_links l where l.connection_id = c.id and l.external_id = r ->> 'external_id');
    if mid is null then
      select m2.id into mid from public.machines m2 join public.machine_identifiers i on i.machine_id = m2.id
      where (m2.owner_org_id = c.org_id or m2.user_org_id = c.org_id) and m2.status not in ('draft', 'scrapped', 'exported', 'deregistered')
        and i.type in ('serial', 'pin', 'vin')
        and i.normalized_value in (app.normalize_identifier(r ->> 'serial'), app.normalize_identifier(r ->> 'pin'), app.normalize_identifier(r ->> 'vin'))
      limit 1;
      if mid is not null and nullif(r ->> 'external_id', '') is not null then
        insert into public.telematics_links (connection_id, external_id, machine_id) values (c.id, r ->> 'external_id', mid) on conflict do nothing;
      end if;
    end if;
    if mid is null then unmatched := unmatched + 1; continue; end if;
    matched := matched + 1;
    select * into m from public.machines where id = mid;
    h := floor((r ->> 'hours')::numeric)::int;
    if h is not null and h between 0 and 9999999 and (m.hour_meter is null or h > m.hour_meter) then
      insert into public.maintenance_entries (machine_id, org_id, type, performed_at, hours, notes)
      values (m.id, c.org_id, 'hour_reading', least(coalesce((r ->> 'hours_at')::date, current_date), current_date), h, 'telematics:' || c.provider);
      update public.machines set hour_meter = h, hour_meter_updated_at = now() where id = m.id;
      perform app.log_event('machine.hours_reported', m.id, m.owner_org_id, c.org_id, jsonb_build_object('hours', h, 'source', 'telematics', 'provider', c.provider));
      hours_n := hours_n + 1;
    end if;
    if r ? 'lat' and r ? 'lon' then
      insert into public.machine_positions (machine_id, lat, lon, reported_at, connection_id)
      values (m.id, round((r ->> 'lat')::numeric, 5), round((r ->> 'lon')::numeric, 5), coalesce((r ->> 'position_at')::timestamptz, now()), c.id)
      on conflict (machine_id) do update set lat = excluded.lat, lon = excluded.lon, reported_at = excluded.reported_at, connection_id = excluded.connection_id
      where public.machine_positions.reported_at <= excluded.reported_at;
      pos_n := pos_n + 1;
      if m.status = 'stolen' and app.rate_limit_hit('stolen-pos:' || m.id, 1, interval '6 hours') then
        perform app.log_event('telematics.stolen_position', m.id, m.owner_org_id, null, jsonb_build_object('provider', c.provider));
        perform app.notify_org(x, 'telematics.stolen_position', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id,
            'lat', round((r ->> 'lat')::numeric, 4), 'lon', round((r ->> 'lon')::numeric, 4)), '/machines/' || m.id, 'critical')
        from (select distinct unnest(array_remove(array[m.owner_org_id] || array(select f.raised_by_org_id from public.flags f
          where f.machine_id = m.id and f.type = 'stolen' and f.status = 'active'), null)) x) o;
      end if;
    end if;
  end loop;
  counts := jsonb_build_object('matched', matched, 'unmatched', unmatched, 'hours', hours_n, 'positions', pos_n);
  update public.telematics_connections set status = 'active', last_error = null, last_sync_at = now(), sync_requested = false, last_counts = counts where id = c.id;
  return jsonb_build_object('ok', true) || counts;
end $$;

-- Last reported position: owner and user; an authority only while the machine is stolen.
create or replace function public.get_machine_position(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); m public.machines; p public.machine_positions;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if not coalesce(actor = m.owner_org_id or actor = m.user_org_id or (m.status = 'stolen' and app.has_org_type(actor, 'authority')), false) then
    perform app.raise('FORBIDDEN');
  end if;
  select * into p from public.machine_positions where machine_id = m.id;
  if p.machine_id is null then return null; end if;
  return jsonb_build_object('lat', p.lat, 'lon', p.lon, 'reported_at', p.reported_at,
    'provider', (select provider from public.telematics_connections where id = p.connection_id));
end $$;

-- ============================================================ Theft register sync (Larmtjänst)
create table public.theft_sync_queue (
  id              uuid primary key default gen_random_uuid(),
  flag_id         uuid not null references public.flags (id),
  action          text not null check (action in ('report', 'recovered')),
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  external_ref    text,
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (flag_id, action)
);
create table public.external_theft_reports (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,
  external_ref       text,
  serial             text not null,
  normalized_serial  text not null,
  make               text,
  model              text,
  reported_at        timestamptz,
  report_status      text not null check (report_status in ('stolen', 'recovered')),
  matched_machine_id uuid references public.machines (id),
  review_status      text not null default 'new' check (review_status in ('new', 'confirmed', 'ignored')),
  received_at        timestamptz not null default now(),
  unique (source, normalized_serial, report_status)
);
alter table public.theft_sync_queue enable row level security;
alter table public.external_theft_reports enable row level security;

create or replace function app.theft_sync_enabled()
returns boolean language sql stable security definer set search_path = '' as $$ select app.flag('FEATURE_THEFT_SYNC') or app.is_demo_mode() $$;

-- Stolen flags are reported to the theft register; clearing one reports the machine recovered.
create or replace function app.queue_theft_sync() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type <> 'stolen' or not app.theft_sync_enabled() then return new; end if;
  if tg_op = 'INSERT' and new.status = 'active' then
    insert into public.theft_sync_queue (flag_id, action) values (new.id, 'report') on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'cleared' then
    insert into public.theft_sync_queue (flag_id, action) values (new.id, 'recovered') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger flags_theft_sync after insert or update of status on public.flags for each row execute function app.queue_theft_sync();

create or replace function public.claim_theft_sync(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  with c as (
    update public.theft_sync_queue q set status = 'sending', attempts = attempts + 1
    where q.id in (select id from public.theft_sync_queue where status = 'pending' and next_attempt_at <= now() order by created_at
                   limit least(greatest(p_limit, 1), 200) for update skip locked)
    returning q.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'action', c.action, 'report', jsonb_build_object(
      'regNumber', m.reg_number,
      'serial', (select i.value from public.machine_identifiers i where i.machine_id = m.id and i.type in ('serial', 'pin', 'vin') order by i.type limit 1),
      'make', m.make, 'model', m.model, 'policeReference', f.reference,
      'reportedAt', app.iso_ts(case when c.action = 'report' then f.raised_at else coalesce(f.cleared_at, now()) end),
      'status', case when c.action = 'report' then 'stolen' else 'recovered' end))), '[]'::jsonb) into r
  from c join public.flags f on f.id = c.flag_id join public.machines m on m.id = f.machine_id;
  return r;
end $$;

create or replace function public.record_theft_sync_result(p_id uuid, p_ok boolean, p_external_ref text default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.theft_sync_queue;
begin
  select * into q from public.theft_sync_queue where id = p_id for update;
  if q.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_ok then
    update public.theft_sync_queue set status = 'sent', external_ref = p_external_ref, last_error = null where id = q.id;
    if q.action = 'report' and p_external_ref is not null then update public.flags set external_ref = p_external_ref where id = q.flag_id; end if;
  else
    update public.theft_sync_queue set status = case when q.attempts >= 6 then 'failed' else 'pending' end, last_error = left(p_error, 300),
      next_attempt_at = now() + (interval '5 minutes' * power(3, q.attempts)) where id = q.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Reports pulled from the external register. A match on a machine that is not flagged stolen here is never flagged
-- automatically: the owner and the operator are told and the operator reviews it.
create or replace function public.ingest_external_theft_reports(p_source text, p_reports jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; x public.external_theft_reports; mid uuid; n int := 0; matched int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_reports, '[]'::jsonb)) loop
    continue when app.normalize_identifier(r ->> 'serial') is null;
    select i.machine_id into mid from public.machine_identifiers i join public.machines m on m.id = i.machine_id
    where i.type in ('serial', 'pin', 'vin') and i.normalized_value = app.normalize_identifier(r ->> 'serial') and m.status <> 'draft' limit 1;
    insert into public.external_theft_reports (source, external_ref, serial, normalized_serial, make, model, reported_at, report_status, matched_machine_id)
    values (p_source, r ->> 'externalRef', r ->> 'serial', app.normalize_identifier(r ->> 'serial'), r ->> 'make', r ->> 'model',
      (r ->> 'reportedAt')::timestamptz, coalesce(r ->> 'status', 'stolen'), mid)
    on conflict (source, normalized_serial, report_status) do nothing returning * into x;
    continue when x.id is null;
    n := n + 1;
    if mid is not null and x.report_status = 'stolen'
       and not exists (select 1 from public.flags f where f.machine_id = mid and f.type = 'stolen' and f.status = 'active') then
      matched := matched + 1;
      perform app.notify_operators('theft.external_match', jsonb_build_object('source', p_source, 'reg_number', (select reg_number from public.machines where id = mid),
        'report_id', x.id), '/admin/theft-reports', 'critical', 'verifier');
      perform app.notify_org((select owner_org_id from public.machines where id = mid), 'theft.external_match',
        jsonb_build_object('source', p_source, 'reg_number', (select reg_number from public.machines where id = mid), 'machine_id', mid), '/machines/' || mid, 'critical');
      perform app.log_event('theft.external_match', mid, (select owner_org_id from public.machines where id = mid), null, jsonb_build_object('source', p_source));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'new', n, 'matched', matched);
end $$;

create or replace function public.admin_list_external_theft_reports(p_status text default 'new')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('machine', case when x.matched_machine_id is not null then
        (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'status', m.status, 'owner', app.org_brief(m.owner_org_id)) from public.machines m where m.id = x.matched_machine_id) end)
      order by x.received_at desc) from public.external_theft_reports x where p_status is null or x.review_status = p_status), '[]'::jsonb),
    'queue', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.theft_sync_queue group by 1) q),
    'enabled', app.theft_sync_enabled());
end $$;

create or replace function public.admin_review_external_theft_report(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_operator('verifier');
  if p_status not in ('confirmed', 'ignored') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.external_theft_reports set review_status = p_status where id = p_id;
  if not found then perform app.raise('NOT_FOUND'); end if;
  perform app.audit('theft.external_reviewed', 'external_theft_report', p_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================ Public status page (/status)
create or replace function public.public_system_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'database', 'ok',
    'demo', app.is_demo_mode(),
    'last_anchor', (select jsonb_build_object('day', a.day, 'root', a.root_hash, 'published_at', a.published_at, 'reference', a.external_ref)
      from public.event_anchors a where a.published_at is not null order by a.day desc limit 1),
    'events_last_24h', (select count(*) from public.events where created_at > now() - interval '24 hours'),
    'statistics_at', (select max(created_at) from public.statistics_snapshots),
    'integrations', jsonb_build_object('nfc', app.flag('FEATURE_NFC') or app.is_demo_mode(), 'telematics', app.flag('FEATURE_TELEMATICS') or app.is_demo_mode(),
      'theft_sync', app.theft_sync_enabled(), 'push', app.push_enabled(), 'payments', app.payments_enabled()),
    'checked_at', now())
$$;

revoke execute on function public.check_nfc_tag(text, text, text), public.telematics_due_connections(int), public.telematics_ingest(uuid, jsonb, text),
  public.claim_theft_sync(int), public.record_theft_sync_result(uuid, boolean, text, text), public.ingest_external_theft_reports(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.check_nfc_tag(text, text, text), public.telematics_due_connections(int), public.telematics_ingest(uuid, jsonb, text),
  public.claim_theft_sync(int), public.record_theft_sync_result(uuid, boolean, text, text), public.ingest_external_theft_reports(text, jsonb) to service_role;
grant execute on function public.public_system_status() to anon, authenticated;
grant execute on function public.order_labels(uuid, int, jsonb, public.label_medium), public.register_nfc_tag(uuid, text, text),
  public.create_telematics_connection(uuid, text, text, text, jsonb), public.list_telematics_connections(uuid),
  public.update_telematics_connection(uuid, uuid, text), public.get_machine_position(uuid, uuid),
  public.admin_list_external_theft_reports(text), public.admin_review_external_theft_report(uuid, text) to authenticated;
select app.grant_api_access();
