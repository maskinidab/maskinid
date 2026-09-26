-- Step 12: fleet (SPEC §7.1, §4.6) – hour meter, service log, inspections by accredited bodies, reminders + weekly
-- digest, projects/sites, insurance, rentals, fleet/procurement report (snapshot with number + hash, share link,
-- live read-only access for client orgs).

-- ---------- Tables ----------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id),
  name         text not null check (length(trim(name)) between 1 and 200),
  site_address text,
  reference    text,
  starts_on    date,
  ends_on      date,
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index projects_org_idx on public.projects (org_id);

create table public.machine_assignments (
  id           uuid primary key default gen_random_uuid(),
  machine_id   uuid not null references public.machines (id),
  org_id       uuid not null references public.organizations (id),
  project_id   uuid references public.projects (id),
  name         text not null,
  site_address text,
  from_date    date not null default current_date,
  to_date      date,
  created_at   timestamptz not null default now()
);
create unique index machine_assignments_one_open on public.machine_assignments (machine_id, org_id) where to_date is null;

create table public.maintenance_entries (
  id                  uuid primary key default gen_random_uuid(),
  machine_id          uuid not null references public.machines (id),
  org_id              uuid not null references public.organizations (id),
  type                public.maintenance_type not null,
  performed_at        date not null,
  hours               int check (hours is null or hours between 0 and 9999999),
  performed_by_org_id uuid references public.organizations (id),
  performed_by_text   text,
  notes               text check (notes is null or length(notes) <= 4000),
  document_id         uuid references public.documents (id),
  next_due_at         date,
  next_due_hours      int,
  created_by_user_id  uuid,
  created_at          timestamptz not null default now()
);
create index maintenance_machine_idx on public.maintenance_entries (machine_id, performed_at desc);

create table public.inspections (
  id                     uuid primary key default gen_random_uuid(),
  machine_id             uuid not null references public.machines (id),
  inspection_body_org_id uuid references public.organizations (id),
  inspection_body_name   text not null,
  type                   public.inspection_type not null,
  performed_at           date not null,
  certificate_no         text,
  result                 public.inspection_result not null,
  remarks                text,
  valid_until            date,
  hours_at_inspection    int,
  document_id            uuid references public.documents (id),
  recorded_by_user_id    uuid,
  recorded_by_org_id     uuid references public.organizations (id),
  created_at             timestamptz not null default now()
);
create index inspections_machine_idx on public.inspections (machine_id, performed_at desc);

create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  machine_id    uuid references public.machines (id),
  org_id        uuid not null references public.organizations (id),
  type          public.reminder_type not null,
  title         text not null,
  due_at        date,
  due_hours     int,
  status        public.reminder_status not null default 'open',
  snoozed_until date,
  source_id     uuid,  -- maintenance entry, inspection, policy, encumbrance or rental that created it
  notified      jsonb not null default '[]'::jsonb, -- lead times already notified (e.g. [60,30,7])
  done_at       timestamptz,
  created_by_user_id uuid,
  created_at    timestamptz not null default now(),
  check (due_at is not null or due_hours is not null)
);
create index reminders_org_idx on public.reminders (org_id, status, due_at);
create unique index reminders_one_per_source on public.reminders (org_id, type, source_id) where source_id is not null and status <> 'done';

create table public.rentals (
  id             uuid primary key default gen_random_uuid(),
  machine_id     uuid not null references public.machines (id),
  lessor_org_id  uuid not null references public.organizations (id),
  lessee_org_id  uuid not null references public.organizations (id),
  from_date      date not null,
  to_date        date not null,
  status         public.rental_status not null default 'planned',
  encumbrance_id uuid references public.encumbrances (id),
  reference      text,
  returned_at    timestamptz,
  created_at     timestamptz not null default now(),
  check (to_date >= from_date)
);
create index rentals_machine_idx on public.rentals (machine_id, from_date desc);

create table public.insurance_policies (
  id             uuid primary key default gen_random_uuid(),
  machine_id     uuid not null references public.machines (id),
  org_id         uuid not null references public.organizations (id),  -- policy holder (owner) that registered it
  insurer_org_id uuid references public.organizations (id),
  insurer_name   text not null,
  policy_number  text not null,
  valid_from     date not null,
  valid_to       date not null,
  coverage       public.insurance_coverage not null,
  status         public.insurance_status not null default 'active',
  document_id    uuid references public.documents (id),
  created_at     timestamptz not null default now(),
  check (valid_to >= valid_from)
);
create index insurance_machine_idx on public.insurance_policies (machine_id);
create index insurance_insurer_idx on public.insurance_policies (insurer_org_id) where insurer_org_id is not null;

-- Fleet/procurement report snapshots (the "signed" report: number + SHA-256 of the content, verifiable).
create table public.report_snapshots (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('fleet_report', 'project_list')),
  report_number text not null unique,
  org_id        uuid not null references public.organizations (id),
  params        jsonb not null default '{}'::jsonb,
  result        jsonb not null,
  result_hash   text not null,
  created_by_user_id uuid,
  created_at    timestamptz not null default now()
);

