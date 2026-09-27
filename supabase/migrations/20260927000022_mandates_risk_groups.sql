-- Step 21 (interpreted from CLAUDE.md, ADR 0003 / 0018): mandates (fullmakt och kommission), risk signals and
-- monitoring after a check, groups (koncern) and departments (avdelningar).

-- =====================================================================================================================
-- Mandates
-- A principal (the owner) authorises an agent organisation for one machine (consignment / kommission) or for all its
-- machines (power of attorney / fullmakt) with explicit scopes: sell (start a transfer as seller's agent), fleet (hours,
-- service, daily checks, fuel), view (full machine view). Granted with the principal's BankID signature, accepted by
-- the agent, revocable by either side, time-limited. The owner stays the seller of record; every agent action is
-- logged with the mandate.
-- =====================================================================================================================
create table public.mandates (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('consignment', 'power_of_attorney')),
  principal_org_id       uuid not null references public.organizations (id),
  agent_org_id           uuid not null references public.organizations (id),
  machine_id             uuid references public.machines (id),
  scopes                 text[] not null check (cardinality(scopes) > 0 and scopes <@ array['sell', 'fleet', 'view']),
  valid_from             date not null default current_date,
  valid_to               date not null,
  status                 text not null default 'pending' check (status in ('pending', 'active', 'revoked', 'declined', 'completed')),
  note                   text check (length(note) <= 500),
  principal_signature_id uuid,
  created_by             uuid,
  accepted_by            uuid,
  accepted_at            timestamptz,
  ended_at               timestamptz,
  ended_reason           text,
  created_at             timestamptz not null default now(),
  check (principal_org_id <> agent_org_id),
  check (kind <> 'consignment' or machine_id is not null),
  check (valid_to >= valid_from and valid_to <= valid_from + 730)
);
create index mandates_agent_idx on public.mandates (agent_org_id, status);
create index mandates_machine_idx on public.mandates (machine_id) where machine_id is not null;
-- One open consignment per machine.
create unique index mandates_one_consignment on public.mandates (machine_id) where kind = 'consignment' and status in ('pending', 'active');

alter table public.mandates enable row level security;
revoke all on public.mandates from anon, authenticated;
grant select on public.mandates to authenticated;
create policy mandates_read on public.mandates for select to authenticated using (
  principal_org_id = any (app.current_org_ids()) or agent_org_id = any (app.current_org_ids()) or app.is_operator());

create or replace function app.has_mandate(p_machine_id uuid, p_org uuid, p_scope text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mandates d join public.machines m on m.id = p_machine_id
    where d.agent_org_id = p_org and d.status = 'active' and current_date between d.valid_from and d.valid_to and p_scope = any (d.scopes)
      and d.principal_org_id = m.owner_org_id and (d.machine_id = m.id or (d.machine_id is null and d.kind = 'power_of_attorney')))
$$;

