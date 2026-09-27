-- Step 20 (interpreted from CLAUDE.md, ADR 0003 / 0017): attachments (redskap), operators (förare) with certificates,
-- daily checks with checklist templates, operational status, fuel and climate report. Fleet data: readable by the
-- organisation that keeps it; the machine's owner/user write it through RPCs. No amounts, no personal numbers.

-- ---------- Operational status ----------
alter table public.machines add column operational_status text not null default 'operational'
  check (operational_status in ('operational', 'restricted', 'out_of_service'));
alter table public.machines add column operational_status_reason text;
alter table public.machines add column operational_status_at timestamptz;

create or replace function app.set_operational_status(p_machine uuid, p_actor uuid, p_status text, p_reason text, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.machines;
begin
  update public.machines set operational_status = p_status, operational_status_reason = left(nullif(trim(p_reason), ''), 300),
    operational_status_at = now() where id = p_machine and operational_status is distinct from p_status returning * into m;
  if m.id is null then return; end if;
  perform app.log_event('machine.operational_status_changed', m.id, m.owner_org_id, p_actor,
    jsonb_build_object('status', p_status, 'source', p_source));
  if p_status = 'out_of_service' then
    perform app.notify_org(x, 'machine.out_of_service', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'reason', m.operational_status_reason),
      '/machines/' || m.id, 'warning', 'member')
    from (select distinct unnest(array_remove(array[m.owner_org_id, m.user_org_id], null)) x) o;
  end if;
end $$;

create or replace function public.set_operational_status(p_org_id uuid, p_machine_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines;
begin
  m := app.require_fleet_access(p_machine_id, actor);
  if p_status not in ('operational', 'restricted', 'out_of_service') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  if p_status <> 'operational' and nullif(trim(p_reason), '') is null then perform app.raise('VALIDATION', '{"field":"reason"}'); end if;
  perform app.set_operational_status(m.id, actor, p_status, p_reason, 'manual');
  return jsonb_build_object('ok', true, 'operational_status', p_status);
end $$;

-- ---------- Attachments (redskap) ----------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id),
  type          text not null check (type in ('bucket', 'ditch_bucket', 'hammer', 'grapple', 'fork', 'tiltrotator', 'quick_coupler',
                  'ripper', 'compactor', 'auger', 'mower', 'snow_plough', 'sweeper', 'other')),
  make          text check (length(make) <= 100),
  model         text check (length(model) <= 100),
  serial        text check (length(serial) <= 64),
  year          int check (year between 1950 and 2100),
  weight_kg     int check (weight_kg between 0 and 100000),
  notes         text check (length(notes) <= 1000),
  machine_id    uuid references public.machines (id),
  mounted_at    timestamptz,
  status        text not null default 'active' check (status in ('active', 'retired')),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index attachments_org_idx on public.attachments (org_id);
create index attachments_machine_idx on public.attachments (machine_id) where machine_id is not null;

create table public.attachment_mounts (
  id            uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  machine_id    uuid not null references public.machines (id),
  from_at       timestamptz not null default now(),
  to_at         timestamptz,
  by_user_id    uuid
);

-- ---------- Operators (förare) ----------
create table public.operators (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id),
  name          text not null check (length(trim(name)) between 2 and 120),
  employee_ref  text check (length(employee_ref) <= 40),    -- anställningsnummer; never a personal identity number
  user_id       uuid references auth.users (id),            -- optional login for daily checks
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (employee_ref is null or employee_ref !~ '^\s*(\d{6}|\d{8})[-+]?\d{4}\s*$')
);
create index operators_org_idx on public.operators (org_id);

create table public.operator_certificates (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references public.operators (id) on delete cascade,
  type          text not null check (type in ('machine_operator_licence', 'forklift', 'crane', 'aerial_platform', 'loader_crane',
                  'road_safety', 'hot_work', 'first_aid', 'ykb', 'other')),
  label         text check (length(label) <= 120),
  issued_at     date,
  valid_until   date,
  document_id   uuid references public.documents (id),
  created_at    timestamptz not null default now()
);