-- Live read-only access for a client org (beställare) to an owner's fleet report / project list.
create table public.report_grants (
  id            uuid primary key default gen_random_uuid(),
  owner_org_id  uuid not null references public.organizations (id),
  client_org_id uuid not null references public.organizations (id),
  project_id    uuid references public.projects (id),
  kind          text not null default 'fleet_report' check (kind in ('fleet_report', 'project_list')),
  created_by_user_id uuid,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index report_grants_one_active on public.report_grants (owner_org_id, client_org_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
  where revoked_at is null;

create sequence public.fleet_report_seq;

-- ---------- RLS: read own, never write directly ----------
alter table public.projects enable row level security;
alter table public.machine_assignments enable row level security;
alter table public.maintenance_entries enable row level security;
alter table public.inspections enable row level security;
alter table public.reminders enable row level security;
alter table public.rentals enable row level security;
alter table public.insurance_policies enable row level security;
alter table public.report_snapshots enable row level security;
alter table public.report_grants enable row level security;
revoke all on public.projects, public.machine_assignments, public.maintenance_entries, public.inspections, public.reminders,
  public.rentals, public.insurance_policies, public.report_snapshots, public.report_grants from anon, authenticated;
revoke all on sequence public.fleet_report_seq from anon, authenticated;
grant select on public.projects, public.machine_assignments, public.maintenance_entries, public.inspections, public.reminders,
  public.rentals, public.insurance_policies, public.report_snapshots, public.report_grants to authenticated;
create policy projects_read on public.projects for select to authenticated using (org_id = any (app.current_org_ids()) or app.is_operator());
create policy assignments_read on public.machine_assignments for select to authenticated using (org_id = any (app.current_org_ids()) or app.is_operator());
-- Service and inspection history follow the machine (SPEC §4.6): whoever has full access to the machine reads them.
create policy maintenance_read on public.maintenance_entries for select to authenticated using (
  org_id = any (app.current_org_ids()) or app.has_full_access(app.machine_relations(machine_id)));
create policy inspections_read on public.inspections for select to authenticated using (
  recorded_by_org_id = any (app.current_org_ids()) or app.has_full_access(app.machine_relations(machine_id)));
create policy reminders_read on public.reminders for select to authenticated using (org_id = any (app.current_org_ids()));
create policy rentals_read on public.rentals for select to authenticated using (
  lessor_org_id = any (app.current_org_ids()) or lessee_org_id = any (app.current_org_ids()) or app.is_operator());
create policy insurance_read on public.insurance_policies for select to authenticated using (
  org_id = any (app.current_org_ids()) or insurer_org_id = any (app.current_org_ids()) or app.is_operator() or app.acts_as('authority')
  or 'owner' = any (app.machine_relations(machine_id)));
create policy report_snapshots_read on public.report_snapshots for select to authenticated using (org_id = any (app.current_org_ids()));
create policy report_grants_read on public.report_grants for select to authenticated using (
  owner_org_id = any (app.current_org_ids()) or client_org_id = any (app.current_org_ids()));

-- ---------- Helpers ----------
-- Fleet actions: owner or user of the machine (or an operator acting as support).
create or replace function app.require_fleet_access(p_machine_id uuid, p_actor uuid)
returns public.machines language plpgsql stable security definer set search_path = '' as $$
declare m public.machines;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if (app.machine_relations(m.id, array[p_actor]) && array['owner', 'user']) is not true then perform app.raise('FORBIDDEN'); end if;
  return m;
end $$;

create or replace function app.upsert_reminder(p_org uuid, p_machine uuid, p_type public.reminder_type, p_title text,
  p_due_at date, p_due_hours int, p_source uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if p_due_at is null and p_due_hours is null then return null; end if;
  if p_source is not null then
    update public.reminders set due_at = p_due_at, due_hours = p_due_hours, title = p_title, notified = '[]'::jsonb, status = 'open', snoozed_until = null
    where org_id = p_org and type = p_type and source_id = p_source and status <> 'done' returning id into rid;
    if rid is not null then return rid; end if;
  end if;
  insert into public.reminders (machine_id, org_id, type, title, due_at, due_hours, source_id, created_by_user_id)
  values (p_machine, p_org, p_type, left(p_title, 200), p_due_at, p_due_hours, p_source, auth.uid()) returning id into rid;
  return rid;
end $$;

-- A newer entry of the same kind replaces older open reminders for that machine (e.g. the next service).
create or replace function app.close_reminders(p_org uuid, p_machine uuid, p_type public.reminder_type, p_except uuid default null)
returns void language sql security definer set search_path = '' as $$
  update public.reminders set status = 'done', done_at = now()
  where org_id = p_org and machine_id = p_machine and type = p_type and status <> 'done' and id is distinct from p_except
$$;

-- ---------- Hour meter ----------
create or replace function public.record_hours(p_org_id uuid, p_machine_id uuid, p_hours int, p_at date default current_date, p_correction boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; e public.maintenance_entries;
begin
  perform app.require_scope('machines:write');
  m := app.require_fleet_access(p_machine_id, actor);
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  if p_hours is null or p_hours < 0 or p_hours > 9999999 then perform app.raise('VALIDATION', '{"field":"hours"}'); end if;
  if p_at is null or p_at > current_date then perform app.raise('VALIDATION', '{"field":"date"}'); end if;
  -- The meter only goes up; a lower reading must be marked as a correction (meter replaced, typo).
  if m.hour_meter is not null and p_hours < m.hour_meter and not coalesce(p_correction, false) then
    perform app.raise('VALIDATION', jsonb_build_object('field', 'hours', 'reason', 'lower_than_current', 'current', m.hour_meter));
  end if;
  insert into public.maintenance_entries (machine_id, org_id, type, performed_at, hours, notes, created_by_user_id)
  values (m.id, actor, 'hour_reading', p_at, p_hours, case when p_correction then 'correction' end, auth.uid()) returning * into e;
  update public.machines set hour_meter = p_hours, hour_meter_updated_at = now() where id = m.id;
  perform app.log_event('machine.hours_reported', m.id, m.owner_org_id, actor, jsonb_build_object('hours', p_hours, 'at', p_at,
    'correction', coalesce(p_correction, false)));
  return jsonb_build_object('ok', true, 'hours', p_hours, 'due', app.hour_reminders_due(m.id, p_hours));
end $$;

create or replace function app.hour_reminders_due(p_machine_id uuid, p_hours int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_hours', due_hours)), '[]'::jsonb)
  from public.reminders where machine_id = p_machine_id and status = 'open' and due_hours is not null and due_hours <= p_hours + 50
$$;

-- ---------- Service log ----------
create or replace function public.add_maintenance(p_org_id uuid, p_machine_id uuid, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; e public.maintenance_entries; t public.maintenance_type; rid uuid;
begin
  perform app.require_scope('machines:write');
  m := app.require_fleet_access(p_machine_id, actor);
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  t := (p_entry ->> 'type')::public.maintenance_type;
  if t is null or t = 'hour_reading' then perform app.raise('VALIDATION', '{"field":"type"}'); end if;
  if nullif(p_entry ->> 'performed_at', '')::date > current_date then perform app.raise('VALIDATION', '{"field":"performed_at"}'); end if;
  if (p_entry ->> 'document_id') is not null and not exists (select 1 from public.documents where id = (p_entry ->> 'document_id')::uuid and machine_id = m.id) then
    perform app.raise('VALIDATION', '{"field":"document_id"}');
  end if;
  insert into public.maintenance_entries (machine_id, org_id, type, performed_at, hours, performed_by_org_id, performed_by_text, notes, document_id,
    next_due_at, next_due_hours, created_by_user_id)
  values (m.id, actor, t, coalesce(nullif(p_entry ->> 'performed_at', '')::date, current_date), nullif(p_entry ->> 'hours', '')::int,
    nullif(p_entry ->> 'performed_by_org_id', '')::uuid, nullif(trim(p_entry ->> 'performed_by_text'), ''), nullif(trim(p_entry ->> 'notes'), ''),
    nullif(p_entry ->> 'document_id', '')::uuid, nullif(p_entry ->> 'next_due_at', '')::date, nullif(p_entry ->> 'next_due_hours', '')::int, auth.uid())
  returning * into e;
  if e.hours is not null and (m.hour_meter is null or e.hours > m.hour_meter) then
    update public.machines set hour_meter = e.hours, hour_meter_updated_at = now() where id = m.id;
  end if;
  if t = 'service' then
    rid := app.upsert_reminder(actor, m.id, 'service', coalesce(nullif(trim(p_entry ->> 'next_title'), ''), 'Service'), e.next_due_at, e.next_due_hours, e.id);
    perform app.close_reminders(actor, m.id, 'service', rid);
  end if;
  perform app.log_event('maintenance.logged', m.id, m.owner_org_id, actor, jsonb_build_object('entry_id', e.id, 'type', e.type,
    'performed_at', e.performed_at, 'hours', e.hours, 'performed_by', coalesce(e.performed_by_text, (select name from public.organizations where id = e.performed_by_org_id))));
  return jsonb_build_object('ok', true, 'entry', to_jsonb(e));
end $$;

create or replace function public.list_maintenance(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if not app.has_full_access(app.machine_relations(p_machine_id, array[actor])) then perform app.raise('NOT_FOUND'); end if;
  return coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('org_name', (select name from public.organizations where id = e.org_id),
      'performed_by_org_name', (select name from public.organizations where id = e.performed_by_org_id)) order by e.performed_at desc, e.created_at desc)
    from public.maintenance_entries e where e.machine_id = p_machine_id), '[]'::jsonb);
end $$;

-- ---------- Inspections (accredited inspection body writes directly, or the owner with the protocol) ----------
create or replace function public.record_inspection(p_org_id uuid, p_machine_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; i public.inspections; body boolean := app.has_org_type(actor, 'inspector');
  owner_like boolean;
begin
  perform app.require_scope('inspections:write');
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  owner_like := app.machine_relations(m.id, array[actor]) && array['owner', 'user'];
  if (body or owner_like) is not true then perform app.raise('FORBIDDEN'); end if;
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  if (p_data ->> 'performed_at') is null or (p_data ->> 'performed_at')::date > current_date then perform app.raise('VALIDATION', '{"field":"performed_at"}'); end if;
  if (p_data ->> 'result') is null then perform app.raise('VALIDATION', '{"field":"result"}'); end if;
  if (p_data ->> 'result') <> 'rejected' and nullif(p_data ->> 'valid_until', '') is null then perform app.raise('VALIDATION', '{"field":"valid_until"}'); end if;
  -- The owner must attach the protocol; an inspection body's own record is the protocol.
  if not body and nullif(p_data ->> 'document_id', '') is null then perform app.raise('VALIDATION', '{"field":"document_id","reason":"protocol_required"}'); end if;
  insert into public.inspections (machine_id, inspection_body_org_id, inspection_body_name, type, performed_at, certificate_no, result, remarks,
    valid_until, hours_at_inspection, document_id, recorded_by_user_id, recorded_by_org_id)
  values (m.id, case when body then actor else nullif(p_data ->> 'inspection_body_org_id', '')::uuid end,
    coalesce(case when body then (select name from public.organizations where id = actor) end, nullif(trim(p_data ->> 'inspection_body_name'), ''), '–'),
    coalesce(nullif(p_data ->> 'type', ''), 'periodic')::public.inspection_type, (p_data ->> 'performed_at')::date,
    nullif(trim(p_data ->> 'certificate_no'), ''), (p_data ->> 'result')::public.inspection_result, nullif(trim(p_data ->> 'remarks'), ''),
    nullif(p_data ->> 'valid_until', '')::date, nullif(p_data ->> 'hours', '')::int, nullif(p_data ->> 'document_id', '')::uuid, auth.uid(), actor)
  returning * into i;
  if i.valid_until is not null and m.owner_org_id is not null then
    perform app.close_reminders(m.owner_org_id, m.id, 'inspection');
    perform app.upsert_reminder(m.owner_org_id, m.id, 'inspection', 'Besiktning', i.valid_until, null, i.id);
  end if;
  perform app.log_event('inspection.recorded', m.id, m.owner_org_id, actor, jsonb_build_object('inspection_id', i.id, 'type', i.type,
    'result', i.result, 'valid_until', i.valid_until, 'body', i.inspection_body_name, 'certificate_no', i.certificate_no));
  if body and m.owner_org_id is not null then
    perform app.notify_org(m.owner_org_id, 'inspection.recorded', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
      'body', i.inspection_body_name, 'result', i.result, 'valid_until', i.valid_until), '/machines/' || m.id || '?tab=service',
      case when i.result = 'rejected' then 'warning' else 'info' end::public.notification_severity);
  end if;
  return jsonb_build_object('ok', true, 'inspection', to_jsonb(i));
end $$;

create or replace function public.list_inspections(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if (app.has_full_access(app.machine_relations(p_machine_id, array[actor]))
      or exists (select 1 from public.inspections where machine_id = p_machine_id and recorded_by_org_id = actor)) is not true then
    perform app.raise('NOT_FOUND');
  end if;
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.performed_at desc) from public.inspections i where i.machine_id = p_machine_id), '[]'::jsonb);
end $$;

-- Latest valid (approved) inspection.
create or replace function app.inspection_valid_until(p_machine_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select max(valid_until) from public.inspections where machine_id = p_machine_id and result <> 'rejected' and valid_until >= current_date
$$;

-- Public badge "Besiktigad t.o.m." only when the owner has chosen to show it (org setting).
create or replace function app.public_inspection_valid_until(p_machine_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select case when coalesce((o.settings ->> 'show_inspection_publicly')::boolean, false) then app.inspection_valid_until(m.id) end
  from public.machines m left join public.organizations o on o.id = m.owner_org_id where m.id = p_machine_id
$$;

-- ---------- Reminders ----------
create or replace function public.list_reminders(p_org_id uuid, p_include_done boolean default false, p_machine_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model,
      'hour_meter', m.hour_meter, 'overdue', (r.due_at is not null and r.due_at < current_date) or (r.due_hours is not null and m.hour_meter >= r.due_hours))
      order by coalesce(r.due_at, '9999-12-31'::date), r.due_hours nulls last)
    from public.reminders r left join public.machines m on m.id = r.machine_id
    where r.org_id = actor and (p_include_done or r.status <> 'done') and (p_machine_id is null or r.machine_id = p_machine_id)
      and (r.status <> 'snoozed' or r.snoozed_until <= current_date or p_include_done)), '[]'::jsonb);
end $$;

create or replace function public.create_reminder(p_org_id uuid, p_machine_id uuid, p_title text, p_due_at date default null, p_due_hours int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); rid uuid;
begin
  if p_machine_id is not null then perform app.require_fleet_access(p_machine_id, actor); end if;
  if nullif(trim(p_title), '') is null then perform app.raise('VALIDATION', '{"field":"title"}'); end if;
  if p_due_at is null and p_due_hours is null then perform app.raise('VALIDATION', '{"field":"due"}'); end if;
  rid := app.upsert_reminder(actor, p_machine_id, 'custom', p_title, p_due_at, p_due_hours, null);
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

create or replace function public.update_reminder(p_org_id uuid, p_reminder_id uuid, p_action text, p_snooze_until date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); r public.reminders;
begin
  if p_action not in ('done', 'snooze', 'reopen') then perform app.raise('VALIDATION', '{"field":"action"}'); end if;
  if p_action = 'snooze' and (p_snooze_until is null or p_snooze_until <= current_date) then perform app.raise('VALIDATION', '{"field":"snooze_until"}'); end if;
  update public.reminders set
    status = case p_action when 'done' then 'done' when 'snooze' then 'snoozed' else 'open' end::public.reminder_status,
    done_at = case when p_action = 'done' then now() end,
    snoozed_until = case when p_action = 'snooze' then p_snooze_until end
  where id = p_reminder_id and org_id = actor returning * into r;
  if r.id is null then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'reminder', to_jsonb(r));
