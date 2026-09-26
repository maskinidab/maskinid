-- =====================================================================
-- 0004 machines, identifiers, labels (SPEC §3, §4.2, §4.4 conflicts,
-- §4.7 oem_records, §5, §6.2)
-- =====================================================================

-- ---------- Tables ----------
create table public.machine_models (
  id           uuid primary key default gen_random_uuid(),
  make         text not null,
  model        text not null,
  category     public.machine_category not null,
  subcategory  text,
  weight_kg    int,
  engine_kw    numeric,
  fuel_type    public.fuel_type,
  emission_stage public.emission_stage,
  has_lifting_device boolean,
  aliases      text[] not null default '{}',
  source       public.model_source not null default 'manual',
  created_at   timestamptz not null default now(),
  unique (make, model)
);
create index machine_models_search_trgm on public.machine_models using gin ((make || ' ' || model) extensions.gin_trgm_ops);

create table public.machines (
  id                     uuid primary key default gen_random_uuid(),
  reg_number             text unique check (reg_number is null or app.is_valid_reg_number(reg_number)),
  model_id               uuid references public.machine_models (id),
  make                   text,
  model                  text,
  variant                text,
  year                   int check (year is null or year between 1900 and 2100),
  category               public.machine_category,
  color                  text,
  description            text,
  -- [v1.1] technical fields (Transportstyrelsen Bilaga 1)
  service_weight_kg      int check (service_weight_kg is null or service_weight_kg between 1 and 1000000),
  engine_power_kw        numeric check (engine_power_kw is null or engine_power_kw between 0 and 100000),
  power_standard         public.power_standard,
  has_lifting_device     boolean not null default false,
  fuel_type              public.fuel_type,
  electric_config        public.electric_config,
  emission_stage         public.emission_stage,
  engine_make            text,
  engine_model           text,
  engine_type_approval_no text,
  ce_marked              boolean,
  ce_declaration_document_id uuid,
  registration_type      public.registration_type not null default 'permanent',
  valid_until            date,
  origin_country         char(2),
  status                 public.machine_status not null default 'draft',
  verification_level     smallint not null default 0 check (verification_level between 0 and 2),
  verified_by_org_id     uuid references public.organizations (id),
  verified_at            timestamptz,
  verification_method    public.verification_method,
  origin                 public.machine_origin not null default 'retro',
  owner_org_id           uuid references public.organizations (id),
  user_org_id            uuid references public.organizations (id),
  registered_by_org_id   uuid references public.organizations (id),
  registered_by_user_id  uuid,
  first_sale_date        date,
  first_sale_dealer_org_id uuid references public.organizations (id),
  hour_meter             int check (hour_meter is null or hour_meter >= 0),
  hour_meter_updated_at  timestamptz,
  primary_photo_path     text,
  draft_data             jsonb,
  deregistered_at        timestamptz,
  deregistration_reason  public.deregistration_reason,
  stock_status           text check (stock_status in ('stock', 'sold', 'trade_in', 'demo')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (status = 'draft' or (reg_number is not null and owner_org_id is not null and make is not null and model is not null and category is not null)),
  check (registration_type = 'permanent' or valid_until is not null)
);
create index machines_owner_idx on public.machines (owner_org_id);
create index machines_user_idx on public.machines (user_org_id);
create index machines_registered_by_idx on public.machines (registered_by_org_id);
create index machines_status_idx on public.machines (status);
create index machines_make_model_trgm on public.machines using gin ((coalesce(make, '') || ' ' || coalesce(model, '')) extensions.gin_trgm_ops);
create trigger machines_updated before update on public.machines for each row execute function app.set_updated_at();

create table public.machine_identifiers (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines (id),
  type             public.identifier_type not null,
  value            text not null,
  normalized_value text not null,
  source           public.identifier_source not null default 'manual',
  verified         boolean not null default false,
  external_system  text,
  vtr_snapshot     jsonb,
  -- true while this identifier holds the unique slot: type in (pin, serial, vin), machine not scrapped/exported/
  -- deregistered/draft and not a duplicate held by a conflict. Maintained by triggers (SPEC §4.2).
  unique_active    boolean not null default false,
  conflict_id      uuid,
  created_at       timestamptz not null default now()
);
create unique index machine_identifiers_unique_active on public.machine_identifiers (type, normalized_value) where unique_active;
create index machine_identifiers_lookup on public.machine_identifiers (normalized_value);
create index machine_identifiers_trgm on public.machine_identifiers using gin (normalized_value extensions.gin_trgm_ops);
create index machine_identifiers_machine on public.machine_identifiers (machine_id);

create table public.ownerships (
  id           uuid primary key default gen_random_uuid(),
  machine_id   uuid not null references public.machines (id),
  owner_org_id uuid not null references public.organizations (id),
  from_date    date not null default current_date,
  to_date      date,
  acquired_via public.acquired_via not null,
  transfer_id  uuid,
  document_id  uuid,
  created_at   timestamptz not null default now()
);
create unique index ownerships_current_uq on public.ownerships (machine_id) where to_date is null;
create index ownerships_owner_idx on public.ownerships (owner_org_id);

create table public.label_batches (
  id              uuid primary key default gen_random_uuid(),
  quantity        int not null check (quantity between 1 and 10000),
  status          public.label_batch_status not null default 'ordered',
  medium          public.label_medium not null default 'qr',
  printed_at      timestamptz,
  printer_ref     text,
  assigned_org_id uuid references public.organizations (id),
  ordered_by_org_id uuid references public.organizations (id),
  shipping_address jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table public.labels (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[0-9A-Za-z]{22}$'),
  batch_id            uuid references public.label_batches (id),
  machine_id          uuid references public.machines (id),
  status              public.label_status not null default 'printed',
  role                public.label_role not null default 'primary',
  medium              public.label_medium not null default 'qr',
  assigned_org_id     uuid references public.organizations (id),
  bound_at            timestamptz,
  bound_by_user_id    uuid,
  bound_by_org_id     uuid references public.organizations (id),
  revoked_at          timestamptz,
  revoked_reason      text,
  replaced_by_label_id uuid references public.labels (id),
  created_at          timestamptz not null default now()
);
create index labels_machine_idx on public.labels (machine_id);
create unique index labels_one_bound_primary on public.labels (machine_id) where status = 'bound' and role = 'primary';

create table public.conflicts (
  id                  uuid primary key default gen_random_uuid(),
  type                public.conflict_type not null,
  machine_id          uuid references public.machines (id),
  related_machine_id  uuid references public.machines (id),
  involved_org_ids    uuid[] not null default '{}',
  details             jsonb not null default '{}'::jsonb,
  status              public.conflict_status not null default 'open',
  assigned_to_user_id uuid,
  resolved_by_user_id uuid,
  resolution_note     text,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create index conflicts_open_idx on public.conflicts (created_at) where status = 'open';
create index conflicts_machine_idx on public.conflicts (machine_id);
create index conflicts_involved_idx on public.conflicts using gin (involved_org_ids);

create table public.oem_records (
  id                     uuid primary key default gen_random_uuid(),
  manufacturer_org_id    uuid not null references public.organizations (id),
  make                   text not null,
  model                  text not null,
  variant                text,
  year                   int,
  category               public.machine_category,
  serial_number          text not null,
  normalized_serial      text not null,
  engine_make            text,
  engine_model           text,
  engine_serial          text,
  emission_stage         public.emission_stage,
  engine_power_kw        numeric,
  service_weight_kg      int,
  fuel_type              public.fuel_type,
  electric_config        public.electric_config,
  has_lifting_device     boolean,
  delivered_at           date,
  delivered_to_dealer_org_id uuid references public.organizations (id),
  delivered_to_country   char(2),
  ce_declaration_document_id uuid,
  source                 public.oem_source not null default 'import',
  matched_machine_id     uuid references public.machines (id),
  created_at             timestamptz not null default now(),
  unique (manufacturer_org_id, normalized_serial)
);
create index oem_records_serial_idx on public.oem_records (normalized_serial);

create table public.vtr_lookups (
  road_reg     text primary key,
  snapshot     jsonb not null,
  source       text not null,
  looked_up_at timestamptz not null default now()
);

-- ---------- Triggers keeping the unique slot correct ----------
create or replace function app.identifier_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st public.machine_status;
begin
  new.normalized_value := app.normalize_identifier(new.value);
  if new.normalized_value is null then raise exception 'empty identifier'; end if;
  select status into st from public.machines where id = new.machine_id;
  new.unique_active := new.type in ('pin', 'serial', 'vin') and new.conflict_id is null
    and st not in ('draft', 'scrapped', 'exported', 'deregistered');
  return new;
end $$;
create trigger machine_identifiers_bw before insert or update on public.machine_identifiers
  for each row execute function app.identifier_before_write();

-- Scrapped/exported/deregistered machines release their serials (SPEC §6.8); activating a draft claims them.
create or replace function app.machine_status_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update public.machine_identifiers set unique_active = (type in ('pin', 'serial', 'vin') and conflict_id is null
      and new.status not in ('draft', 'scrapped', 'exported', 'deregistered'))
    where machine_id = new.id;
  end if;
  return null;
end $$;
create trigger machines_status_after after update of status on public.machines
  for each row execute function app.machine_status_after();

-- ---------- Relations (redefined as later steps add encumbrances, transfers, insurance, verification, checks) ----------
-- Relations of the current actor's orgs to a machine.
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
  if m.registered_by_org_id = any (orgs) and m.status <> 'draft' then rel := array_append(rel, 'registered_by'); end if;
  if m.status = 'draft' and m.registered_by_org_id = any (orgs) then rel := array_append(rel, 'draft_owner'); end if;
  if exists (select 1 from public.ownerships w where w.machine_id = m.id and w.to_date is not null and w.owner_org_id = any (orgs)
             and w.owner_org_id is distinct from m.owner_org_id) then
    rel := array_append(rel, 'previous_owner');
  end if;
  return rel;
end $$;

create or replace function app.can_view_machine(p_machine_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select cardinality(app.machine_relations(p_machine_id)) > 0
$$;

-- Relations that give full register data (not insurer-masked, not previous-owner-limited).
create or replace function app.has_full_access(p_rel text[])
returns boolean language sql immutable set search_path = '' as $$
  select p_rel && array['operator', 'authority', 'owner', 'user', 'registered_by', 'draft_owner', 'holder', 'transfer_party', 'inspector_assigned']
$$;

-- ---------- Views of a machine (JSON) ----------
create or replace function app.machine_primary_serial(p_machine_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select normalized_value from public.machine_identifiers where machine_id = p_machine_id
  order by case type when 'pin' then 1 when 'serial' then 2 when 'vin' then 3 else 9 end, created_at limit 1
$$;

create or replace function app.machine_status_rank(s public.machine_status)
returns int language sql immutable set search_path = '' as $$
  select case s when 'stolen' then 1 when 'blocked' then 2 when 'disputed' then 3 when 'scrapped' then 4 when 'exported' then 4
    when 'deregistered' then 4 when 'active' then 5 else 6 end
$$;

-- Base fields shared by all non-public views.
create or replace function app.machine_base_json(m public.machines)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'reg_number', m.reg_number, 'status', m.status, 'verification_level', m.verification_level,
    'verification_method', m.verification_method, 'verified_at', m.verified_at,
    'verified_by', case when m.verified_by_org_id is null then null else (select name from public.organizations where id = m.verified_by_org_id) end,
    'make', m.make, 'model', m.model, 'variant', m.variant, 'year', m.year, 'category', m.category, 'color', m.color,
    'description', m.description, 'model_id', m.model_id,
    'technical', jsonb_build_object('service_weight_kg', m.service_weight_kg, 'engine_power_kw', m.engine_power_kw,
      'power_standard', m.power_standard, 'has_lifting_device', m.has_lifting_device, 'fuel_type', m.fuel_type,
      'electric_config', m.electric_config, 'emission_stage', m.emission_stage, 'engine_make', m.engine_make,
      'engine_model', m.engine_model, 'engine_type_approval_no', m.engine_type_approval_no, 'ce_marked', m.ce_marked,
      'registration_liable', coalesce(m.service_weight_kg >= 1500, false)),
    'registration_type', m.registration_type, 'valid_until', m.valid_until, 'origin_country', m.origin_country,
    'origin', m.origin, 'hour_meter', m.hour_meter, 'hour_meter_updated_at', m.hour_meter_updated_at,
    'primary_photo_path', m.primary_photo_path, 'first_sale_date', m.first_sale_date,
    'deregistered_at', m.deregistered_at, 'deregistration_reason', m.deregistration_reason, 'stock_status', m.stock_status,
    'created_at', m.created_at, 'updated_at', m.updated_at)
$$;

-- Role-filtered view for authenticated users (SPEC §2.6, §11.2). Later migrations extend it (financing, flags, …)
-- by redefining app.machine_view_extras.
create or replace function app.machine_view_extras(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;

create or replace function app.machine_view(p_machine_id uuid, p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.machines; rel text[]; full_ boolean; partner boolean; masked boolean; v jsonb;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then return null; end if;
  rel := app.machine_relations(m.id, case when p_org_id is null then null else array[p_org_id] end);
  if app.is_operator() and not ('operator' = any (rel)) then rel := array_append(rel, 'operator'); end if;
  full_ := app.has_full_access(rel);
  partner := p_org_id is not null and (app.has_org_type(p_org_id, 'dealer') or app.has_org_type(p_org_id, 'financier')
    or app.has_org_type(p_org_id, 'inspector') or app.has_org_type(p_org_id, 'insurer') or app.has_org_type(p_org_id, 'marketplace'));
  masked := not full_ and (not partner or (app.has_org_type(p_org_id, 'insurer') and not app.has_org_type(p_org_id, 'dealer')
    and not app.has_org_type(p_org_id, 'financier') and not app.has_org_type(p_org_id, 'inspector')));
  if m.status = 'draft' and not ('draft_owner' = any (rel) or 'operator' = any (rel)) then return null; end if;
  v := app.machine_base_json(m) || jsonb_build_object(
    'relations', to_jsonb(rel),
    'access', case when full_ then 'full' when 'previous_owner' = any (rel) then 'previous_owner' when partner then 'partner' else 'basic' end,
    'owner', case when full_ or partner or 'previous_owner' = any (rel) then app.org_brief(m.owner_org_id) end,
    'user_org', case when full_ then app.org_brief(m.user_org_id) end,
    'registered_by', case when full_ then app.org_brief(m.registered_by_org_id) end,
    'owner_ordinal', (select count(*) from public.ownerships w where w.machine_id = m.id),
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'type', i.type,
        'value', case when masked then app.mask_serial(i.normalized_value) else i.value end,
        'verified', i.verified, 'source', i.source, 'external_system', i.external_system,
        'vtr_snapshot', case when full_ then i.vtr_snapshot end, 'in_conflict', i.conflict_id is not null)
        order by case i.type when 'pin' then 1 when 'serial' then 2 when 'vin' then 3 else 9 end, i.created_at)
      from public.machine_identifiers i where i.machine_id = m.id), '[]'::jsonb),
    'labels', case when full_ then coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'status', l.status,
        'role', l.role, 'medium', l.medium, 'bound_at', l.bound_at, 'serial', right(l.code, 6)) order by l.bound_at desc nulls last)
      from public.labels l where l.machine_id = m.id), '[]'::jsonb)
      else jsonb_build_object('has_bound_label', exists (select 1 from public.labels l where l.machine_id = m.id and l.status = 'bound')) end,
    'draft_data', case when m.status = 'draft' then m.draft_data end
  );
  return v || app.machine_view_extras(m, rel, p_org_id);