create or replace function app.sigtext_grant_mandate(p_subject_id uuid, p_params jsonb, p_locale text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare principal text := (select name from public.organizations where id = p_subject_id);
  agent text := (select name from public.organizations where id = (p_params ->> 'agent_org_id')::uuid);
  machine text := (select app.format_reg_number(reg_number) || ' (' || make || ' ' || model || ')' from public.machines where id = nullif(p_params ->> 'machine_id', '')::uuid);
  scopes text := (select string_agg(case s
      when 'sell' then case when p_locale = 'en' then 'sell' else 'sälja' end
      when 'view' then case when p_locale = 'en' then 'see all information' else 'se all information' end
      when 'fleet' then case when p_locale = 'en' then 'manage operation and service' else 'sköta drift och service' end
      else s end, ', ') from unnest(string_to_array(p_params ->> 'scopes', ', ')) s);
begin
  -- "a, b och c" / "a, b and c"
  scopes := regexp_replace(scopes, ', ([^,]*)$', case when p_locale = 'en' then ' and \1' else ' och \1' end);
  if agent is null then perform app.raise('NOT_FOUND', '{"what":"agent"}'); end if;
  return case when p_locale = 'en'
    then format('%s authorises %s on its behalf to %s regarding %s until %s.', principal, agent, scopes, coalesce(machine, 'all its machines'), p_params ->> 'valid_to')
    else format('%s ger %s fullmakt att för %s räkning %s om %s till och med %s.', principal, agent, principal,
      scopes, coalesce(machine, 'samtliga maskiner'), p_params ->> 'valid_to') end;
end $$;

create or replace function public.grant_mandate(p_org_id uuid, p_agent_org_id uuid, p_kind text, p_machine_id uuid, p_scopes text[],
  p_valid_to date, p_note text default null, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates; m public.machines; sig uuid; scopes text[];
begin
  scopes := (select array_agg(distinct s order by s) from unnest(p_scopes) s);
  if p_machine_id is not null then
    select * into m from public.machines where id = p_machine_id;
    if m.id is null or m.owner_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
    perform app.assert_not_blocked(m.id, 'grant_mandate');
  end if;
  if not exists (select 1 from public.organizations where id = p_agent_org_id and status = 'approved') then perform app.raise('VALIDATION', '{"field":"agent_org_id"}'); end if;
  -- Consignment sales go to dealers; a power of attorney may go to any approved organisation.
  if p_kind = 'consignment' and not app.has_org_type(p_agent_org_id, 'dealer') then perform app.raise('VALIDATION', '{"field":"agent_org_id","reason":"dealer_required"}'); end if;
  sig := app.consume_signature(p_signature_id, 'grant_mandate', actor, jsonb_build_object('agent_org_id', p_agent_org_id,
    'machine_id', coalesce(p_machine_id::text, ''), 'scopes', array_to_string(scopes, ', '), 'valid_to', p_valid_to::text));
  insert into public.mandates (kind, principal_org_id, agent_org_id, machine_id, scopes, valid_to, note, principal_signature_id, created_by)
  values (p_kind, actor, p_agent_org_id, p_machine_id, scopes, p_valid_to, nullif(trim(p_note), ''), sig, auth.uid()) returning * into d;
  perform app.log_event('mandate.granted', p_machine_id, actor, actor, jsonb_build_object('mandate_id', d.id, 'kind', d.kind,
    'agent_org_id', d.agent_org_id, 'scopes', d.scopes, 'valid_to', d.valid_to));
  perform app.notify_org(d.agent_org_id, 'mandate.granted', jsonb_build_object('mandate_id', d.id, 'principal', (select name from public.organizations where id = actor),
    'kind', d.kind, 'reg_number', m.reg_number), '/mandates', 'info', 'admin');
  return to_jsonb(d);
exception when check_violation or unique_violation or invalid_text_representation then
  perform app.raise('VALIDATION', '{"field":"mandate"}');
end $$;

create or replace function public.respond_mandate(p_org_id uuid, p_mandate_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates;
begin
  update public.mandates set status = case when p_accept then 'active' else 'declined' end, accepted_by = auth.uid(), accepted_at = now(),
    ended_at = case when p_accept then null else now() end
  where id = p_mandate_id and agent_org_id = actor and status = 'pending' returning * into d;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event(case when p_accept then 'mandate.accepted' else 'mandate.declined' end, d.machine_id, d.principal_org_id, actor,
    jsonb_build_object('mandate_id', d.id, 'kind', d.kind));
  perform app.notify_org(d.principal_org_id, case when p_accept then 'mandate.accepted' else 'mandate.declined' end,
    jsonb_build_object('mandate_id', d.id, 'agent', (select name from public.organizations where id = actor)), '/mandates', 'info', 'admin');
  return to_jsonb(d);
end $$;

create or replace function public.revoke_mandate(p_org_id uuid, p_mandate_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates;
begin
  update public.mandates set status = 'revoked', ended_at = now(), ended_reason = left(nullif(trim(p_reason), ''), 300)
  where id = p_mandate_id and (principal_org_id = actor or agent_org_id = actor) and status in ('pending', 'active') returning * into d;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('mandate.revoked', d.machine_id, d.principal_org_id, actor, jsonb_build_object('mandate_id', d.id, 'kind', d.kind));
  perform app.notify_org(case when actor = d.principal_org_id then d.agent_org_id else d.principal_org_id end, 'mandate.revoked',
    jsonb_build_object('mandate_id', d.id, 'by', (select name from public.organizations where id = actor)), '/mandates', 'warning', 'admin');
  return to_jsonb(d);
end $$;

create or replace function public.list_mandates(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object(
      'direction', case when d.principal_org_id = actor then 'granted' else 'received' end,
      'effective_status', case when d.status = 'active' and d.valid_to < current_date then 'expired' else d.status end,
      'principal', app.org_brief(d.principal_org_id), 'agent', app.org_brief(d.agent_org_id),
      'machine', (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model) from public.machines m where m.id = d.machine_id))
      order by (d.status in ('pending', 'active')) desc, d.created_at desc)
    from public.mandates d where d.principal_org_id = actor or d.agent_org_id = actor), '[]'::jsonb);
end $$;

-- Transfers: the agent may start a transfer with the owner as seller of record (scope 'sell').
create or replace function public.initiate_transfer(p_org_id uuid, p_machine_id uuid, p_sale_date date default current_date,
  p_to_org_id uuid default null, p_to_org_number text default null, p_to_email text default null,
  p_new_financing jsonb default null, p_document_ids uuid[] default '{}', p_is_trade_in boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; buyer uuid; t public.transfers; fin public.encumbrances; agent boolean;
begin
  perform app.require_scope('transfers:write');
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  fin := app.active_financing(m.id);
  agent := m.owner_org_id <> actor and app.has_mandate(m.id, actor, 'sell');
  -- Seller: current owner (dealer for stock machines), the holder of a leasing object, an agent with a sell mandate, or an operator.
  if (m.owner_org_id = actor or (fin.type = 'leasing' and fin.holder_org_id = actor) or agent or app.is_operator('superadmin')) is not true then
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
  if agent then
    perform app.log_event('mandate.used', m.id, m.owner_org_id, actor, jsonb_build_object('transfer_id', t.id, 'scope', 'sell'));
    perform app.notify_org(m.owner_org_id, 'mandate.sale_started', jsonb_build_object('reg_number', m.reg_number, 'transfer_id', t.id,
      'agent', (select name from public.organizations where id = actor)), '/transfers/' || t.id, 'info', 'admin');
  end if;
  return jsonb_build_object('ok', true, 'transfer', app.transfer_json(t));
end $$;

-- Fleet actions (hours, service, daily checks, fuel) for owner, user or an agent with the 'fleet' scope.
create or replace function app.require_fleet_access(p_machine_id uuid, p_actor uuid)
returns public.machines language plpgsql stable security definer set search_path = '' as $$
declare m public.machines;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  if (app.machine_relations(m.id, array[p_actor]) && array['owner', 'user']) is not true and not app.has_mandate(m.id, p_actor, 'fleet') then
    perform app.raise('FORBIDDEN');
  end if;
  return m;
end $$;

-- A completed transfer ends the machine's mandates (the new owner has not granted them). Keeps step 13/18 logic.
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
  update public.mandates set status = 'completed', ended_at = now(), ended_reason = 'ownership_transferred'
  where status in ('pending', 'active') and (machine_id = t.machine_id);
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

-- =====================================================================================================================
-- Groups (koncern) and departments (avdelningar)
-- A subsidiary requests a parent; the parent's admin accepts. The parent then reads the subsidiaries' machines
-- (relation 'group'), but never writes on their behalf. Departments are an organisation's own grouping of machines.
-- =====================================================================================================================
create table public.org_group_links (
  id            uuid primary key default gen_random_uuid(),
  child_org_id  uuid not null references public.organizations (id),
  parent_org_id uuid not null references public.organizations (id),
  status        text not null default 'pending' check (status in ('pending', 'active', 'declined', 'ended')),
  requested_by  uuid,
  decided_by    uuid,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  check (child_org_id <> parent_org_id)
);
create unique index org_group_links_one_open on public.org_group_links (child_org_id) where status in ('pending', 'active');

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id),
  name       text not null check (length(trim(name)) between 1 and 80),
  code       text check (length(code) <= 20),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table public.machine_departments (
  org_id        uuid not null references public.organizations (id),
  machine_id    uuid not null references public.machines (id),
  department_id uuid not null references public.departments (id) on delete cascade,
  primary key (org_id, machine_id)
);

alter table public.org_group_links enable row level security;
alter table public.departments enable row level security;
alter table public.machine_departments enable row level security;
revoke all on public.org_group_links, public.departments, public.machine_departments from anon, authenticated;
grant select on public.org_group_links, public.departments, public.machine_departments to authenticated;
create policy group_links_read on public.org_group_links for select to authenticated using (
  child_org_id = any (app.current_org_ids()) or parent_org_id = any (app.current_org_ids()) or app.is_operator());
create policy departments_read on public.departments for select to authenticated using (org_id = any (app.current_org_ids()));
create policy machine_departments_read on public.machine_departments for select to authenticated using (org_id = any (app.current_org_ids()));

create or replace function public.request_group_link(p_org_id uuid, p_parent_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); l public.org_group_links;
begin
  if not exists (select 1 from public.organizations where id = p_parent_org_id and status = 'approved' and 'operator' <> all (types)) then
    perform app.raise('VALIDATION', '{"field":"parent_org_id"}');
  end if;
  -- One level only: a parent cannot itself be a subsidiary, and a subsidiary cannot have subsidiaries.
  if exists (select 1 from public.organizations where id = p_parent_org_id and parent_org_id is not null)
     or exists (select 1 from public.organizations where parent_org_id = actor) then
    perform app.raise('VALIDATION', '{"field":"parent_org_id","reason":"one_level"}');
  end if;
  insert into public.org_group_links (child_org_id, parent_org_id, requested_by) values (actor, p_parent_org_id, auth.uid()) returning * into l;
  perform app.notify_org(p_parent_org_id, 'group.requested', jsonb_build_object('link_id', l.id, 'child', (select name from public.organizations where id = actor)),
    '/settings?tab=group', 'info', 'admin');
  return to_jsonb(l);
exception when unique_violation then
  perform app.raise('VALIDATION', '{"field":"parent_org_id","reason":"already_linked"}');
end $$;

create or replace function public.decide_group_link(p_org_id uuid, p_link_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); l public.org_group_links;
begin
  update public.org_group_links set status = case when p_accept then 'active' else 'declined' end, decided_by = auth.uid(), decided_at = now()
  where id = p_link_id and parent_org_id = actor and status = 'pending' returning * into l;
  if l.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_accept then
    update public.organizations set parent_org_id = actor where id = l.child_org_id;
    perform app.log_event('org.group_linked', null, l.child_org_id, actor, jsonb_build_object('parent_org_id', actor));
  end if;
  perform app.notify_org(l.child_org_id, case when p_accept then 'group.accepted' else 'group.declined' end,
    jsonb_build_object('parent', (select name from public.organizations where id = actor)), '/settings?tab=group', 'info', 'admin');
  return to_jsonb(l);
end $$;

create or replace function public.end_group_link(p_org_id uuid, p_link_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); l public.org_group_links;
begin
  update public.org_group_links set status = 'ended', decided_at = now()
  where id = p_link_id and (child_org_id = actor or parent_org_id = actor) and status in ('pending', 'active') returning * into l;
  if l.id is null then perform app.raise('NOT_FOUND'); end if;
  update public.organizations set parent_org_id = null where id = l.child_org_id and parent_org_id = l.parent_org_id;
  perform app.log_event('org.group_unlinked', null, l.child_org_id, actor, jsonb_build_object('parent_org_id', l.parent_org_id));
  return to_jsonb(l);
end $$;

create or replace function public.get_group(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return jsonb_build_object(
    'parent', (select app.org_brief(o.parent_org_id) from public.organizations o where o.id = actor),
    'links', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('child', app.org_brief(l.child_org_id), 'parent', app.org_brief(l.parent_org_id),
        'direction', case when l.child_org_id = actor then 'up' else 'down' end,
        'machines', (select count(*) from public.machines m where m.owner_org_id = l.child_org_id and m.status <> 'draft')) order by l.created_at desc)
      from public.org_group_links l where (l.child_org_id = actor or l.parent_org_id = actor) and l.status in ('pending', 'active')), '[]'::jsonb));