end $$;

-- Daily job: notifications at 60/30/7/0 days before a date (inspection, insurance, lease/encumbrance end, temporary
-- registration) and when the hour meter reaches an hours-based reminder. Returns the number of notifications.
create or replace function app.run_reminder_notifications()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; lead int; n int := 0;
begin
  update public.reminders set status = 'open', snoozed_until = null where status = 'snoozed' and snoozed_until <= current_date;
  for r in select rm.*, m.reg_number, m.hour_meter from public.reminders rm left join public.machines m on m.id = rm.machine_id
           where rm.status = 'open' loop
    lead := null;
    -- Whichever comes first: the date (60/30/7/0 days before) or the hour meter reaching the due hours.
    if r.due_hours is not null and r.hour_meter is not null and r.hour_meter >= r.due_hours and not (r.notified @> '[0]') then
      lead := 0;
    elsif r.due_at is not null and r.due_at - current_date >= -1 then
      lead := (select l from unnest(array[0, 7, 30, 60]) l where r.due_at - current_date <= l and not (r.notified @> to_jsonb(l)) order by l limit 1);
    end if;
    if lead is not null then
      perform app.notify_org(r.org_id, 'reminder.due', jsonb_build_object('reminder_id', r.id, 'type', r.type, 'title', r.title,
        'machine_id', r.machine_id, 'reg_number', r.reg_number, 'due_at', r.due_at, 'due_hours', r.due_hours, 'days_left', r.due_at - current_date),
        case when r.machine_id is null then '/fleet' else '/machines/' || r.machine_id || '?tab=service' end,
        case when lead = 0 then 'warning' else 'info' end::public.notification_severity);
      -- Mark this and every longer lead time as done so a late start does not send a burst.
      update public.reminders set notified = (select jsonb_agg(l) from unnest(array[0, 7, 30, 60]) l where l >= lead or notified @> to_jsonb(l))
      where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Weekly digest (Mondays): one e-mail per member who wants it, listing the org's reminders for the next 14 days.