create table public.machine_operators (
  id            uuid primary key default gen_random_uuid(),
  machine_id    uuid not null references public.machines (id),
  org_id        uuid not null references public.organizations (id),
  operator_id   uuid not null references public.operators (id),
  from_at       timestamptz not null default now(),
  to_at         timestamptz
);
create unique index machine_operators_current on public.machine_operators (machine_id, org_id) where to_at is null;

-- ---------- Daily checks ----------
create table public.checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.organizations (id),   -- null = built-in template
  name          text not null check (length(trim(name)) between 2 and 120),
  categories    public.machine_category[] not null default '{}', -- empty = all categories
  items         jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.daily_checks (
  id            uuid primary key default gen_random_uuid(),
  machine_id    uuid not null references public.machines (id),
  org_id        uuid not null references public.organizations (id),
  operator_id   uuid references public.operators (id),
  user_id       uuid not null,
  template_id   uuid references public.checklist_templates (id),
  template_name text not null,
  items         jsonb not null,   -- template snapshot
  answers       jsonb not null,   -- [{ id, ok, note }]
  hours         int,
  result        text not null check (result in ('ok', 'remarks', 'failed')),
  note          text check (length(note) <= 1000),
  created_at    timestamptz not null default now()
);
create index daily_checks_machine_idx on public.daily_checks (machine_id, created_at desc);

-- ---------- Fuel and climate ----------
create table public.fuel_entries (
  id            uuid primary key default gen_random_uuid(),
  machine_id    uuid not null references public.machines (id),
  org_id        uuid not null references public.organizations (id),
  entry_date    date not null,
  fuel          text not null check (fuel in ('diesel', 'hvo100', 'rme', 'petrol', 'biogas', 'electricity', 'other')),
  quantity      numeric(12, 2) not null check (quantity > 0 and quantity < 1000000),
  unit          text not null check (unit in ('l', 'kWh', 'kg')),
  hours         int check (hours >= 0),
  project_id    uuid references public.projects (id),
  note          text check (length(note) <= 300),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check ((fuel = 'electricity') = (unit = 'kWh'))
);
create index fuel_entries_org_idx on public.fuel_entries (org_id, entry_date);
create index fuel_entries_machine_idx on public.fuel_entries (machine_id, entry_date desc);

-- Emission factors (kg CO2e per unit, well-to-wheel). Defaults are assumptions to be confirmed (docs/OPEN_QUESTIONS.md);
-- a superadmin changes them in operator admin, and every report stores the factors it used.
insert into public.app_config (key, value, description) values
  ('EMISSION_FACTORS', '{"diesel": 2.95, "hvo100": 0.52, "rme": 1.10, "petrol": 2.80, "biogas": 0.60, "electricity": 0.04, "other": 2.95}',
   'Emission factors, kg CO2e per l/kg/kWh (well-to-wheel). Assumed defaults – confirm source before customer use.')
on conflict (key) do nothing;

alter table public.attachments enable row level security;
alter table public.attachment_mounts enable row level security;
alter table public.operators enable row level security;
alter table public.operator_certificates enable row level security;
alter table public.machine_operators enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.daily_checks enable row level security;
alter table public.fuel_entries enable row level security;
revoke all on public.attachments, public.attachment_mounts, public.operators, public.operator_certificates, public.machine_operators,
  public.checklist_templates, public.daily_checks, public.fuel_entries from anon, authenticated;
grant select on public.attachments, public.attachment_mounts, public.operators, public.operator_certificates, public.machine_operators,
  public.checklist_templates, public.daily_checks, public.fuel_entries to authenticated;
create policy attachments_read on public.attachments for select to authenticated using (org_id = any (app.current_org_ids()));
create policy attachment_mounts_read on public.attachment_mounts for select to authenticated using (
  exists (select 1 from public.attachments a where a.id = attachment_id and a.org_id = any (app.current_org_ids())));
create policy operators_read on public.operators for select to authenticated using (org_id = any (app.current_org_ids()));
create policy operator_certificates_read on public.operator_certificates for select to authenticated using (
  exists (select 1 from public.operators o where o.id = operator_id and o.org_id = any (app.current_org_ids())));