end $$;

-- Group fleet: the parent's read-only view of its subsidiaries' machines.
create or replace function public.list_group_machines(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.machine_list_item(m, m.owner_org_id) || jsonb_build_object('company', app.org_brief(m.owner_org_id))
      order by o.name, m.reg_number)
    from public.machines m join public.organizations o on o.id = m.owner_org_id
    where o.parent_org_id = actor and m.status <> 'draft'), '[]'::jsonb);
end $$;

create or replace function public.save_department(p_org_id uuid, p_name text, p_code text default null, p_department_id uuid default null, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.departments;
begin
  if p_department_id is null then
    insert into public.departments (org_id, name, code) values (actor, trim(p_name), nullif(trim(p_code), '')) returning * into d;
  else
    update public.departments set name = trim(p_name), code = nullif(trim(p_code), ''), active = coalesce(p_active, active)
    where id = p_department_id and org_id = actor returning * into d;
    if d.id is null then perform app.raise('NOT_FOUND'); end if;
  end if;
  return to_jsonb(d);
exception when check_violation or unique_violation or not_null_violation then
  perform app.raise('VALIDATION', '{"field":"name"}');
end $$;

create or replace function public.list_departments(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('machines', (select count(*) from public.machine_departments md where md.department_id = d.id))
      order by d.active desc, d.name) from public.departments d where d.org_id = actor), '[]'::jsonb);