create or replace function app.enqueue_weekly_digest()
returns int language plpgsql security definer set search_path = '' as $$
declare o record; items jsonb; u record; n int := 0;
begin
  for o in select distinct org_id from public.reminders where status = 'open' loop
    items := (select jsonb_agg(jsonb_build_object('title', r.title, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model,
        'due_at', r.due_at, 'due_hours', r.due_hours, 'hour_meter', m.hour_meter) order by r.due_at nulls last)
      from public.reminders r left join public.machines m on m.id = r.machine_id
      where r.org_id = o.org_id and r.status = 'open'
        and ((r.due_at is not null and r.due_at <= current_date + 14) or (r.due_hours is not null and m.hour_meter >= r.due_hours - 100)));
    if items is null then continue; end if;
    for u in select pr.user_id, au.email, coalesce(pr.locale, 'sv') as locale from public.memberships mb
             join public.profiles pr on pr.user_id = mb.user_id join auth.users au on au.id = mb.user_id
             where mb.org_id = o.org_id and mb.status = 'active'
               and coalesce((select np.enabled from public.notification_preferences np where np.user_id = mb.user_id and np.org_id = o.org_id
                                        and np.channel = 'email'), true) loop
      insert into public.email_outbox (to_email, user_id, org_id, template, locale, data)
      values (u.email, u.user_id, o.org_id, 'weekly_digest', u.locale, jsonb_build_object('org_name', (select name from public.organizations where id = o.org_id),
        'items', items));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ---------- Projects / sites ----------