create policy machine_operators_read on public.machine_operators for select to authenticated using (org_id = any (app.current_org_ids()));
create policy checklist_templates_read on public.checklist_templates for select to authenticated using (org_id is null or org_id = any (app.current_org_ids()));
-- Daily checks follow the machine like service history (owner, user, full-access parties).
create policy daily_checks_read on public.daily_checks for select to authenticated using (
  org_id = any (app.current_org_ids()) or app.has_full_access(app.machine_relations(machine_id)));
create policy fuel_entries_read on public.fuel_entries for select to authenticated using (org_id = any (app.current_org_ids()));

-- Built-in checklists (Swedish/English labels in the items; orgs copy and adapt them).
insert into public.checklist_templates (org_id, name, categories, items) values
  (null, 'Daglig kontroll – grundmaskin', '{}', '[
    {"id":"walkaround","sv":"Runtomkontroll: skador, läckage, lösa delar","en":"Walk-around: damage, leaks, loose parts","critical":false},
    {"id":"fluids","sv":"Motorolja, kylvätska och hydraulolja på rätt nivå","en":"Engine oil, coolant and hydraulic oil at correct level","critical":false},
    {"id":"leaks","sv":"Inga hydraulläckage eller skadade slangar","en":"No hydraulic leaks or damaged hoses","critical":true},
    {"id":"tracks","sv":"Band/däck och hjulbultar utan anmärkning","en":"Tracks/tyres and wheel nuts without remarks","critical":false},
    {"id":"brakes","sv":"Bromsar och parkeringsbroms fungerar","en":"Brakes and parking brake work","critical":true},
    {"id":"steering","sv":"Styrning och reglage fungerar","en":"Steering and controls work","critical":true},
    {"id":"lights","sv":"Belysning, varningsljus och backvarnare fungerar","en":"Lights, beacon and reverse alarm work","critical":false},
    {"id":"cab","sv":"Hytt, fönster, speglar och kamera rena och hela","en":"Cab, windows, mirrors and camera clean and intact","critical":false},
    {"id":"seatbelt","sv":"Bilbälte och nödstopp fungerar","en":"Seat belt and emergency stop work","critical":true},
    {"id":"extinguisher","sv":"Brandsläckare finns och är kontrollerad","en":"Fire extinguisher present and inspected","critical":false},
    {"id":"coupler","sv":"Redskapsfäste låst och säkrat","en":"Attachment coupler locked and secured","critical":true}]'),
  (null, 'Daglig kontroll – lyftanordning', array['crane_mobile', 'telehandler', 'forklift']::public.machine_category[], '[
    {"id":"walkaround","sv":"Runtomkontroll: skador, läckage, lösa delar","en":"Walk-around: damage, leaks, loose parts","critical":false},
    {"id":"load_chart","sv":"Lastdiagram finns i hytten","en":"Load chart available in the cab","critical":false},
    {"id":"limiter","sv":"Överlastskydd/lastmomentbegränsare fungerar","en":"Overload protection / load moment limiter works","critical":true},
    {"id":"hooks","sv":"Krok, spärr och lyftredskap utan skador","en":"Hook, latch and lifting gear undamaged","critical":true},
    {"id":"outriggers","sv":"Stödben fungerar och är hela","en":"Outriggers work and are intact","critical":true},
    {"id":"brakes","sv":"Bromsar och parkeringsbroms fungerar","en":"Brakes and parking brake work","critical":true},
    {"id":"lights","sv":"Belysning, varningsljus och backvarnare fungerar","en":"Lights, beacon and reverse alarm work","critical":false},
    {"id":"inspection","sv":"Periodisk besiktning giltig","en":"Periodic inspection valid","critical":true}]');