end $$;

create or replace function public.set_machine_department(p_org_id uuid, p_machine_id uuid, p_department_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines;
begin
  m := app.require_fleet_access(p_machine_id, actor);
  if p_department_id is null then
    delete from public.machine_departments where org_id = actor and machine_id = m.id;
  else
    if not exists (select 1 from public.departments where id = p_department_id and org_id = actor and active) then perform app.raise('NOT_FOUND', '{"what":"department"}'); end if;
    insert into public.machine_departments (org_id, machine_id, department_id) values (actor, m.id, p_department_id)
    on conflict (org_id, machine_id) do update set department_id = excluded.department_id;
  end if;
  perform app.log_event('machine.department_set', m.id, m.owner_org_id, actor, jsonb_build_object('department_id', p_department_id));
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================================================================
-- Relations: agent (mandate with view/sell/fleet) and group (parent of the owner) get the full, read-only view.
-- =====================================================================================================================
create or replace function app.has_full_access(p_rel text[])
returns boolean language sql immutable set search_path = '' as $$
  select p_rel && array['operator', 'authority', 'owner', 'user', 'registered_by', 'draft_owner', 'holder', 'transfer_party', 'inspector_assigned',
    'agent', 'group']
$$;

create or replace function app.machine_relations_more(m public.machines, p_orgs uuid[])
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.verification_requests v where v.machine_id = m.id and v.reviewer_org_id = any (p_orgs)
                      and v.status in ('open', 'in_review', 'needs_info')) then 'inspector_assigned' end,
    case when exists (select 1 from public.insurance_policies ip where ip.machine_id = m.id and ip.insurer_org_id = any (p_orgs)
                      and ip.status = 'active' and ip.valid_to >= current_date) then 'insurer' end,
    case when exists (select 1 from public.rentals r where r.machine_id = m.id and r.lessee_org_id = any (p_orgs)
                      and r.status in ('active', 'overdue')) then 'lessee' end,
    case when exists (select 1 from unnest(p_orgs) o where app.has_mandate(m.id, o, 'view') or app.has_mandate(m.id, o, 'sell')
                      or app.has_mandate(m.id, o, 'fleet')) then 'agent' end,
    case when exists (select 1 from public.organizations o where o.id in (m.owner_org_id, m.user_org_id) and o.parent_org_id = any (p_orgs)) then 'group' end
  ], null)