create or replace function public.save_project(p_org_id uuid, p_data jsonb, p_project_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); p public.projects;
begin
  if nullif(trim(p_data ->> 'name'), '') is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  if p_project_id is null then
    insert into public.projects (org_id, name, site_address, reference, starts_on, ends_on)
    values (actor, trim(p_data ->> 'name'), nullif(trim(p_data ->> 'site_address'), ''), nullif(trim(p_data ->> 'reference'), ''),
      nullif(p_data ->> 'starts_on', '')::date, nullif(p_data ->> 'ends_on', '')::date) returning * into p;
  else
    update public.projects set name = trim(p_data ->> 'name'), site_address = nullif(trim(p_data ->> 'site_address'), ''),
      reference = nullif(trim(p_data ->> 'reference'), ''), starts_on = nullif(p_data ->> 'starts_on', '')::date, ends_on = nullif(p_data ->> 'ends_on', '')::date,
      archived_at = case when (p_data ->> 'archived')::boolean then coalesce(archived_at, now()) else null end
    where id = p_project_id and org_id = actor returning * into p;
    if p.id is null then perform app.raise('NOT_FOUND'); end if;
    if p.archived_at is not null then
      update public.machine_assignments set to_date = current_date where project_id = p.id and to_date is null;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'project', to_jsonb(p));
end $$;

create or replace function public.list_projects(p_org_id uuid, p_include_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('machine_count',
      (select count(*) from public.machine_assignments a where a.project_id = p.id and a.to_date is null)) order by p.archived_at nulls first, p.name)
    from public.projects p where p.org_id = actor and (p_include_archived or p.archived_at is null)), '[]'::jsonb);
end $$;

create or replace function public.assign_machine(p_org_id uuid, p_machine_id uuid, p_project_id uuid, p_from date default current_date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; p public.projects; a public.machine_assignments;
begin
  m := app.require_fleet_access(p_machine_id, actor);
  update public.machine_assignments set to_date = greatest(coalesce(p_from, current_date) - 1, from_date)
  where machine_id = m.id and org_id = actor and to_date is null;
  if p_project_id is null then
    perform app.log_event('machine.unassigned', m.id, m.owner_org_id, actor, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'assignment', null);
  end if;
  select * into p from public.projects where id = p_project_id and org_id = actor and archived_at is null;
  if p.id is null then perform app.raise('NOT_FOUND', '{"what":"project"}'); end if;
  insert into public.machine_assignments (machine_id, org_id, project_id, name, site_address, from_date)
  values (m.id, actor, p.id, p.name, p.site_address, coalesce(p_from, current_date)) returning * into a;
  perform app.log_event('machine.assigned', m.id, m.owner_org_id, actor, jsonb_build_object('project_id', p.id, 'project', p.name, 'from', a.from_date));
  return jsonb_build_object('ok', true, 'assignment', to_jsonb(a));
end $$;

-- ---------- Insurance ----------
create or replace function public.add_insurance_policy(p_org_id uuid, p_machine_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; ip public.insurance_policies; insurer boolean := app.has_org_type(actor, 'insurer');
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  -- The owner registers its policy; an insurer registers policies it has issued (portfolio).
  if (app.machine_relations(m.id, array[actor]) && array['owner', 'user'] or insurer) is not true then perform app.raise('FORBIDDEN'); end if;
  if nullif(trim(p_data ->> 'policy_number'), '') is null then perform app.raise('VALIDATION', '{"field":"policy_number"}'); end if;
  if nullif(p_data ->> 'valid_from', '') is null or nullif(p_data ->> 'valid_to', '') is null
     or (p_data ->> 'valid_to')::date < (p_data ->> 'valid_from')::date then perform app.raise('VALIDATION', '{"field":"valid_to"}'); end if;
  insert into public.insurance_policies (machine_id, org_id, insurer_org_id, insurer_name, policy_number, valid_from, valid_to, coverage, document_id)
  values (m.id, coalesce(case when insurer then m.owner_org_id end, actor),
    case when insurer then actor else nullif(p_data ->> 'insurer_org_id', '')::uuid end,
    coalesce(case when insurer then (select name from public.organizations where id = actor) end,
             (select name from public.organizations where id = nullif(p_data ->> 'insurer_org_id', '')::uuid), nullif(trim(p_data ->> 'insurer_name'), ''), '–'),
    trim(p_data ->> 'policy_number'), (p_data ->> 'valid_from')::date, (p_data ->> 'valid_to')::date,
    coalesce(nullif(p_data ->> 'coverage', ''), 'full')::public.insurance_coverage, nullif(p_data ->> 'document_id', '')::uuid)
  returning * into ip;
  if m.owner_org_id is not null then
    perform app.upsert_reminder(m.owner_org_id, m.id, 'insurance', 'Försäkring ' || ip.insurer_name, ip.valid_to, null, ip.id);
  end if;
  perform app.log_event('insurance.registered', m.id, m.owner_org_id, actor, jsonb_build_object('policy_id', ip.id, 'insurer', ip.insurer_name,
    'valid_to', ip.valid_to, 'coverage', ip.coverage));
  return jsonb_build_object('ok', true, 'policy', to_jsonb(ip));
end $$;

create or replace function public.list_insurance_policies(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); rel text[] := app.machine_relations(p_machine_id, array[actor]);
begin
  if (rel && array['owner', 'user', 'insurer', 'authority', 'operator']) is not true then perform app.raise('NOT_FOUND'); end if;
  return coalesce((select jsonb_agg(to_jsonb(ip) order by ip.valid_to desc) from public.insurance_policies ip
    where ip.machine_id = p_machine_id and (rel && array['owner', 'user', 'authority', 'operator'] or ip.insurer_org_id = actor)), '[]'::jsonb);
end $$;

-- ---------- Rentals ----------
create or replace function public.create_rental(p_org_id uuid, p_machine_id uuid, p_lessee_org_id uuid, p_from date, p_to date, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; r public.rentals; e public.encumbrances;
begin
  perform app.require_scope('machines:write');
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if m.owner_org_id is distinct from actor then perform app.raise('FORBIDDEN'); end if;
  perform app.assert_not_blocked(m.id, 'create_rental');
  if p_lessee_org_id is null or p_lessee_org_id = actor or not exists (select 1 from public.organizations where id = p_lessee_org_id and status <> 'suspended') then
    perform app.raise('VALIDATION', '{"field":"lessee"}');
  end if;
  if p_from is null or p_to is null or p_to < p_from then perform app.raise('VALIDATION', '{"field":"to_date"}'); end if;
  if exists (select 1 from public.rentals where machine_id = m.id and status in ('planned', 'active', 'overdue')
             and daterange(from_date, to_date, '[]') && daterange(p_from, p_to, '[]')) then
    perform app.raise('RENTAL_OVERLAP');
  end if;
  -- The rental is an informational right in the register (type rental – never financing, never blocks a sale).
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id, confirmed_at, notes)
  values (m.id, 'rental', actor, p_lessee_org_id, nullif(trim(p_reference), ''), p_from, p_to,
    case when p_from <= current_date then 'active' else 'pending' end::public.encumbrance_status, actor, auth.uid(), now(), 'rental')
  returning * into e;
  insert into public.rentals (machine_id, lessor_org_id, lessee_org_id, from_date, to_date, status, encumbrance_id, reference)
  values (m.id, actor, p_lessee_org_id, p_from, p_to, case when p_from <= current_date then 'active' else 'planned' end::public.rental_status,
    e.id, nullif(trim(p_reference), '')) returning * into r;
  perform app.upsert_reminder(actor, m.id, 'rental_end', 'Uthyrning slutar', p_to, null, r.id);
  perform app.log_event('rental.created', m.id, m.owner_org_id, actor, jsonb_build_object('rental_id', r.id, 'lessee_org_id', p_lessee_org_id,
    'from', p_from, 'to', p_to));
  perform app.notify_org(p_lessee_org_id, 'rental.created', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
    'lessor', (select name from public.organizations where id = actor), 'from', p_from, 'to', p_to), '/rentals', 'info');
  return jsonb_build_object('ok', true, 'rental', to_jsonb(r));
end $$;

create or replace function public.return_rental(p_org_id uuid, p_rental_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); r public.rentals;
begin
  select * into r from public.rentals where id = p_rental_id for update;
  if r.id is null or r.lessor_org_id <> actor then perform app.raise('NOT_FOUND'); end if;
  if r.status = 'returned' then perform app.raise('VALIDATION', '{"reason":"already_returned"}'); end if;
  update public.rentals set status = 'returned', returned_at = now() where id = r.id returning * into r;
  update public.encumbrances set status = 'released', released_at = now(), released_by_user_id = auth.uid()
  where id = r.encumbrance_id and status in ('pending', 'active');
  perform app.close_reminders(actor, r.machine_id, 'rental_end');
  perform app.log_event('rental.returned', r.machine_id, actor, actor, jsonb_build_object('rental_id', r.id));
  return jsonb_build_object('ok', true, 'rental', to_jsonb(r));
end $$;

create or replace function public.list_rentals(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model,
      'direction', case when r.lessor_org_id = actor then 'out' else 'in' end,
      'lessor', (select name from public.organizations where id = r.lessor_org_id), 'lessee', (select name from public.organizations where id = r.lessee_org_id))
      order by r.from_date desc)
    from public.rentals r join public.machines m on m.id = r.machine_id where r.lessor_org_id = actor or r.lessee_org_id = actor), '[]'::jsonb);