-- ---------- RPCs: attachments ----------
create or replace function public.save_attachment(p_org_id uuid, p_data jsonb, p_attachment_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); a public.attachments;
begin
  if p_attachment_id is null then
    insert into public.attachments (org_id, type, make, model, serial, year, weight_kg, notes, created_by)
    values (actor, coalesce(p_data ->> 'type', 'other'), nullif(trim(p_data ->> 'make'), ''), nullif(trim(p_data ->> 'model'), ''),
      nullif(trim(p_data ->> 'serial'), ''), nullif(p_data ->> 'year', '')::int, nullif(p_data ->> 'weight_kg', '')::int, nullif(trim(p_data ->> 'notes'), ''), auth.uid())
    returning * into a;
  else
    update public.attachments set type = coalesce(p_data ->> 'type', type), make = nullif(trim(p_data ->> 'make'), ''), model = nullif(trim(p_data ->> 'model'), ''),
      serial = nullif(trim(p_data ->> 'serial'), ''), year = nullif(p_data ->> 'year', '')::int, weight_kg = nullif(p_data ->> 'weight_kg', '')::int,
      notes = nullif(trim(p_data ->> 'notes'), ''), status = coalesce(p_data ->> 'status', status)
    where id = p_attachment_id and org_id = actor returning * into a;
    if a.id is null then perform app.raise('NOT_FOUND'); end if;
    if a.status = 'retired' and a.machine_id is not null then perform public.mount_attachment(actor, a.id, null); end if;
  end if;
  return to_jsonb(a);
exception when check_violation or invalid_text_representation then
  perform app.raise('VALIDATION', '{"field":"attachment"}');
end $$;

create or replace function public.mount_attachment(p_org_id uuid, p_attachment_id uuid, p_machine_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); a public.attachments; m public.machines;
begin
  select * into a from public.attachments where id = p_attachment_id and org_id = actor for update;
  if a.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_machine_id is not null then
    m := app.require_fleet_access(p_machine_id, actor);
    if a.status <> 'active' then perform app.raise('INVALID_STATE'); end if;
  end if;
  if a.machine_id is not null then
    update public.attachment_mounts set to_at = now() where attachment_id = a.id and to_at is null;
    perform app.log_event('attachment.unmounted', a.machine_id, (select owner_org_id from public.machines where id = a.machine_id), actor,
      jsonb_build_object('attachment_id', a.id, 'type', a.type));
  end if;
  update public.attachments set machine_id = p_machine_id, mounted_at = case when p_machine_id is null then null else now() end where id = a.id returning * into a;
  if p_machine_id is not null then
    insert into public.attachment_mounts (attachment_id, machine_id, by_user_id) values (a.id, m.id, auth.uid());
    perform app.log_event('attachment.mounted', m.id, m.owner_org_id, actor, jsonb_build_object('attachment_id', a.id, 'type', a.type,
      'make', a.make, 'model', a.model));
  end if;
  return to_jsonb(a);
end $$;

create or replace function public.list_attachments(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('machine', (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number,
      'make', m.make, 'model', m.model) from public.machines m where m.id = a.machine_id)) order by a.status, a.type, a.make)
    from public.attachments a where a.org_id = actor), '[]'::jsonb);
end $$;

-- ---------- RPCs: operators ----------
create or replace function public.save_operator(p_org_id uuid, p_data jsonb, p_operator_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); o public.operators; uid uuid := nullif(p_data ->> 'user_id', '')::uuid;
begin
  -- A linked login must be an active member of the org.
  if uid is not null and not exists (select 1 from public.memberships where org_id = actor and user_id = uid and status = 'active') then
    perform app.raise('VALIDATION', '{"field":"user_id"}');
  end if;
  if p_operator_id is null then
    insert into public.operators (org_id, name, employee_ref, user_id) values (actor, trim(p_data ->> 'name'), nullif(trim(p_data ->> 'employee_ref'), ''), uid)
    returning * into o;
  else
    update public.operators set name = coalesce(nullif(trim(p_data ->> 'name'), ''), name), employee_ref = nullif(trim(p_data ->> 'employee_ref'), ''),
      user_id = uid, active = coalesce((p_data ->> 'active')::boolean, active)
    where id = p_operator_id and org_id = actor returning * into o;
    if o.id is null then perform app.raise('NOT_FOUND'); end if;
    if not o.active then update public.machine_operators set to_at = now() where operator_id = o.id and to_at is null; end if;
  end if;
  return to_jsonb(o);
exception when check_violation or not_null_violation then
  perform app.raise('VALIDATION', '{"field":"operator"}');
end $$;