$$;

-- Dealer stock includes machines held on consignment.
create or replace function app.list_scope_match(m public.machines, p_org uuid, p_scope text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_scope
    when 'owned' then m.owner_org_id = p_org and m.status <> 'draft'
    when 'stock' then m.status <> 'draft' and ((m.owner_org_id = p_org and m.stock_status is not null)
      or exists (select 1 from public.mandates d where d.machine_id = m.id and d.agent_org_id = p_org and d.kind = 'consignment'
                 and d.status = 'active' and current_date between d.valid_from and d.valid_to))
    when 'used' then m.user_org_id = p_org and m.status <> 'draft'
    when 'registered' then m.registered_by_org_id = p_org and m.status <> 'draft'
    when 'previous' then m.owner_org_id <> p_org and exists (select 1 from public.ownerships w where w.machine_id = m.id and w.owner_org_id = p_org and w.to_date is not null)
    when 'all' then (m.owner_org_id = p_org or m.user_org_id = p_org or m.registered_by_org_id = p_org) and m.status <> 'draft'
    else false end
$$;

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
      where d.machine_id = m.id and d.org_id = p_org order by d.created_at desc limit 1),
    'department', (select jsonb_build_object('id', dp.id, 'name', dp.name) from public.machine_departments md join public.departments dp on dp.id = md.department_id
      where md.machine_id = m.id and md.org_id = p_org),
    'consignment', (select jsonb_build_object('mandate_id', d.id, 'principal', (select name from public.organizations where id = d.principal_org_id), 'valid_to', d.valid_to)
      from public.mandates d where d.machine_id = m.id and d.agent_org_id = p_org and d.kind = 'consignment' and d.status = 'active' limit 1))