end $$;

-- Daily job: planned → active on the start date, active → overdue after the end date.
create or replace function app.update_rental_statuses()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.rentals set status = 'active' where status = 'planned' and from_date <= current_date;
  update public.encumbrances e set status = 'active' from public.rentals r where r.encumbrance_id = e.id and r.status = 'active' and e.status = 'pending';
  update public.rentals set status = 'overdue' where status = 'active' and to_date < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Relations for insurers and lessees ----------
create or replace function app.machine_relations_more(m public.machines, p_orgs uuid[])
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.verification_requests v where v.machine_id = m.id and v.reviewer_org_id = any (p_orgs)
                      and v.status in ('open', 'in_review', 'needs_info')) then 'inspector_assigned' end,
    case when exists (select 1 from public.insurance_policies ip where ip.machine_id = m.id and ip.insurer_org_id = any (p_orgs)
                      and ip.status = 'active' and ip.valid_to >= current_date) then 'insurer' end,
    case when exists (select 1 from public.rentals r where r.machine_id = m.id and r.lessee_org_id = any (p_orgs)
                      and r.status in ('active', 'overdue')) then 'lessee' end
  ], null)
$$;

-- Machine view: next inspection / insurance badge / project / next reminder for owner-like viewers.
create or replace function app.machine_view_extras_more(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'inspection_valid_until', case when app.has_full_access(p_rel) or p_rel && array['insurer'] then app.inspection_valid_until(m.id)
                                   else app.public_inspection_valid_until(m.id) end,
    'inspection_required', m.has_lifting_device,
    'insured', case when p_rel && array['owner', 'user', 'insurer', 'authority', 'operator'] then
      exists (select 1 from public.insurance_policies ip where ip.machine_id = m.id and ip.status = 'active' and current_date between ip.valid_from and ip.valid_to) end,
    'assignment', case when p_rel && array['owner', 'user'] then (select jsonb_build_object('project_id', a.project_id, 'name', a.name, 'site_address', a.site_address, 'from', a.from_date)
      from public.machine_assignments a where a.machine_id = m.id and a.org_id = p_org_id and a.to_date is null limit 1) end,
    'rental', case when p_rel && array['owner', 'lessee'] then (select jsonb_build_object('id', r.id, 'status', r.status, 'from', r.from_date, 'to', r.to_date,
        'lessee', (select name from public.organizations where id = r.lessee_org_id), 'lessor', (select name from public.organizations where id = r.lessor_org_id))
      from public.rentals r where r.machine_id = m.id and r.status in ('planned', 'active', 'overdue') order by r.from_date limit 1) end
  ))
$$;