create or replace function public.add_operator_certificate(p_org_id uuid, p_operator_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); c public.operator_certificates;
begin
  if not exists (select 1 from public.operators where id = p_operator_id and org_id = actor) then perform app.raise('NOT_FOUND'); end if;
  insert into public.operator_certificates (operator_id, type, label, issued_at, valid_until, document_id)
  values (p_operator_id, coalesce(p_data ->> 'type', 'other'), nullif(trim(p_data ->> 'label'), ''), nullif(p_data ->> 'issued_at', '')::date,
    nullif(p_data ->> 'valid_until', '')::date, nullif(p_data ->> 'document_id', '')::uuid) returning * into c;
  return to_jsonb(c);
exception when check_violation or invalid_text_representation then
  perform app.raise('VALIDATION', '{"field":"certificate"}');
end $$;

create or replace function public.remove_operator_certificate(p_org_id uuid, p_certificate_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin');
begin
  delete from public.operator_certificates c using public.operators o where c.id = p_certificate_id and o.id = c.operator_id and o.org_id = actor;
  if not found then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_operators(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'employee_ref', o.employee_ref, 'user_id', o.user_id, 'active', o.active,
      'user_name', (select full_name from public.profiles where user_id = o.user_id),
      'certificates', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('expired', c.valid_until < current_date,
          'expiring', c.valid_until between current_date and current_date + 60) order by c.valid_until nulls last)
        from public.operator_certificates c where c.operator_id = o.id), '[]'::jsonb),
      'machines', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model))
        from public.machine_operators mo join public.machines m on m.id = mo.machine_id where mo.operator_id = o.id and mo.to_at is null), '[]'::jsonb))
    order by o.active desc, o.name) from public.operators o where o.org_id = actor), '[]'::jsonb);
end $$;

create or replace function public.assign_operator(p_org_id uuid, p_machine_id uuid, p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines;
begin
  m := app.require_fleet_access(p_machine_id, actor);
  if p_operator_id is not null and not exists (select 1 from public.operators where id = p_operator_id and org_id = actor and active) then
    perform app.raise('NOT_FOUND', '{"what":"operator"}');
  end if;
  update public.machine_operators set to_at = now() where machine_id = m.id and org_id = actor and to_at is null;
  if p_operator_id is not null then
    insert into public.machine_operators (machine_id, org_id, operator_id) values (m.id, actor, p_operator_id);
  end if;
  perform app.log_event('machine.operator_assigned', m.id, m.owner_org_id, actor, jsonb_build_object('assigned', p_operator_id is not null));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- RPCs: checklists and daily checks ----------
create or replace function public.list_checklist_templates(p_org_id uuid, p_machine_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); cat public.machine_category;
begin
  select category into cat from public.machines where id = p_machine_id;
  return coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('builtin', t.org_id is null)
      order by (t.org_id is null), (cat is not null and cat = any (t.categories)) desc, t.name)
    from public.checklist_templates t where t.active and (t.org_id is null or t.org_id = actor)
      and (cat is null or cardinality(t.categories) = 0 or cat = any (t.categories))), '[]'::jsonb);
end $$;

create or replace function public.save_checklist_template(p_org_id uuid, p_data jsonb, p_template_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); t public.checklist_templates; v_items jsonb := p_data -> 'items';
begin
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 or exists (select 1 from jsonb_array_elements(v_items) i
       where nullif(trim(i ->> 'id'), '') is null or nullif(trim(coalesce(i ->> 'sv', i ->> 'en')), '') is null) then
    perform app.raise('VALIDATION', '{"field":"items"}');
  end if;
  if p_template_id is null then
    insert into public.checklist_templates (org_id, name, categories, items)
    values (actor, trim(p_data ->> 'name'), coalesce((select array_agg(x::public.machine_category) from jsonb_array_elements_text(p_data -> 'categories') x), '{}'), v_items)
    returning * into t;
  else
    update public.checklist_templates set name = coalesce(nullif(trim(p_data ->> 'name'), ''), name), items = v_items,
      categories = coalesce((select array_agg(x::public.machine_category) from jsonb_array_elements_text(p_data -> 'categories') x), '{}'),
      active = coalesce((p_data ->> 'active')::boolean, active)
    where id = p_template_id and org_id = actor returning * into t;
    if t.id is null then perform app.raise('NOT_FOUND'); end if;
  end if;
  return to_jsonb(t);