end $$;

-- Inspection badge: filled in by the fleet migration (step 12). Null until then or if the owner hides it.
create or replace function app.public_inspection_valid_until(p_machine_id uuid)
returns date language sql stable security definer set search_path = '' as $$ select null::date $$;

-- Public card (SPEC §5.3): exactly these fields, nothing more (SPEC §16.1).
create or replace function app.public_card_json(m public.machines, p_label public.labels)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reg_number', m.reg_number,
    'make', m.make,
    'model', m.model,
    'year', m.year,
    'category', m.category,
    'primary_photo_path', m.primary_photo_path,
    'status', m.status,
    'verification_level', m.verification_level,
    'serial_masked', app.mask_serial(app.machine_primary_serial(m.id)),
    'has_registered_owner', m.owner_org_id is not null,
    'label_status', case when p_label.id is null then null
                         when p_label.status = 'bound' then 'bound'
                         when p_label.status in ('revoked', 'lost') then 'replaced' else 'unbound' end,
    'inspection_valid_until', app.public_inspection_valid_until(m.id)
  )
$$;


-- ---------- Owner resolution ----------
-- Resolves the owner org for a registration: explicit id, org number (existing or unclaimed placeholder created
-- from the company lookup), or the acting org. An invitation is sent to owner_email when given.
create or replace function app.resolve_owner_org(p_actor_org uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare oid uuid; n text; h text; lk jsonb; o public.organizations; token text;
begin
  if p_data ? 'owner_org_id' and nullif(p_data ->> 'owner_org_id', '') is not null then
    select * into o from public.organizations where id = (p_data ->> 'owner_org_id')::uuid and status <> 'suspended';
    if o.id is null then perform app.raise('VALIDATION', '{"field":"owner_org_id"}'); end if;
    return o.id;
  end if;
  if nullif(p_data ->> 'owner_org_number', '') is null then return p_actor_org; end if;
  n := app.normalize_org_number(p_data ->> 'owner_org_number');
  if n is null then perform app.raise('VALIDATION', '{"field":"owner_org_number"}'); end if;
  h := app.org_number_hash(n);
  select id into oid from public.organizations where org_number_hash = h;
  if oid is not null then return oid; end if;
  if app.is_demo_mode() then
    lk := app.mock_company_lookup(n);
  else
    select jsonb_build_object('name', name, 'city', city, 'address', address, 'is_sole_trader', is_sole_trader, 'source', source)
      into lk from public.company_lookups where org_number_hash = h;
  end if;
  if lk is null and nullif(p_data ->> 'owner_name', '') is null then perform app.raise('LOOKUP_REQUIRED'); end if;
  insert into public.organizations (slug, types, name, org_number, org_number_hash, org_number_enc, is_sole_trader, address, city,
    status, lookup_source, lookup_at, created_by)
  values (app.unique_slug(coalesce(lk ->> 'name', p_data ->> 'owner_name')), array['owner']::public.org_type[],
    coalesce(lk ->> 'name', p_data ->> 'owner_name'),
    case when coalesce((lk ->> 'is_sole_trader')::boolean, app.is_sole_trader_number(n)) then null else n end, h,
    case when coalesce((lk ->> 'is_sole_trader')::boolean, app.is_sole_trader_number(n))
         then extensions.pgp_sym_encrypt(n, app.secret('org_number_key')) end,
    coalesce((lk ->> 'is_sole_trader')::boolean, app.is_sole_trader_number(n)), lk -> 'address', lk ->> 'city',
    'pending', lk ->> 'source', case when lk is null then null else now() end, auth.uid())
  returning id into oid;
  perform app.log_event('org.created', null, oid, p_actor_org, jsonb_build_object('placeholder', true, 'created_by_org', p_actor_org));
  if nullif(p_data ->> 'owner_email', '') is not null then
    token := encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.memberships (org_id, role, status, invited_by, invite_token_hash, invite_email, invite_expires_at)
    values (oid, 'admin', 'invited', auth.uid(), app.sha256_hex(token), lower(trim(p_data ->> 'owner_email')), now() + interval '30 days');
    insert into public.email_outbox (to_email, org_id, template, data)
    values (lower(trim(p_data ->> 'owner_email')), oid, 'invite_owner',
      jsonb_build_object('token', token, 'org_name', coalesce(lk ->> 'name', p_data ->> 'owner_name'),
        'registered_by', (select name from public.organizations where id = p_actor_org)));
  end if;
  return oid;
end $$;

-- An org created as a placeholder (no active members) can be claimed by whoever creates it with the same number.
create or replace function public.create_org(
  p_org_number text, p_types public.org_type[], p_name text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_country text default 'SE', p_address jsonb default null, p_accept_dpa_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n text; h text; lk public.company_lookups; o public.organizations; sole boolean; name_ text; st public.org_status;
  types_ public.org_type[]; existing public.organizations;
begin
  if uid is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if not app.is_verified_user() then perform app.raise('IDENTITY_NOT_VERIFIED'); end if;
  types_ := array(select distinct t from unnest(p_types) t where t not in ('operator'));
  if cardinality(types_) = 0 then perform app.raise('VALIDATION', '{"field":"types"}'); end if;
  if p_accept_dpa_version is null then perform app.raise('DPA_REQUIRED'); end if;
  if coalesce(p_country, 'SE') = 'SE' then
    n := app.normalize_org_number(p_org_number);
    if n is null then perform app.raise('VALIDATION', '{"field":"org_number"}'); end if;
    h := app.org_number_hash(n);
    select * into existing from public.organizations where org_number_hash = h;
    if existing.id is not null then
      if exists (select 1 from public.memberships where org_id = existing.id and status = 'active') then
        perform app.raise('ORG_EXISTS', jsonb_build_object('org', app.org_brief(existing.id)));
      end if;
    end if;
    if app.is_demo_mode() then perform public.lookup_company(n); end if;
    select * into lk from public.company_lookups where org_number_hash = h;
    sole := coalesce(lk.is_sole_trader, app.is_sole_trader_number(n));
    name_ := coalesce(lk.name, nullif(trim(p_name), ''));
  else
    n := nullif(trim(p_org_number), '');
    h := case when n is null then null else app.sha256_hex(app.secret('org_number_key') || ':' || upper(p_country) || ':' || n) end;
    sole := false;
    name_ := nullif(trim(p_name), '');
  end if;
  if name_ is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  -- Auto-approval needs proof that the user represents the company: the user's BankID personal number must be among
  -- the signatories returned by the company lookup (ADR 0009). DEMO_MODE's mock register treats every user as signatory.
  st := case when types_ = array['owner']::public.org_type[] and lk.org_number_hash is not null and coalesce(p_country, 'SE') = 'SE'
               and app.is_signatory(lk) then 'approved' else 'pending' end;
  if existing.id is not null and st <> 'approved' and not app.is_demo_mode() then
    -- A placeholder that already carries machines can only be claimed by a signatory (or via operator review).
    if exists (select 1 from public.machines where owner_org_id = existing.id) then perform app.raise('SIGNATORY_REQUIRED'); end if;
  end if;
  if existing.id is not null then
    -- Claim the placeholder created when someone registered a machine for this org.
    update public.organizations set types = types_, name = name_, status = st, approved_at = case when st = 'approved' then now() end,
      email = nullif(trim(p_email), ''), phone = nullif(trim(p_phone), ''), website = nullif(trim(p_website), ''),
      lookup_source = coalesce(lk.source, lookup_source), lookup_at = coalesce(lk.looked_up_at, lookup_at),
      dpa_accepted_at = now(), dpa_version = p_accept_dpa_version, created_by = uid
    where id = existing.id returning * into o;
    delete from public.memberships where org_id = o.id and status <> 'active';
  else
    insert into public.organizations (slug, types, name, org_number, org_number_hash, org_number_enc, is_sole_trader, country,
      address, city, email, phone, website, status, approved_at, lookup_source, lookup_at, dpa_accepted_at, dpa_version, created_by)
    values (app.unique_slug(name_), types_, name_,
      case when sole or coalesce(p_country, 'SE') <> 'SE' then null else n end, h,
      case when sole then extensions.pgp_sym_encrypt(n, app.secret('org_number_key')) else null end,
      sole, upper(coalesce(p_country, 'SE')), coalesce(lk.address, p_address), coalesce(lk.city, p_address ->> 'city'),
      nullif(trim(p_email), ''), nullif(trim(p_phone), ''), nullif(trim(p_website), ''), st,
      case when st = 'approved' then now() end, lk.source, lk.looked_up_at, now(), p_accept_dpa_version, uid)
    returning * into o;
  end if;
  insert into public.memberships (org_id, user_id, role, status, accepted_at) values (o.id, uid, 'admin', 'active', now());
  update public.profiles set last_active_org_id = o.id where user_id = uid;
  perform app.log_event(case when existing.id is null then 'org.created' else 'org.claimed' end, null, o.id, o.id,
    jsonb_build_object('types', types_, 'status', st, 'sole_trader', sole, 'dpa_version', p_accept_dpa_version));
  if st = 'pending' then
    perform app.notify_operators('org.pending_approval', jsonb_build_object('org_id', o.id, 'name', o.name, 'types', types_),
      '/admin/organizations', 'info');
  end if;
  return app.org_brief(o.id) || jsonb_build_object('status', o.status, 'claimed', existing.id is not null);
end $$;

-- ---------- Signatory proof (ADR 0009) ----------
alter table public.company_lookups add column signatory_hashes text[] not null default '{}';

create or replace function app.personal_number_hash(p_personal_number text)
returns text language sql stable security definer set search_path = '' as $$
  select app.sha256_hex(app.secret('personal_number_salt') || ':' || regexp_replace(coalesce(p_personal_number, ''), '\D', '', 'g'))
$$;

create or replace function app.is_signatory(lk public.company_lookups)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_demo_mode() or exists (select 1 from public.profiles p where p.user_id = auth.uid()
    and p.personal_number_hash is not null and p.personal_number_hash = any (lk.signatory_hashes))
$$;

drop function if exists public.record_company_lookup(text, jsonb);
-- Stores a lookup result from Edge Function company-lookup (service role). Signatories' personal numbers are hashed
-- here with the same salt as BankID identities and never stored in clear (rule 6).
create or replace function public.record_company_lookup(p_org_number text, p_result jsonb, p_signatories text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text := app.org_number_hash(p_org_number);
begin
  if h is null then perform app.raise('VALIDATION', '{"field":"org_number"}'); end if;
  insert into public.company_lookups (org_number_hash, name, address, city, is_sole_trader, source, data, signatory_hashes)
  values (h, p_result ->> 'name', p_result -> 'address', p_result ->> 'city', coalesce((p_result ->> 'is_sole_trader')::boolean, false),
          coalesce(p_result ->> 'source', 'unknown'), p_result - 'personal_number' - 'signatories',
          coalesce((select array_agg(app.personal_number_hash(x)) from unnest(p_signatories) x), '{}'))
  on conflict (org_number_hash) do update set name = excluded.name, address = excluded.address, city = excluded.city,
    is_sole_trader = excluded.is_sole_trader, source = excluded.source, data = excluded.data,
    signatory_hashes = excluded.signatory_hashes, looked_up_at = now();
  return p_result - 'personal_number' - 'signatories';
end $$;
grant execute on function public.record_company_lookup(text, jsonb, text[]) to service_role;

-- Owner-only orgs are approved after identity verification only if the user is a signatory (or in DEMO_MODE).
create or replace function app.auto_approve_orgs_for(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o record; h text;
begin
  select personal_number_hash into h from public.profiles where user_id = p_user_id;
  for o in select org.* from public.organizations org
           join public.memberships m on m.org_id = org.id and m.user_id = p_user_id and m.status = 'active' and m.role = 'admin'
           join public.company_lookups lk on lk.org_number_hash = org.org_number_hash
           where org.status = 'pending' and org.types = array['owner']::public.org_type[]
             and (app.is_demo_mode() or h = any (lk.signatory_hashes)) loop
    update public.organizations set status = 'approved', approved_at = now() where id = o.id;
    perform app.log_event('org.approved', null, o.id, o.id, jsonb_build_object('auto', true));
  end loop;
end $$;

-- ---------- External lookups ----------
create or replace function app.mock_vtr_lookup(p_road_reg text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'road_reg', upper(regexp_replace(p_road_reg, '\s', '', 'g')),
    'vehicle_class', case when ascii(right(upper(p_road_reg), 1)) % 3 = 0 then 'traktor_b' else 'motorredskap_klass_i' end,
    'owner_category', case when ascii(right(upper(p_road_reg), 1)) % 2 = 0 then 'legal_person' else 'natural_person' end,
    'status', 'in_traffic',
    'last_owner_change', (date '2020-01-01' + (ascii(right(upper(p_road_reg), 1)) * 7))::text,
    'source', 'mock')
$$;

create or replace function public.record_vtr_lookup(p_road_reg text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- Never store personal data from the vehicle register (SPEC §4.2): drop any owner name/number fields.
  insert into public.vtr_lookups (road_reg, snapshot, source)
  values (upper(regexp_replace(p_road_reg, '\s', '', 'g')), p_snapshot - 'owner_name' - 'owner_personal_number' - 'owner_address',
          coalesce(p_snapshot ->> 'source', 'transportstyrelsen'))
  on conflict (road_reg) do update set snapshot = excluded.snapshot, source = excluded.source, looked_up_at = now();
  return p_snapshot - 'owner_name' - 'owner_personal_number' - 'owner_address';
end $$;

create or replace function public.lookup_vehicle_registry(p_road_reg text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text := upper(regexp_replace(coalesce(p_road_reg, ''), '[\s-]', '', 'g')); s jsonb;
begin
  if auth.uid() is null and app.current_api_key_id() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if r !~ '^[A-Z]{3}[0-9]{2}[0-9A-Z]$' then perform app.raise('VALIDATION', '{"field":"road_reg"}'); end if;
  if app.is_demo_mode() then
    return public.record_vtr_lookup(r, app.mock_vtr_lookup(r));
  end if;
  select snapshot into s from public.vtr_lookups where road_reg = r and looked_up_at > now() - interval '7 days';
  if s is null then perform app.raise('LOOKUP_REQUIRED'); end if;
  return s;
end $$;

-- Factory data for a serial (SPEC §4.7): prefills the wizard.
create or replace function public.lookup_oem(p_serial text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.oem_records; n text := app.normalize_identifier(p_serial);
begin
  if auth.uid() is null and app.current_api_key_id() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  select * into r from public.oem_records where normalized_serial = n order by created_at desc limit 1;
  if r.id is null then return null; end if;
  return jsonb_build_object('oem_record_id', r.id, 'make', r.make, 'model', r.model, 'variant', r.variant, 'year', r.year,
    'category', r.category, 'engine_make', r.engine_make, 'engine_model', r.engine_model, 'emission_stage', r.emission_stage,
    'engine_power_kw', r.engine_power_kw, 'service_weight_kg', r.service_weight_kg, 'fuel_type', r.fuel_type,
    'electric_config', r.electric_config, 'has_lifting_device', r.has_lifting_device, 'delivered_at', r.delivered_at,
    'manufacturer', (select name from public.organizations where id = r.manufacturer_org_id));
end $$;

create or replace function public.search_models(p_query text, p_limit int default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null and app.current_api_key_id() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if length(q) < 1 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) - 'created_at') from (
    select * from public.machine_models mm
    where (mm.make || ' ' || mm.model) ilike '%' || q || '%' or mm.model ilike q || '%'
       or exists (select 1 from unnest(mm.aliases) a where a ilike '%' || q || '%')
    order by extensions.similarity(mm.make || ' ' || mm.model, q) desc, mm.make, mm.model
    limit least(greatest(p_limit, 1), 50)) x), '[]'::jsonb);
end $$;

-- ---------- Registration ----------
create or replace function app.validate_identifiers(p_identifiers jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare i jsonb; has_unique boolean := false;
begin
  if p_identifiers is null or jsonb_typeof(p_identifiers) <> 'array' or jsonb_array_length(p_identifiers) = 0 then
    perform app.raise('VALIDATION', '{"field":"identifiers","reason":"required"}');
  end if;
  for i in select * from jsonb_array_elements(p_identifiers) loop
    if (i ->> 'type') not in ('pin', 'serial', 'engine_serial', 'vin', 'road_reg', 'external_registry', 'chassis', 'other') then
      perform app.raise('VALIDATION', jsonb_build_object('field', 'identifiers.type', 'value', i ->> 'type'));
    end if;
    if app.normalize_identifier(i ->> 'value') is null or length(app.normalize_identifier(i ->> 'value')) < 3
       or length(i ->> 'value') > 64 then
      perform app.raise('VALIDATION', jsonb_build_object('field', 'identifiers.value', 'type', i ->> 'type'));
    end if;
    if i ->> 'type' = 'road_reg' and app.normalize_identifier(i ->> 'value') !~ '^[A-Z]{3}[0-9]{2}[0-9A-Z]$' then
      perform app.raise('VALIDATION', '{"field":"identifiers.road_reg"}');
    end if;
    if i ->> 'type' in ('pin', 'serial', 'vin') then has_unique := true; end if;
  end loop;
  if not has_unique then perform app.raise('VALIDATION', '{"field":"identifiers","reason":"serial_required"}'); end if;
end $$;

-- Core machine creation used by register_machine, import_commit and the dealer sale flow.
-- Returns {ok, id, reg_number, status, conflict_id?, existing_reg_number?, warnings[]}.
create or replace function app.create_machine(
  p_actor_org uuid, p_data jsonb, p_origin public.machine_origin, p_draft_id uuid default null,
  p_level smallint default 0, p_method public.verification_method default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid; mid uuid; reg text; i jsonb; dup record; conflict uuid; oem public.oem_records;
  warnings jsonb := '[]'::jsonb; st public.machine_status := 'active'; mm public.machine_models; vtr jsonb;
  d jsonb := p_data; owner_is_sole boolean; attempt int := 0; existing_reg text; existing_owner uuid; nv text;
begin
  perform app.validate_identifiers(d -> 'identifiers');
  -- Factory data (SPEC §6.2): fills gaps, never overrides what the user entered.
  for i in select * from jsonb_array_elements(d -> 'identifiers') loop
    if i ->> 'type' in ('pin', 'serial') and oem.id is null then
      select * into oem from public.oem_records where normalized_serial = app.normalize_identifier(i ->> 'value') limit 1;
    end if;
  end loop;
  if oem.id is not null then
    d := jsonb_strip_nulls(jsonb_build_object('make', oem.make, 'model', oem.model, 'variant', oem.variant, 'year', oem.year,
      'category', oem.category, 'engine_make', oem.engine_make, 'engine_model', oem.engine_model, 'emission_stage', oem.emission_stage,
      'engine_power_kw', oem.engine_power_kw, 'service_weight_kg', oem.service_weight_kg, 'fuel_type', oem.fuel_type,
      'electric_config', oem.electric_config, 'has_lifting_device', oem.has_lifting_device)) || jsonb_strip_nulls(d);
  end if;
  if nullif(d ->> 'model_id', '') is not null then
    select * into mm from public.machine_models where id = (d ->> 'model_id')::uuid;
    if mm.id is not null then
      d := jsonb_strip_nulls(jsonb_build_object('make', mm.make, 'model', mm.model, 'category', mm.category,
        'service_weight_kg', mm.weight_kg, 'engine_power_kw', mm.engine_kw, 'fuel_type', mm.fuel_type,
        'emission_stage', mm.emission_stage, 'has_lifting_device', mm.has_lifting_device)) || jsonb_strip_nulls(d);
    end if;
  end if;
  if nullif(trim(d ->> 'make'), '') is null or nullif(trim(d ->> 'model'), '') is null or nullif(d ->> 'category', '') is null then
    perform app.raise('VALIDATION', '{"field":"make_model_category"}');
  end if;
  if d ->> 'registration_type' = 'temporary' and (nullif(d ->> 'valid_until', '') is null or nullif(d ->> 'origin_country', '') is null) then
    perform app.raise('VALIDATION', '{"field":"valid_until"}');
  end if;
  owner_id := app.resolve_owner_org(p_actor_org, d);

  -- Duplicate check on pin/serial/vin among active machines (SPEC §4.2, §16.8).
  for i in select * from jsonb_array_elements(d -> 'identifiers') loop
    if i ->> 'type' in ('pin', 'serial', 'vin') then
      select x.machine_id, m.reg_number, m.owner_org_id into dup from public.machine_identifiers x
        join public.machines m on m.id = x.machine_id
        where x.unique_active and x.type = (i ->> 'type')::public.identifier_type and x.normalized_value = app.normalize_identifier(i ->> 'value')
          and (p_draft_id is null or x.machine_id <> p_draft_id)
        limit 1;
      if dup.machine_id is not null then
        existing_reg := dup.reg_number; existing_owner := dup.owner_org_id;
        exit;
      end if;
    end if;
  end loop;
  if existing_reg is not null then st := 'disputed'; end if;

  if p_draft_id is not null then
    select id into mid from public.machines where id = p_draft_id and status = 'draft' and registered_by_org_id = p_actor_org;
    if mid is null then perform app.raise('NOT_FOUND', '{"what":"draft"}'); end if;
    delete from public.machine_identifiers where machine_id = mid;
  else
    insert into public.machines (status, registered_by_org_id, registered_by_user_id, origin) values ('draft', p_actor_org, auth.uid(), p_origin)
    returning id into mid;
  end if;

  loop
    attempt := attempt + 1;
    reg := app.generate_reg_number();
    begin
      update public.machines set
        reg_number = reg, status = st, origin = p_origin, owner_org_id = owner_id,
        user_org_id = nullif(d ->> 'user_org_id', '')::uuid,
        registered_by_org_id = p_actor_org, registered_by_user_id = auth.uid(),
        model_id = nullif(d ->> 'model_id', '')::uuid, make = trim(d ->> 'make'), model = trim(d ->> 'model'),
        variant = nullif(trim(d ->> 'variant'), ''), year = nullif(d ->> 'year', '')::int,
        category = (d ->> 'category')::public.machine_category, color = nullif(trim(d ->> 'color'), ''),
        description = nullif(trim(d ->> 'description'), ''),
        service_weight_kg = nullif(d ->> 'service_weight_kg', '')::int, engine_power_kw = nullif(d ->> 'engine_power_kw', '')::numeric,
        power_standard = nullif(d ->> 'power_standard', '')::public.power_standard,
        has_lifting_device = coalesce((d ->> 'has_lifting_device')::boolean, false),
        fuel_type = nullif(d ->> 'fuel_type', '')::public.fuel_type, electric_config = nullif(d ->> 'electric_config', '')::public.electric_config,
        emission_stage = nullif(d ->> 'emission_stage', '')::public.emission_stage,
        engine_make = nullif(trim(d ->> 'engine_make'), ''), engine_model = nullif(trim(d ->> 'engine_model'), ''),
        engine_type_approval_no = nullif(trim(d ->> 'engine_type_approval_no'), ''), ce_marked = (d ->> 'ce_marked')::boolean,
        registration_type = coalesce(nullif(d ->> 'registration_type', ''), 'permanent')::public.registration_type,
        valid_until = nullif(d ->> 'valid_until', '')::date, origin_country = upper(nullif(d ->> 'origin_country', '')),
        verification_level = p_level, verification_method = p_method,
        verified_by_org_id = case when p_level > 0 then p_actor_org end, verified_at = case when p_level > 0 then now() end,
        hour_meter = nullif(d ->> 'hour_meter', '')::int, hour_meter_updated_at = case when nullif(d ->> 'hour_meter', '') is not null then now() end,
        first_sale_date = nullif(d ->> 'first_sale_date', '')::date,
        first_sale_dealer_org_id = case when p_origin = 'new_sale' then p_actor_org end,
        stock_status = case when owner_id = p_actor_org and app.has_org_type(p_actor_org, 'dealer') then 'stock' end,
        draft_data = null
      where id = mid;
      exit;
    exception when unique_violation then
      if attempt > 5 then raise; end if;
    end;
  end loop;

  if st = 'disputed' then
    insert into public.conflicts (type, machine_id, related_machine_id, involved_org_ids, details)
    values ('duplicate_identifier', mid, (select machine_id from public.machine_identifiers where unique_active
        and normalized_value in (select app.normalize_identifier(e ->> 'value') from jsonb_array_elements(d -> 'identifiers') e
          where e ->> 'type' in ('pin', 'serial', 'vin')) limit 1),
      array_remove(array[p_actor_org, owner_id, existing_owner], null),
      jsonb_build_object('existing_reg_number', existing_reg, 'new_reg_number', reg))
    returning id into conflict;
  end if;

  for i in select * from jsonb_array_elements(d -> 'identifiers') loop
    nv := app.normalize_identifier(i ->> 'value');
    vtr := null;
    if i ->> 'type' = 'road_reg' then
      vtr := case when app.is_demo_mode() then public.record_vtr_lookup(nv, app.mock_vtr_lookup(nv))
                  else (select snapshot from public.vtr_lookups where road_reg = nv) end;
      select is_sole_trader into owner_is_sole from public.organizations where id = owner_id;
      if vtr is not null and ((vtr ->> 'owner_category' = 'natural_person') <> coalesce(owner_is_sole, false)) then
        warnings := warnings || jsonb_build_object('code', 'vtr_owner_mismatch', 'owner_category', vtr ->> 'owner_category');
      end if;
    end if;
    insert into public.machine_identifiers (machine_id, type, value, normalized_value, source, external_system, vtr_snapshot, conflict_id)
    values (mid, (i ->> 'type')::public.identifier_type, trim(i ->> 'value'), nv,
      coalesce(nullif(i ->> 'source', ''), case when oem.id is not null and i ->> 'type' in ('pin', 'serial') then 'oem' else 'manual' end)::public.identifier_source,
      nullif(i ->> 'external_system', ''), vtr,
      case when conflict is not null and i ->> 'type' in ('pin', 'serial', 'vin')
             and exists (select 1 from public.machine_identifiers x where x.unique_active and x.machine_id <> mid
                         and x.type = (i ->> 'type')::public.identifier_type and x.normalized_value = nv)
           then conflict end);
  end loop;

  insert into public.ownerships (machine_id, owner_org_id, from_date, acquired_via)
  values (mid, owner_id, coalesce(nullif(d ->> 'ownership_from', '')::date, current_date),
          (case when p_origin = 'import' then 'import' else 'registration' end)::public.acquired_via);

  perform app.log_event('machine.registered', mid, owner_id, p_actor_org, jsonb_build_object(
    'reg_number', reg, 'origin', p_origin, 'status', st, 'verification_level', p_level,
    'make', trim(d ->> 'make'), 'model', trim(d ->> 'model'), 'registered_by_org_id', p_actor_org));
  if oem.id is not null then
    update public.oem_records set matched_machine_id = mid where id = oem.id;
    perform app.log_event('machine.factory_data_confirmed', mid, owner_id, p_actor_org,
      jsonb_build_object('oem_record_id', oem.id, 'manufacturer_org_id', oem.manufacturer_org_id));
  end if;
  if owner_id <> p_actor_org then
    perform app.notify_org(owner_id, 'machine.registered_for_you',
      jsonb_build_object('machine_id', mid, 'reg_number', reg, 'by', (select name from public.organizations where id = p_actor_org)),
      '/machines/' || mid, 'info');
  end if;
  perform app.enqueue_webhook(owner_id, 'machine.registered', mid, jsonb_build_object('origin', p_origin, 'status', st));
  if conflict is not null then
    perform app.log_event('conflict.created', mid, owner_id, p_actor_org,
      jsonb_build_object('conflict_id', conflict, 'type', 'duplicate_identifier', 'existing_reg_number', existing_reg));
    perform app.notify_org(existing_owner, 'conflict.duplicate_identifier',
      jsonb_build_object('reg_number', existing_reg, 'conflict_id', conflict), '/inbox', 'warning');
    perform app.notify_operators('conflict.created', jsonb_build_object('conflict_id', conflict, 'type', 'duplicate_identifier'),
      '/admin/conflicts', 'warning');
  end if;
  return jsonb_build_object('ok', true, 'id', mid, 'reg_number', reg, 'status', st, 'conflict_id', conflict,
    'existing_reg_number', existing_reg, 'warnings', warnings, 'factory_data', oem.id is not null);
end $$;

create or replace function app.can_register(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_org_type(p_org_id, 'owner') or app.has_org_type(p_org_id, 'dealer') or app.has_org_type(p_org_id, 'financier')
      or app.has_org_type(p_org_id, 'inspector') or app.has_org_type(p_org_id, 'operator')
$$;

-- Wizard autosave (SPEC §6.2: "Utkast autosparas (status draft), kan återupptas").
create or replace function public.save_machine_draft(p_org_id uuid, p_data jsonb, p_draft_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); mid uuid;
begin
  if not app.can_register(actor) then perform app.raise('FORBIDDEN'); end if;
  if pg_column_size(p_data) > 65536 then perform app.raise('VALIDATION', '{"field":"draft","reason":"too_large"}'); end if;
  if p_draft_id is null then
    insert into public.machines (status, registered_by_org_id, registered_by_user_id, draft_data, make, model)
    values ('draft', actor, auth.uid(), p_data, nullif(p_data ->> 'make', ''), nullif(p_data ->> 'model', ''))
    returning id into mid;
  else
    update public.machines set draft_data = p_data, make = nullif(p_data ->> 'make', ''), model = nullif(p_data ->> 'model', '')
    where id = p_draft_id and status = 'draft' and registered_by_org_id = actor returning id into mid;
    if mid is null then perform app.raise('NOT_FOUND'); end if;
  end if;
  return jsonb_build_object('id', mid, 'saved_at', now());
end $$;

create or replace function public.list_machine_drafts(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'draft_data', draft_data, 'updated_at', updated_at) order by updated_at desc)
    from public.machines where status = 'draft' and registered_by_org_id = actor), '[]'::jsonb);
end $$;

create or replace function public.delete_machine_draft(p_org_id uuid, p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id);
begin
  -- Drafts are not register data (no reg number, never public), so they may be removed.
  delete from public.machine_identifiers where machine_id = p_draft_id
    and exists (select 1 from public.machines where id = p_draft_id and status = 'draft' and registered_by_org_id = actor);
  delete from public.machines where id = p_draft_id and status = 'draft' and registered_by_org_id = actor;
  if not found then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

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
  return r;
end $$;

-- Live duplicate check for SerialInput (SPEC §6.2). Exact normalised match only.
create or replace function public.check_identifier(p_org_id uuid, p_type public.identifier_type, p_value text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); m public.machines;
begin
  select mm.* into m from public.machine_identifiers x join public.machines mm on mm.id = x.machine_id
    where x.unique_active and x.type = p_type and x.normalized_value = app.normalize_identifier(p_value) limit 1;
  if m.id is null then return jsonb_build_object('exists', false, 'oem', public.lookup_oem(p_value)); end if;
  return jsonb_build_object('exists', true, 'machine_id', case when m.owner_org_id = actor then m.id end,
    'reg_number', m.reg_number, 'is_mine', m.owner_org_id = actor, 'status', m.status);
end $$;

create or replace function public.update_machine(p_org_id uuid, p_machine_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; k text;
  allowed text[] := array['description', 'color', 'variant', 'hour_meter', 'primary_photo_path', 'service_weight_kg', 'engine_power_kw',
    'power_standard', 'has_lifting_device', 'fuel_type', 'electric_config', 'emission_stage', 'engine_make', 'engine_model',
    'engine_type_approval_no', 'ce_marked', 'year', 'stock_status'];
begin
  perform app.require_scope('machines:write');
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if (m.owner_org_id = actor or m.user_org_id = actor or app.is_operator('superadmin')) is not true then perform app.raise('FORBIDDEN'); end if;
  if m.status in ('scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then perform app.raise('VALIDATION', jsonb_build_object('field', k)); end if;
  end loop;
  if p_patch ? 'hour_meter' and (p_patch ->> 'hour_meter')::int < coalesce(m.hour_meter, 0) then
    perform app.raise('VALIDATION', '{"field":"hour_meter","reason":"decreasing"}');
  end if;
  if p_patch ? 'stock_status' and m.owner_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  update public.machines set
    description = case when p_patch ? 'description' then nullif(trim(p_patch ->> 'description'), '') else description end,
    color = case when p_patch ? 'color' then nullif(trim(p_patch ->> 'color'), '') else color end,
    variant = case when p_patch ? 'variant' then nullif(trim(p_patch ->> 'variant'), '') else variant end,
    year = case when p_patch ? 'year' then nullif(p_patch ->> 'year', '')::int else year end,
    hour_meter = case when p_patch ? 'hour_meter' then (p_patch ->> 'hour_meter')::int else hour_meter end,
    hour_meter_updated_at = case when p_patch ? 'hour_meter' then now() else hour_meter_updated_at end,
    primary_photo_path = case when p_patch ? 'primary_photo_path' then nullif(p_patch ->> 'primary_photo_path', '') else primary_photo_path end,
    service_weight_kg = case when p_patch ? 'service_weight_kg' then nullif(p_patch ->> 'service_weight_kg', '')::int else service_weight_kg end,
    engine_power_kw = case when p_patch ? 'engine_power_kw' then nullif(p_patch ->> 'engine_power_kw', '')::numeric else engine_power_kw end,
    power_standard = case when p_patch ? 'power_standard' then nullif(p_patch ->> 'power_standard', '')::public.power_standard else power_standard end,
    has_lifting_device = case when p_patch ? 'has_lifting_device' then coalesce((p_patch ->> 'has_lifting_device')::boolean, false) else has_lifting_device end,
    fuel_type = case when p_patch ? 'fuel_type' then nullif(p_patch ->> 'fuel_type', '')::public.fuel_type else fuel_type end,
    electric_config = case when p_patch ? 'electric_config' then nullif(p_patch ->> 'electric_config', '')::public.electric_config else electric_config end,
    emission_stage = case when p_patch ? 'emission_stage' then nullif(p_patch ->> 'emission_stage', '')::public.emission_stage else emission_stage end,
    engine_make = case when p_patch ? 'engine_make' then nullif(trim(p_patch ->> 'engine_make'), '') else engine_make end,
    engine_model = case when p_patch ? 'engine_model' then nullif(trim(p_patch ->> 'engine_model'), '') else engine_model end,
    engine_type_approval_no = case when p_patch ? 'engine_type_approval_no' then nullif(trim(p_patch ->> 'engine_type_approval_no'), '') else engine_type_approval_no end,
    ce_marked = case when p_patch ? 'ce_marked' then (p_patch ->> 'ce_marked')::boolean else ce_marked end,
    stock_status = case when p_patch ? 'stock_status' then nullif(p_patch ->> 'stock_status', '') else stock_status end
  where id = m.id;
  perform app.log_event(case when p_patch ? 'hour_meter' and (select count(*) from jsonb_object_keys(p_patch)) = 1
      then 'machine.hours_reported' else 'machine.updated' end, m.id, m.owner_org_id, actor,
    case when p_patch ? 'hour_meter' then jsonb_build_object('fields', (select jsonb_agg(x) from jsonb_object_keys(p_patch) x), 'hour_meter', (p_patch ->> 'hour_meter')::int)
         else jsonb_build_object('fields', (select jsonb_agg(x) from jsonb_object_keys(p_patch) x)) end);
  return app.machine_view(m.id, actor);
end $$;

-- ---------- Labels (SPEC §5.2) ----------
create or replace function public.bind_label(p_org_id uuid, p_machine_id uuid, p_code text, p_role public.label_role default 'primary')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; l public.labels; old public.labels; c uuid; rel text[];
begin
  perform app.require_scope('machines:write');
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  rel := app.machine_relations(m.id, array[actor]);
  if not (rel && array['owner', 'user', 'registered_by'] or app.has_org_type(actor, 'dealer') or app.has_org_type(actor, 'inspector')
          or app.is_operator('verifier')) then
    perform app.raise('FORBIDDEN');
  end if;
  if m.status in ('draft', 'scrapped', 'exported', 'deregistered') then perform app.raise('MACHINE_READ_ONLY'); end if;
  select * into l from public.labels where code = trim(p_code) for update;
  if l.id is null then perform app.raise('LABEL_NOT_FOUND'); end if;
  if l.status = 'bound' and l.machine_id = m.id then return jsonb_build_object('id', l.id, 'code', l.code, 'status', l.status, 'unchanged', true); end if;
  if l.status <> 'printed' and l.status <> 'assigned' then
    insert into public.conflicts (type, machine_id, related_machine_id, involved_org_ids, details)
    values ('label_reuse', m.id, l.machine_id, array_remove(array[actor, m.owner_org_id], null),
            jsonb_build_object('label_id', l.id, 'label_status', l.status)) returning id into c;
    perform app.log_event('conflict.created', m.id, m.owner_org_id, actor, jsonb_build_object('conflict_id', c, 'type', 'label_reuse'));
    perform app.notify_operators('conflict.created', jsonb_build_object('conflict_id', c, 'type', 'label_reuse'), '/admin/conflicts', 'warning');
    return jsonb_build_object('ok', false, 'error', 'LABEL_ALREADY_USED', 'conflict_id', c);
  end if;
  if l.assigned_org_id is not null and l.assigned_org_id <> actor and not app.is_operator('verifier') then
    perform app.raise('LABEL_ASSIGNED_TO_OTHER_ORG');
  end if;
  select * into old from public.labels where machine_id = m.id and status = 'bound' and role = p_role for update;
  if old.id is not null and p_role = 'primary' then
    update public.labels set status = 'revoked', revoked_at = now(), revoked_reason = 'replaced', replaced_by_label_id = l.id where id = old.id;
  end if;
  update public.labels set status = 'bound', machine_id = m.id, role = p_role, bound_at = now(), bound_by_user_id = auth.uid(),
    bound_by_org_id = actor where id = l.id returning * into l;
  perform app.log_event('label.bound', m.id, m.owner_org_id, actor,
    jsonb_build_object('label_id', l.id, 'label_serial', right(l.code, 6), 'role', p_role, 'replaced_label_id', old.id));
  perform app.enqueue_webhook(m.owner_org_id, 'label.bound', m.id, jsonb_build_object('label_serial', right(l.code, 6), 'role', p_role));
  return jsonb_build_object('ok', true, 'id', l.id, 'code', l.code, 'status', l.status, 'role', l.role, 'replaced_label_id', old.id);
end $$;

create or replace function public.revoke_label(p_org_id uuid, p_label_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); l public.labels; m public.machines;
begin
  select * into l from public.labels where id = p_label_id for update;
  if l.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into m from public.machines where id = l.machine_id;
  if (m.owner_org_id = actor or app.is_operator('verifier')) is not true then perform app.raise('FORBIDDEN'); end if;
  if p_reason not in ('destroyed', 'removed', 'lost', 'damaged', 'stolen') then perform app.raise('VALIDATION', '{"field":"reason"}'); end if;
  update public.labels set status = case when p_reason = 'lost' then 'lost'::public.label_status else 'revoked' end,
    revoked_at = now(), revoked_reason = p_reason where id = l.id;
  perform app.log_event('label.revoked', m.id, m.owner_org_id, actor, jsonb_build_object('label_id', l.id, 'label_serial', right(l.code, 6), 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Dealers order labels ("Beställ 50 märken"); the operator prints the batch (step 17).
create or replace function public.order_labels(p_org_id uuid, p_quantity int, p_shipping_address jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); b public.label_batches;
begin
  if p_quantity not in (10, 25, 50, 100, 250, 500) then perform app.raise('VALIDATION', '{"field":"quantity"}'); end if;
  insert into public.label_batches (quantity, status, assigned_org_id, ordered_by_org_id, shipping_address, created_by)
  values (p_quantity, 'ordered', actor, actor, p_shipping_address, auth.uid()) returning * into b;
  perform app.log_event('labels.ordered', null, actor, actor, jsonb_build_object('batch_id', b.id, 'quantity', p_quantity));
  perform app.notify_operators('labels.ordered', jsonb_build_object('batch_id', b.id, 'quantity', p_quantity,
    'org', (select name from public.organizations where id = actor)), '/admin/labels', 'info', 'superadmin');
  return to_jsonb(b);
end $$;

-- Operator: generate the codes of a batch (new or ordered) and mark it printed.
create or replace function public.print_label_batch(p_batch_id uuid default null, p_quantity int default null,
  p_assigned_org_id uuid default null, p_printer_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin'); b public.label_batches; i int;
begin
  if p_batch_id is null then
    if p_quantity is null or p_quantity not between 1 and 10000 then perform app.raise('VALIDATION', '{"field":"quantity"}'); end if;
    insert into public.label_batches (quantity, status, assigned_org_id, created_by) values (p_quantity, 'ordered', p_assigned_org_id, auth.uid())
    returning * into b;
  else
    select * into b from public.label_batches where id = p_batch_id for update;
    if b.id is null or b.status <> 'ordered' then perform app.raise('NOT_FOUND'); end if;
  end if;
  for i in 1..b.quantity loop
    insert into public.labels (code, batch_id, status, assigned_org_id, medium)
    values (app.generate_label_code(), b.id, case when b.assigned_org_id is null then 'printed' else 'assigned' end::public.label_status,
            b.assigned_org_id, b.medium);
  end loop;
  update public.label_batches set status = 'printed', printed_at = now(), printer_ref = p_printer_ref where id = b.id returning * into b;
  perform app.log_event('labels.printed', null, b.assigned_org_id, op, jsonb_build_object('batch_id', b.id, 'quantity', b.quantity));
  if b.assigned_org_id is not null then
    perform app.notify_org(b.assigned_org_id, 'labels.printed', jsonb_build_object('quantity', b.quantity), '/labels', 'info');
  end if;
  return to_jsonb(b);
end $$;

create or replace function public.list_labels(p_org_id uuid, p_status public.label_status default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return jsonb_build_object(
    'batches', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.label_batches b
      where b.assigned_org_id = actor or b.ordered_by_org_id = actor), '[]'::jsonb),
    'labels', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'serial', right(l.code, 6), 'status', l.status,
        'role', l.role, 'machine_id', l.machine_id, 'reg_number', m.reg_number, 'bound_at', l.bound_at) order by l.created_at desc)
      from (select * from public.labels l2 where l2.assigned_org_id = actor and (p_status is null or l2.status = p_status)
            order by l2.created_at desc limit least(greatest(p_limit, 1), 1000)) l
      left join public.machines m on m.id = l.machine_id), '[]'::jsonb));
end $$;

-- ---------- Public card & lookups ----------
-- Public (anon) card by QR code or registration number. Logging and rate limiting happen in Edge Function scan-log
-- (step 6), which wraps this function; the function itself returns only SPEC §5.3 fields.
create or replace function public.public_machine_card(p_code text default null, p_reg text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.labels; m public.machines; r text;
begin
  if p_code is not null then
    if p_code !~ '^[0-9A-Za-z]{22}$' then return jsonb_build_object('found', false, 'reason', 'invalid_code'); end if;
    select * into l from public.labels where code = p_code;
    if l.id is null or l.machine_id is null then return jsonb_build_object('found', false, 'reason', 'unknown_label'); end if;
    select * into m from public.machines where id = l.machine_id;
  elsif p_reg is not null then
    r := app.normalize_reg_number(p_reg);
    if not app.is_valid_reg_number(r) then return jsonb_build_object('found', false, 'reason', 'invalid_reg_number'); end if;
    select * into m from public.machines where reg_number = r;
  else
    return jsonb_build_object('found', false, 'reason', 'missing');
  end if;
  if m.id is null or m.status = 'draft' then return jsonb_build_object('found', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('found', true, 'card', app.public_card_json(m, l));
end $$;

-- Exact lookup for signed-in users (regnr, PIN/serial, VIN, road reg). Authority/operator partial search is separate.
create or replace function public.lookup_machine(p_org_id uuid, p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); q text := app.normalize_identifier(p_query); ids uuid[];
begin
  perform app.require_scope('machines:read');
  if q is null or length(q) < 3 then return '[]'::jsonb; end if;
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

-- Hook for access logging (defined in the documents/access migration).
create or replace function app.after_lookup(p_org_id uuid, p_machine_ids uuid[], p_via text)
returns void language sql volatile set search_path = '' as $$ select $$;

create or replace function public.get_machine(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); v jsonb;
begin
  perform app.require_scope('machines:read');
  if not (app.can_view_machine(p_machine_id) or app.is_operator()) then perform app.raise('NOT_FOUND'); end if;
  v := app.machine_view(p_machine_id, actor);
  if v is null then perform app.raise('NOT_FOUND'); end if;
  perform app.after_lookup(actor, array[p_machine_id], 'web');
  return v;
end $$;

create or replace function public.list_machines(p_org_id uuid, p_scope text default 'owned', p_query text default null,
  p_status public.machine_status default null, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if p_scope not in ('owned', 'used', 'registered', 'previous', 'stock', 'all') then perform app.raise('VALIDATION', '{"field":"scope"}'); end if;
  return jsonb_build_object(
    'total', (select count(*) from public.machines m where app.list_scope_match(m, actor, p_scope) and (p_status is null or m.status = p_status)
      and (q is null or m.reg_number = app.normalize_reg_number(q) or (coalesce(m.make, '') || ' ' || coalesce(m.model, '')) ilike '%' || q || '%'
           or exists (select 1 from public.machine_identifiers x where x.machine_id = m.id and x.normalized_value = app.normalize_identifier(q)))),
    'items', coalesce((select jsonb_agg(app.machine_list_item(m, actor) order by app.machine_status_rank(m.status), m.updated_at desc) from (
      select * from public.machines m where app.list_scope_match(m, actor, p_scope) and (p_status is null or m.status = p_status)
        and (q is null or m.reg_number = app.normalize_reg_number(q) or (coalesce(m.make, '') || ' ' || coalesce(m.model, '')) ilike '%' || q || '%'
             or exists (select 1 from public.machine_identifiers x where x.machine_id = m.id and x.normalized_value = app.normalize_identifier(q)))
      order by app.machine_status_rank(m.status), m.updated_at desc
      limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) m), '[]'::jsonb));
end $$;

create or replace function app.list_scope_match(m public.machines, p_org uuid, p_scope text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_scope
    when 'owned' then m.owner_org_id = p_org and m.status <> 'draft'
    when 'stock' then m.owner_org_id = p_org and m.status <> 'draft' and m.stock_status is not null
    when 'used' then m.user_org_id = p_org and m.status <> 'draft'
    when 'registered' then m.registered_by_org_id = p_org and m.status <> 'draft'
    when 'previous' then m.owner_org_id <> p_org and exists (select 1 from public.ownerships w where w.machine_id = m.id and w.owner_org_id = p_org and w.to_date is not null)
    when 'all' then (m.owner_org_id = p_org or m.user_org_id = p_org or m.registered_by_org_id = p_org) and m.status <> 'draft'
    else false end
$$;

-- Compact list item; later migrations add financing/next action by redefining app.machine_list_extras.
create or replace function app.machine_list_extras(m public.machines, p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;

create or replace function app.machine_list_item(m public.machines, p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'status', m.status, 'verification_level', m.verification_level,
    'make', m.make, 'model', m.model, 'year', m.year, 'category', m.category, 'hour_meter', m.hour_meter,
    'primary_photo_path', m.primary_photo_path, 'owner_org_id', m.owner_org_id, 'user_org_id', m.user_org_id,
    'stock_status', case when m.owner_org_id = p_org then m.stock_status end,
    'serial', case when m.owner_org_id = p_org or m.user_org_id = p_org or m.registered_by_org_id = p_org
                   then app.machine_primary_serial(m.id) else app.mask_serial(app.machine_primary_serial(m.id)) end,
    'emission_stage', m.emission_stage, 'fuel_type', m.fuel_type, 'service_weight_kg', m.service_weight_kg,
    'engine_power_kw', m.engine_power_kw, 'updated_at', m.updated_at) || app.machine_list_extras(m, p_org)
$$;

-- ---------- RLS ----------
alter table public.machine_models enable row level security;
alter table public.machines enable row level security;
alter table public.machine_identifiers enable row level security;
alter table public.ownerships enable row level security;
alter table public.label_batches enable row level security;
alter table public.labels enable row level security;
alter table public.conflicts enable row level security;
alter table public.oem_records enable row level security;
alter table public.vtr_lookups enable row level security;

revoke all on public.machine_models, public.machines, public.machine_identifiers, public.ownerships, public.label_batches,
  public.labels, public.conflicts, public.oem_records, public.vtr_lookups from anon, authenticated;
grant select on public.machine_models, public.machines, public.machine_identifiers, public.ownerships, public.label_batches,
  public.labels, public.conflicts, public.oem_records to authenticated;

create policy machine_models_read on public.machine_models for select to authenticated using (true);

create policy machines_read on public.machines for select to authenticated using (app.can_view_machine(id));

-- Identifiers in full only for relations with full access (insurers get masked values via RPC).
create policy machine_identifiers_read on public.machine_identifiers for select to authenticated using (
  app.has_full_access(app.machine_relations(machine_id)) or 'previous_owner' = any (app.machine_relations(machine_id))
);

create policy ownerships_read on public.ownerships for select to authenticated using (
  app.has_full_access(app.machine_relations(machine_id)) or owner_org_id = any (app.current_org_ids())
);

create policy label_batches_read on public.label_batches for select to authenticated using (
  assigned_org_id = any (app.current_org_ids()) or ordered_by_org_id = any (app.current_org_ids()) or app.is_operator()
);

create policy labels_read on public.labels for select to authenticated using (
  assigned_org_id = any (app.current_org_ids()) or app.is_operator()
  or (machine_id is not null and app.has_full_access(app.machine_relations(machine_id)))
);

create policy conflicts_read on public.conflicts for select to authenticated using (
  app.is_operator() or involved_org_ids && app.current_org_ids()
);

create policy oem_records_read on public.oem_records for select to authenticated using (
  manufacturer_org_id = any (app.current_org_ids()) or app.is_operator()
);
-- vtr_lookups: service/RPC only.

grant execute on function app.machine_relations(uuid, uuid[]), app.can_view_machine(uuid), app.has_full_access(text[])
  to authenticated, service_role;

grant execute on function
  public.save_machine_draft(uuid, jsonb, uuid), public.list_machine_drafts(uuid), public.delete_machine_draft(uuid, uuid),
  public.register_machine(uuid, jsonb, uuid), public.check_identifier(uuid, public.identifier_type, text),
  public.update_machine(uuid, uuid, jsonb), public.bind_label(uuid, uuid, text, public.label_role),
  public.revoke_label(uuid, uuid, text), public.order_labels(uuid, int, jsonb),
  public.print_label_batch(uuid, int, uuid, text), public.list_labels(uuid, public.label_status, int),
  public.lookup_machine(uuid, text), public.get_machine(uuid, uuid),
  public.list_machines(uuid, text, text, public.machine_status, int, int),
  public.lookup_vehicle_registry(text), public.lookup_oem(text), public.search_models(text, int)
  to authenticated;
grant execute on function public.public_machine_card(text, text) to anon, authenticated;
grant execute on function public.record_vtr_lookup(text, jsonb) to service_role;