-- Machine list: project, next action, inspection.
create or replace function app.machine_list_extras(m public.machines, p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'has_active_financing', (app.active_financing(m.id)).id is not null,
    'active_flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
    'open_transfer_status', (select t.status from public.transfers t where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1),
    'project', (select a.name from public.machine_assignments a where a.machine_id = m.id and a.org_id = p_org and a.to_date is null limit 1),
    'next_action', (select jsonb_build_object('title', r.title, 'type', r.type, 'due_at', r.due_at, 'due_hours', r.due_hours)
      from public.reminders r where r.machine_id = m.id and r.org_id = p_org and r.status = 'open' order by r.due_at nulls last limit 1),
    'inspection_valid_until', case when m.has_lifting_device then app.inspection_valid_until(m.id) end)
$$;

-- ---------- Encumbrance / temporary registration reminders ----------
create or replace function app.after_encumbrance_change(p_encumbrance_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.encumbrances; m public.machines;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id;
  select * into m from public.machines where id = e.machine_id;
  if e.status = 'active' and e.end_date is not null and m.owner_org_id is not null and e.type in ('leasing', 'ownership_reservation') then
    perform app.upsert_reminder(m.owner_org_id, m.id, case when e.type = 'leasing' then 'lease_end' else 'encumbrance_end' end::public.reminder_type,
      case when e.type = 'leasing' then 'Leasing slutar' else 'Förbehåll slutar' end, e.end_date, null, e.id);
    perform app.upsert_reminder(e.holder_org_id, m.id, 'encumbrance_end', 'Förbehåll slutar', e.end_date, null, e.id);
  elsif e.status in ('released', 'rejected', 'transferred') then
    update public.reminders set status = 'done', done_at = now() where source_id = e.id and status <> 'done';
  end if;
end $$;

-- ---------- Fleet / procurement report ----------
create or replace function app.fleet_report_rows(p_org uuid, p_project_id uuid, p_kind text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(case when p_kind = 'project_list' then
      jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year, 'category', m.category,
        'verification_level', m.verification_level, 'status', m.status, 'project', a.name)
    else
      jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year, 'category', m.category,
        'emission_stage', m.emission_stage, 'fuel_type', m.fuel_type, 'electric_config', m.electric_config,
        'service_weight_kg', m.service_weight_kg, 'engine_power_kw', m.engine_power_kw, 'hour_meter', m.hour_meter,
        'has_lifting_device', m.has_lifting_device, 'inspection_valid_until', app.inspection_valid_until(m.id),
        'verification_level', m.verification_level, 'status', m.status, 'project', a.name)
    end order by a.name nulls last, m.make, m.model, m.reg_number), '[]'::jsonb)
  from public.machines m
  left join public.machine_assignments a on a.machine_id = m.id and a.org_id = p_org and a.to_date is null
  where (m.owner_org_id = p_org or m.user_org_id = p_org) and m.status not in ('draft', 'scrapped', 'exported', 'deregistered')
    and (p_project_id is null or a.project_id = p_project_id)
$$;

create or replace function app.fleet_report(p_org uuid, p_project_id uuid, p_kind text default 'fleet_report')
returns jsonb language sql stable security definer set search_path = '' as $$
  with rows as (select app.fleet_report_rows(p_org, p_project_id, p_kind) r)
  select jsonb_build_object('org_name', (select name from public.organizations where id = p_org),
    'org_number', app.org_number_display(p_org),
    'project', (select jsonb_build_object('name', name, 'site_address', site_address, 'reference', reference) from public.projects where id = p_project_id),
    'kind', p_kind, 'generated_at', app.iso_ts(now()), 'machines', rows.r,
    'summary', jsonb_build_object(
      'count', jsonb_array_length(rows.r),
      'stage_v_or_zero', (select count(*) from jsonb_array_elements(rows.r) x where x ->> 'emission_stage' in ('stage_v', 'zero_emission')),
      'electric', (select count(*) from jsonb_array_elements(rows.r) x where x ->> 'fuel_type' in ('electric', 'hybrid', 'hydrogen')),
      'hvo', (select count(*) from jsonb_array_elements(rows.r) x where x ->> 'fuel_type' = 'hvo'),
      'level_2', (select count(*) from jsonb_array_elements(rows.r) x where (x ->> 'verification_level')::int = 2),
      'inspection_due', (select count(*) from jsonb_array_elements(rows.r) x where (x ->> 'has_lifting_device')::boolean and x ->> 'inspection_valid_until' is null)))
  from rows
$$;

-- Live report for the owner's UI.
create or replace function public.get_fleet_report(p_org_id uuid, p_project_id uuid default null, p_kind text default 'fleet_report')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if p_kind not in ('fleet_report', 'project_list') then perform app.raise('VALIDATION', '{"field":"kind"}'); end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and org_id = actor) then perform app.raise('NOT_FOUND'); end if;
  return app.fleet_report(actor, p_project_id, p_kind);
end $$;

-- Snapshot with number + SHA-256 for the PDF ("signed" report, verifiable at /receipt).
create or replace function public.create_fleet_report(p_org_id uuid, p_project_id uuid default null, p_kind text default 'fleet_report')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); res jsonb; rn text; s public.report_snapshots;
begin
  res := public.get_fleet_report(actor, p_project_id, p_kind);
  rn := 'F-' || to_char(now() at time zone 'Europe/Stockholm', 'YYYY') || '-' || lpad(nextval('public.fleet_report_seq')::text, 6, '0');
  insert into public.report_snapshots (kind, report_number, org_id, params, result, result_hash, created_by_user_id)
  values (p_kind, rn, actor, jsonb_strip_nulls(jsonb_build_object('project_id', p_project_id)), res, app.sha256_hex(rn || '|' || res::text), auth.uid())
  returning * into s;
  perform app.log_event('report.created', null, actor, actor, jsonb_build_object('report_number', rn, 'kind', p_kind, 'project_id', p_project_id,
    'machines', jsonb_array_length(res -> 'machines')));
  return jsonb_build_object('report_number', s.report_number, 'created_at', s.created_at, 'result_hash', s.result_hash, 'result', s.result);
end $$;