exception when check_violation or not_null_violation or invalid_text_representation then
  perform app.raise('VALIDATION', '{"field":"template"}');
end $$;

-- A failed critical item takes the machine out of service and notifies the owner/user (daily check = "daglig tillsyn").
create or replace function public.submit_daily_check(p_org_id uuid, p_machine_id uuid, p_template_id uuid, p_answers jsonb,
  p_hours int default null, p_operator_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member'); m public.machines; t public.checklist_templates; res text; failed jsonb; c public.daily_checks;
  missing int;
begin
  m := app.require_fleet_access(p_machine_id, actor);
  select * into t from public.checklist_templates where id = p_template_id and active and (org_id is null or org_id = actor);
  if t.id is null then perform app.raise('NOT_FOUND', '{"what":"template"}'); end if;
  if jsonb_typeof(p_answers) <> 'array' then perform app.raise('VALIDATION', '{"field":"answers"}'); end if;
  -- Every item must be answered.
  select count(*) into missing from jsonb_array_elements(t.items) i
  where not exists (select 1 from jsonb_array_elements(p_answers) a where a ->> 'id' = i ->> 'id' and jsonb_typeof(a -> 'ok') = 'boolean');
  if missing > 0 then perform app.raise('VALIDATION', jsonb_build_object('field', 'answers', 'missing', missing)); end if;
  if p_operator_id is not null and not exists (select 1 from public.operators where id = p_operator_id and org_id = actor) then
    perform app.raise('NOT_FOUND', '{"what":"operator"}');
  end if;
  select coalesce(jsonb_agg(i ->> 'id'), '[]'::jsonb) into failed from jsonb_array_elements(t.items) i
  where coalesce((i ->> 'critical')::boolean, false)
    and exists (select 1 from jsonb_array_elements(p_answers) a where a ->> 'id' = i ->> 'id' and not (a ->> 'ok')::boolean);
  res := case when jsonb_array_length(failed) > 0 then 'failed'
              when exists (select 1 from jsonb_array_elements(p_answers) a where not (a ->> 'ok')::boolean) then 'remarks' else 'ok' end;
  insert into public.daily_checks (machine_id, org_id, operator_id, user_id, template_id, template_name, items, answers, hours, result, note)
  values (m.id, actor, p_operator_id, auth.uid(), t.id, t.name, t.items,
    (select jsonb_agg(jsonb_build_object('id', a ->> 'id', 'ok', (a ->> 'ok')::boolean, 'note', left(a ->> 'note', 300))) from jsonb_array_elements(p_answers) a),
    p_hours, res, left(nullif(trim(p_note), ''), 1000)) returning * into c;
  if p_hours is not null and p_hours > coalesce(m.hour_meter, 0) then
    perform public.record_hours(actor, m.id, p_hours, current_date);
  end if;
  perform app.log_event('machine.daily_check', m.id, m.owner_org_id, actor, jsonb_build_object('check_id', c.id, 'result', res));
  if res = 'failed' then
    perform app.set_operational_status(m.id, actor, 'out_of_service', 'Daglig kontroll: ' || (select string_agg(i ->> 'sv', ', ')
      from jsonb_array_elements(t.items) i where failed ? (i ->> 'id')), 'daily_check');
  elsif m.operational_status = 'out_of_service' and m.operational_status_reason like 'Daglig kontroll:%' and res = 'ok' then
    -- A clean check lifts a stop that a daily check caused (manual stops need a manual release).
    perform app.set_operational_status(m.id, actor, 'operational', null, 'daily_check');
  end if;
  return jsonb_build_object('ok', true, 'id', c.id, 'result', res, 'failed_items', failed,
    'operational_status', (select operational_status from public.machines where id = m.id));
end $$;

create or replace function public.list_daily_checks(p_org_id uuid, p_machine_id uuid default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if p_machine_id is not null then perform app.require_fleet_access(p_machine_id, actor); end if;
  return coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' || jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model,
      'operator', (select name from public.operators where id = c.operator_id), 'by', (select full_name from public.profiles where user_id = c.user_id))
      order by c.created_at desc)
    from (select * from public.daily_checks d where (p_machine_id is null and d.org_id = actor) or d.machine_id = p_machine_id
          order by d.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) c
    join public.machines m on m.id = c.machine_id), '[]'::jsonb);