$$;

-- =====================================================================================================================
-- Risk signals (check result) and monitoring after a check
-- =====================================================================================================================
create or replace function app.risk_signals(p_machine_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'severity', severity) order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, code), '[]'::jsonb)
  from (
    select 'active_flag' code, 'high' severity where exists (select 1 from public.flags where machine_id = p_machine_id and status = 'active')
    union all select 'open_conflict', 'high' where exists (select 1 from public.conflicts where status = 'open' and p_machine_id in (machine_id, related_machine_id))
    union all select 'frequent_transfers', 'high'
      where (select count(*) from public.ownerships where machine_id = p_machine_id and from_date > current_date - 730 and acquired_via = 'transfer') >= 3
    union all select 'listed_by_other_seller', 'high'
      where exists (select 1 from public.market_alerts where machine_id = p_machine_id and status = 'open' and type in ('seller_not_owner', 'duplicate_serial_in_market'))
    union all select 'recent_owner_change', 'medium'
      where exists (select 1 from public.ownerships where machine_id = p_machine_id and to_date is null and acquired_via = 'transfer' and from_date > current_date - 90)
    union all select 'new_unverified_registration', 'medium'
      where exists (select 1 from public.machines where id = p_machine_id and verification_level = 0 and created_at > now() - interval '30 days')
    union all select 'hour_meter_corrected', 'medium'
      where exists (select 1 from public.maintenance_entries where machine_id = p_machine_id and type = 'hour_reading' and notes = 'correction'
                    and performed_at > current_date - 365)
    union all select 'many_recent_checks', 'medium'
      where (select count(distinct performed_by_org_id) from public.check_receipts where machine_id = p_machine_id and created_at > now() - interval '30 days') >= 3
    union all select 'listed_for_sale', 'info'
      where exists (select 1 from public.market_observations where matched_machine_id = p_machine_id and active)
    union all select 'open_transfer', 'info'
      where exists (select 1 from public.transfers where machine_id = p_machine_id and status in ('awaiting_buyer', 'awaiting_financier'))
    union all select 'financing_recently_released', 'info'
      where exists (select 1 from public.encumbrances where machine_id = p_machine_id and status = 'released' and released_at > now() - interval '30 days')
  ) s
$$;

create or replace function app.check_one(p_actor uuid, p_query jsonb, p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q text; typ text; mid uuid; m public.machines; fin public.encumbrances; res jsonb; rn text; r public.check_receipts; see_holder boolean;
begin
  typ := coalesce(p_query ->> 'type', case when p_query ? 'reg' then 'reg' when p_query ? 'pin' then 'pin' when p_query ? 'vin' then 'vin'
                                           when p_query ? 'road_reg' then 'road_reg' else 'serial' end);
  q := app.normalize_identifier(coalesce(p_query ->> 'value', p_query ->> typ));
  if q is null then perform app.raise('VALIDATION', '{"field":"query"}'); end if;
  if typ = 'any' and app.is_valid_reg_number(q) and exists (select 1 from public.machines where reg_number = q and status <> 'draft') then
    typ := 'reg';
  end if;
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
      'market_listings', app.market_listings_for(m.id),
      -- Risk signals are indicators to look closer, never a verdict (ADR 0018). Computed before this check is stored.
      'risk_signals', app.risk_signals(m.id));
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

-- Monitoring after a check: the checker follows the machine for 30–180 days (e.g. until the loan is paid out).
alter table public.watchlist add column expires_at timestamptz;
alter table public.watchlist add column receipt_id uuid references public.check_receipts (id);