-- Anyone holding a report can confirm it (number + hash), like check receipts.
create or replace function public.verify_report(p_report_number text, p_result_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.report_snapshots;
begin
  if not app.rate_limit_hit('report_verify:' || coalesce(auth.uid()::text,
       app.sha256_hex(coalesce(split_part(app.request_header('x-forwarded-for'), ',', 1), 'anon'))), 60, interval '1 hour') then
    perform app.raise('RATE_LIMITED');
  end if;
  select * into s from public.report_snapshots where report_number = upper(trim(p_report_number)) and result_hash = lower(trim(p_result_hash));
  if s.id is null then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', true, 'report_number', s.report_number, 'kind', s.kind, 'created_at', s.created_at,
    'org_name', s.result ->> 'org_name', 'machines', jsonb_array_length(s.result -> 'machines'));
end $$;

-- Share link view (scope fleet_report / project_list; params.project_id optional).
create or replace function app.shared_fleet_view(s public.share_links)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app.fleet_report(s.org_id, nullif(s.params ->> 'project_id', '')::uuid, s.scope::text)
$$;

-- Client orgs (beställare) follow a report continuously.
create or replace function public.grant_report_access(p_org_id uuid, p_client_org_id uuid, p_project_id uuid default null, p_kind text default 'fleet_report')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); g public.report_grants;
begin
  if p_kind not in ('fleet_report', 'project_list') then perform app.raise('VALIDATION', '{"field":"kind"}'); end if;
  if not app.has_org_type(p_client_org_id, 'client') then perform app.raise('VALIDATION', '{"field":"client_org_id"}'); end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and org_id = actor) then perform app.raise('NOT_FOUND'); end if;
  insert into public.report_grants (owner_org_id, client_org_id, project_id, kind, created_by_user_id)
  values (actor, p_client_org_id, p_project_id, p_kind, auth.uid())
  on conflict do nothing returning * into g;
  if g.id is null then perform app.raise('VALIDATION', '{"reason":"already_granted"}'); end if;
  perform app.log_event('report_grant.created', null, actor, actor, jsonb_build_object('grant_id', g.id, 'client_org_id', p_client_org_id,
    'project_id', p_project_id, 'kind', p_kind));
  perform app.notify_org(p_client_org_id, 'report_grant.created', jsonb_build_object('grant_id', g.id,
    'owner', (select name from public.organizations where id = actor), 'project', (select name from public.projects where id = p_project_id)),
    '/client-reports', 'info');
  return jsonb_build_object('ok', true, 'grant', to_jsonb(g));
end $$;

create or replace function public.revoke_report_access(p_org_id uuid, p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); g public.report_grants;
begin
  update public.report_grants set revoked_at = now() where id = p_grant_id and owner_org_id = actor and revoked_at is null returning * into g;
  if g.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('report_grant.revoked', null, actor, actor, jsonb_build_object('grant_id', g.id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_report_grants(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'created_at', g.created_at, 'revoked_at', g.revoked_at,
      'direction', case when g.owner_org_id = actor then 'out' else 'in' end,
      'owner', app.org_brief(g.owner_org_id), 'client', app.org_brief(g.client_org_id),
      'project', (select jsonb_build_object('id', p.id, 'name', p.name) from public.projects p where p.id = g.project_id)) order by g.created_at desc)
    from public.report_grants g where (g.owner_org_id = actor or g.client_org_id = actor) and g.revoked_at is null), '[]'::jsonb);
end $$;

create or replace function public.get_client_report(p_org_id uuid, p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); g public.report_grants;
begin
  select * into g from public.report_grants where id = p_grant_id and client_org_id = actor and revoked_at is null;
  if g.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('report.viewed', null, g.owner_org_id, actor, jsonb_build_object('grant_id', g.id));
  return app.fleet_report(g.owner_org_id, g.project_id, g.kind);
end $$;

-- Org setting: show the inspection badge publicly (SPEC §7.1 "publikt om ägaren väljer").
create or replace function public.set_public_inspection_badge(p_org_id uuid, p_show boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin');
begin
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('show_inspection_publicly', coalesce(p_show, false))
  where id = actor;
  return jsonb_build_object('ok', true, 'show_inspection_publicly', coalesce(p_show, false));
end $$;

-- Directory of approved partner organisations of one type (financiers, insurers, clients, inspection bodies,
-- dealers) for pickers. Business names only; owners are never listed.
create or replace function public.list_partner_orgs(p_type public.org_type)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null and app.current_api_key_id() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_type not in ('financier', 'insurer', 'client', 'inspector', 'dealer') then perform app.raise('VALIDATION', '{"field":"type"}'); end if;
  return coalesce((select jsonb_agg(app.org_brief(o.id) order by o.name) from (
    select id, name from public.organizations where status = 'approved' and p_type = any (types) order by name limit 500) o), '[]'::jsonb);
end $$;

grant execute on function
  public.list_partner_orgs(public.org_type),
  public.record_hours(uuid, uuid, int, date, boolean), public.add_maintenance(uuid, uuid, jsonb), public.list_maintenance(uuid, uuid),
  public.record_inspection(uuid, uuid, jsonb), public.list_inspections(uuid, uuid),
  public.list_reminders(uuid, boolean, uuid), public.create_reminder(uuid, uuid, text, date, int), public.update_reminder(uuid, uuid, text, date),
  public.save_project(uuid, jsonb, uuid), public.list_projects(uuid, boolean), public.assign_machine(uuid, uuid, uuid, date),
  public.add_insurance_policy(uuid, uuid, jsonb), public.list_insurance_policies(uuid, uuid),
  public.create_rental(uuid, uuid, uuid, date, date, text), public.return_rental(uuid, uuid), public.list_rentals(uuid),
  public.get_fleet_report(uuid, uuid, text), public.create_fleet_report(uuid, uuid, text),
  public.grant_report_access(uuid, uuid, uuid, text), public.revoke_report_access(uuid, uuid), public.list_report_grants(uuid),
  public.get_client_report(uuid, uuid), public.set_public_inspection_badge(uuid, boolean)
  to authenticated;
grant execute on function public.verify_report(text, text) to anon, authenticated;