end $$;

-- ---------- RPCs: fuel and climate ----------
create or replace function public.log_fuel(p_org_id uuid, p_machine_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; f public.fuel_entries; fuel text := coalesce(p_data ->> 'fuel', 'diesel');
begin
  m := app.require_fleet_access(p_machine_id, actor);
  insert into public.fuel_entries (machine_id, org_id, entry_date, fuel, quantity, unit, hours, project_id, note, created_by)
  values (m.id, actor, coalesce(nullif(p_data ->> 'entry_date', '')::date, current_date), fuel, (p_data ->> 'quantity')::numeric,
    case fuel when 'electricity' then 'kWh' when 'biogas' then 'kg' else 'l' end, nullif(p_data ->> 'hours', '')::int,
    (select a.project_id from public.machine_assignments a where a.machine_id = m.id and a.org_id = actor and a.to_date is null limit 1),
    nullif(trim(p_data ->> 'note'), ''), auth.uid()) returning * into f;
  if f.entry_date > current_date then perform app.raise('VALIDATION', '{"field":"entry_date"}'); end if;
  if f.hours is not null and f.hours > coalesce(m.hour_meter, 0) then perform public.record_hours(actor, m.id, f.hours, f.entry_date); end if;
  perform app.log_event('fuel.logged', m.id, m.owner_org_id, actor, jsonb_build_object('entry_id', f.id, 'fuel', f.fuel));
  return to_jsonb(f);
exception when check_violation or invalid_text_representation or not_null_violation then
  perform app.raise('VALIDATION', '{"field":"fuel"}');
end $$;

create or replace function public.list_fuel(p_org_id uuid, p_machine_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model,
      'project', (select name from public.projects where id = f.project_id)) order by f.entry_date desc, f.created_at desc)
    from (select * from public.fuel_entries where org_id = actor and (p_machine_id is null or machine_id = p_machine_id)
          order by entry_date desc limit least(greatest(coalesce(p_limit, 200), 1), 2000)) f join public.machines m on m.id = f.machine_id), '[]'::jsonb);
end $$;