create or replace function public.watch_after_check(p_org_id uuid, p_receipt_id uuid, p_days int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); r public.check_receipts; reg text; w public.watchlist;
begin
  select * into r from public.check_receipts where id = p_receipt_id and performed_by_org_id = actor;
  if r.id is null or r.machine_id is null then perform app.raise('NOT_FOUND'); end if;
  if p_days not in (30, 90, 180) then perform app.raise('VALIDATION', '{"field":"days"}'); end if;
  select reg_number into reg from public.machines where id = r.machine_id;
  insert into public.watchlist (org_id, user_id, identifier_type, identifier_value, normalized_value, note, expires_at, receipt_id)
  values (actor, auth.uid(), 'reg', reg, reg, 'Bevakning efter kontroll ' || r.receipt_number, now() + make_interval(days => p_days), r.id)
  on conflict (org_id, normalized_value) do update set
    -- A permanent watch stays permanent; otherwise the later end date wins.
    expires_at = case when public.watchlist.expires_at is null then null else greatest(public.watchlist.expires_at, excluded.expires_at) end,
    receipt_id = coalesce(public.watchlist.receipt_id, excluded.receipt_id)
  returning * into w;
  return jsonb_build_object('ok', true, 'watch', to_jsonb(w));
end $$;

create or replace function public.add_watch(p_org_id uuid, p_type text, p_value text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); w public.watchlist; n text := app.normalize_identifier(p_value);
begin
  if p_type not in ('reg', 'pin', 'serial', 'vin', 'road_reg', 'any') then perform app.raise('VALIDATION', '{"field":"type"}'); end if;
  if n is null or length(n) < 3 then perform app.raise('VALIDATION', '{"field":"value"}'); end if;
  if p_type = 'reg' and not app.is_valid_reg_number(n) then perform app.raise('VALIDATION', '{"field":"value","reason":"check_character"}'); end if;
  if (select count(*) from public.watchlist where org_id = actor) >= 5000 then perform app.raise('VALIDATION', '{"field":"value","reason":"limit"}'); end if;
  insert into public.watchlist (org_id, user_id, identifier_type, identifier_value, normalized_value, note)
  values (actor, auth.uid(), p_type, trim(p_value), n, nullif(trim(p_note), ''))
  -- A manual watch is permanent, also when it replaces a watch after a check.
  on conflict (org_id, normalized_value) do update set note = excluded.note, identifier_type = excluded.identifier_type, expires_at = null returning * into w;
  return jsonb_build_object('ok', true, 'watch', to_jsonb(w), 'current', (select jsonb_build_object('reg_number', m.reg_number, 'status', m.status)
    from public.machines m where m.status <> 'draft' and (m.reg_number = n or exists (select 1 from public.machine_identifiers x
      where x.machine_id = m.id and x.normalized_value = n)) limit 1));
end $$;

create or replace function app.watchlist_on_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare w record; reg text;
begin
  if new.machine_id is null or new.type not in ('machine.registered', 'flag.raised', 'flag.cleared', 'ownership.transferred',
       'encumbrance.registered', 'encumbrance.released', 'machine.deregistered', 'market.listed', 'transfer.initiated', 'conflict.created') then
    return null;
  end if;
  select reg_number into reg from public.machines where id = new.machine_id;
  for w in select distinct on (wl.org_id) wl.* from public.watchlist wl
           where wl.org_id is distinct from new.actor_org_id and (wl.expires_at is null or wl.expires_at > now())
             and (wl.normalized_value = reg or wl.normalized_value in (select x.normalized_value from public.machine_identifiers x where x.machine_id = new.machine_id)) loop
    perform app.notify_org(w.org_id, 'watch.hit', jsonb_build_object('watch_id', w.id, 'value', w.identifier_value, 'reg_number', reg,
      'event', new.type, 'after_check', w.receipt_id is not null), '/watchlist',
      case when new.type in ('flag.raised', 'encumbrance.registered', 'conflict.created') then 'warning' else 'info' end::public.notification_severity);
  end loop;
  return null;
end $$;

grant execute on function public.grant_mandate(uuid, uuid, text, uuid, text[], date, text, uuid), public.respond_mandate(uuid, uuid, boolean),
  public.revoke_mandate(uuid, uuid, text), public.list_mandates(uuid), public.request_group_link(uuid, uuid), public.decide_group_link(uuid, uuid, boolean),
  public.end_group_link(uuid, uuid), public.get_group(uuid), public.list_group_machines(uuid), public.save_department(uuid, text, text, uuid, boolean),
  public.list_departments(uuid), public.set_machine_department(uuid, uuid, uuid), public.watch_after_check(uuid, uuid, int) to authenticated;
select app.grant_api_access();