create or replace function app.config_json(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$ select value from public.app_config where key = p_key $$;

-- Climate report for a period: energy by fuel, CO2e with the factors in force, per machine and per project, plus the
-- share of fossil-free energy. Stored as a numbered snapshot (C-) so the PDF can be verified like other documents.
create or replace function app.climate_data(p_org uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with f as (select e.*, coalesce((app.config_json('EMISSION_FACTORS') ->> e.fuel)::numeric, 0) factor from public.fuel_entries e
             where e.org_id = p_org and e.entry_date between p_from and p_to)
  select jsonb_build_object('from', p_from, 'to', p_to, 'factors', app.config_json('EMISSION_FACTORS'),
    'totals', jsonb_build_object('co2e_kg', coalesce(round(sum(quantity * factor)), 0), 'entries', count(*),
      'fossil_free_share', case when sum(quantity) filter (where unit = 'l') > 0
        then round(100 * coalesce(sum(quantity) filter (where fuel in ('hvo100', 'rme') and unit = 'l'), 0) / sum(quantity) filter (where unit = 'l'), 1) end),
    'by_fuel', coalesce((select jsonb_agg(jsonb_build_object('fuel', fuel, 'unit', unit, 'quantity', q, 'co2e_kg', round(co2)) order by co2 desc)
      from (select fuel, unit, sum(quantity) q, sum(quantity * factor) co2 from f group by 1, 2) x), '[]'::jsonb),
    'by_machine', coalesce((select jsonb_agg(jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'category', m.category,
        'emission_stage', m.emission_stage, 'quantity_l', ql, 'kwh', kwh, 'co2e_kg', round(co2), 'hours', hrs) order by co2 desc)
      from (select machine_id, sum(quantity) filter (where unit = 'l') ql, sum(quantity) filter (where unit = 'kWh') kwh, sum(quantity * factor) co2,
                   max(hours) - min(hours) hrs from f group by 1) x join public.machines m on m.id = x.machine_id), '[]'::jsonb),
    'by_project', coalesce((select jsonb_agg(jsonb_build_object('project', coalesce(p.name, '–'), 'co2e_kg', round(co2)) order by co2 desc)
      from (select project_id, sum(quantity * factor) co2 from f group by 1) x left join public.projects p on p.id = x.project_id), '[]'::jsonb))
  from f
$$;

create or replace function public.get_climate_report(p_org_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then perform app.raise('VALIDATION', '{"field":"period"}'); end if;
  return app.climate_data(actor, p_from, p_to);
end $$;

alter table public.report_snapshots drop constraint report_snapshots_kind_check;
alter table public.report_snapshots add constraint report_snapshots_kind_check
  check (kind in ('fleet_report', 'project_list', 'register_extract', 'ownership_certificate', 'machine_report', 'climate_report'));
create sequence public.climate_report_seq;
revoke all on sequence public.climate_report_seq from anon, authenticated;

create or replace function public.create_climate_report(p_org_id uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); s public.report_snapshots;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then perform app.raise('VALIDATION', '{"field":"period"}'); end if;
  s := app.snapshot('climate_report', 'C', 'public.climate_report_seq', actor, jsonb_build_object('from', p_from, 'to', p_to),
    app.climate_data(actor, p_from, p_to) || jsonb_build_object('org_name', (select name from public.organizations where id = actor), 'generated_at', app.iso_ts(now())));
  perform app.log_event('report.created', null, actor, actor, jsonb_build_object('report_number', s.report_number, 'kind', 'climate_report'));
  return jsonb_build_object('report_number', s.report_number, 'created_at', s.created_at, 'result_hash', s.result_hash, 'result', s.result);
end $$;

-- ---------- Machine views ----------
create or replace function app.machine_list_extras(m public.machines, p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'has_active_financing', (app.active_financing(m.id)).id is not null,
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
      where d.machine_id = m.id and d.org_id = p_org order by d.created_at desc limit 1))
$$;

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
      from public.rentals r where r.machine_id = m.id and r.status in ('planned', 'active', 'overdue') order by r.from_date limit 1) end,
    'market_listings', case when app.has_full_access(p_rel) or p_rel && array['insurer'] then nullif(app.market_listings_for(m.id), '[]'::jsonb) end,
    'operational', case when p_rel && array['owner', 'user', 'lessee', 'operator'] then jsonb_build_object('status', m.operational_status,
      'reason', m.operational_status_reason, 'at', m.operational_status_at) end,
    'attachments', case when p_rel && array['owner', 'user'] then (select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'make', a.make,
      'model', a.model, 'serial', a.serial, 'mounted_at', a.mounted_at)) from public.attachments a where a.machine_id = m.id and a.org_id = p_org_id) end,
    'operator', case when p_rel && array['owner', 'user'] then (select jsonb_build_object('id', o.id, 'name', o.name) from public.machine_operators mo
      join public.operators o on o.id = mo.operator_id where mo.machine_id = m.id and mo.org_id = p_org_id and mo.to_at is null limit 1) end
  )) || app.machine_view_insurance(m, p_rel)
$$;

grant execute on function public.set_operational_status(uuid, uuid, text, text), public.save_attachment(uuid, jsonb, uuid),
  public.mount_attachment(uuid, uuid, uuid), public.list_attachments(uuid), public.save_operator(uuid, jsonb, uuid),
  public.add_operator_certificate(uuid, uuid, jsonb), public.remove_operator_certificate(uuid, uuid), public.list_operators(uuid),
  public.assign_operator(uuid, uuid, uuid), public.list_checklist_templates(uuid, uuid), public.save_checklist_template(uuid, jsonb, uuid),
  public.submit_daily_check(uuid, uuid, uuid, jsonb, int, uuid, text), public.list_daily_checks(uuid, uuid, int), public.log_fuel(uuid, uuid, jsonb),
  public.list_fuel(uuid, uuid, int), public.get_climate_report(uuid, date, date), public.create_climate_report(uuid, date, date) to authenticated;
select app.grant_api_access();
