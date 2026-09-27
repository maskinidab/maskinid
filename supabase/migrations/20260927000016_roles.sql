-- Step 14: role portals (SPEC §7.4, §7.5, §9.2) – financier/insurer portfolio and alerts, watchlist, authority search,
-- flags overview, export check, preparedness export, register extract, manufacturer (OEM) data, insurer requirements.

-- ---------- Watchlist ("bevaka serienummer") ----------
create table public.watchlist (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id),
  user_id          uuid,
  identifier_type  text not null check (identifier_type in ('reg', 'pin', 'serial', 'vin', 'road_reg', 'any')),
  identifier_value text not null check (length(identifier_value) between 3 and 64),
  normalized_value text not null,
  note             text check (note is null or length(note) <= 500),
  created_at       timestamptz not null default now(),
  unique (org_id, normalized_value)
);
create index watchlist_value_idx on public.watchlist (normalized_value);
alter table public.watchlist enable row level security;
revoke all on public.watchlist from anon, authenticated;
grant select on public.watchlist to authenticated;
create policy watchlist_read on public.watchlist for select to authenticated using (org_id = any (app.current_org_ids()));

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
  on conflict (org_id, normalized_value) do update set note = excluded.note, identifier_type = excluded.identifier_type returning * into w;
  return jsonb_build_object('ok', true, 'watch', to_jsonb(w), 'current', (select jsonb_build_object('reg_number', m.reg_number, 'status', m.status)
    from public.machines m where m.status <> 'draft' and (m.reg_number = n or exists (select 1 from public.machine_identifiers x
      where x.machine_id = m.id and x.normalized_value = n)) limit 1));
end $$;

create or replace function public.remove_watch(p_org_id uuid, p_watch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id);
begin
  delete from public.watchlist where id = p_watch_id and org_id = actor;
  if not found then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_watch(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(w) || jsonb_build_object('match', (select jsonb_build_object('reg_number', m.reg_number, 'status', m.status,
      'make', m.make, 'model', m.model) from public.machines m where m.status <> 'draft' and (m.reg_number = w.normalized_value
      or exists (select 1 from public.machine_identifiers x where x.machine_id = m.id and x.normalized_value = w.normalized_value)) limit 1))
      order by w.created_at desc)
    from public.watchlist w where w.org_id = actor), '[]'::jsonb);
end $$;

-- Watch hits: after an event on a machine whose reg number or identifier is watched, notify the watching org
-- (never the org that caused the event). Only the reg number and event type are disclosed.
create or replace function app.watchlist_on_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare w record; reg text;
begin
  if new.machine_id is null or new.type not in ('machine.registered', 'flag.raised', 'flag.cleared', 'ownership.transferred',
       'encumbrance.registered', 'encumbrance.released', 'machine.deregistered', 'market.listed') then
    return null;
  end if;
  select reg_number into reg from public.machines where id = new.machine_id;
  for w in select distinct on (wl.org_id) wl.* from public.watchlist wl
           where wl.org_id is distinct from new.actor_org_id
             and (wl.normalized_value = reg or wl.normalized_value in (select x.normalized_value from public.machine_identifiers x where x.machine_id = new.machine_id)) loop
    perform app.notify_org(w.org_id, 'watch.hit', jsonb_build_object('watch_id', w.id, 'value', w.identifier_value, 'reg_number', reg,
      'event', new.type), '/watchlist', case when new.type = 'flag.raised' then 'warning' else 'info' end::public.notification_severity);
  end loop;
  return null;
end $$;
create trigger events_watchlist after insert on public.events for each row execute function app.watchlist_on_event();

-- ---------- Portfolio (financier: encumbrances held; insurer: policies issued) ----------
alter table public.insurance_policies add column requires_verification_level smallint check (requires_verification_level in (1, 2));

create or replace function public.list_portfolio(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if app.has_org_type(actor, 'financier') then
    return coalesce((select jsonb_agg(jsonb_build_object('kind', 'encumbrance', 'id', e.id, 'type', e.type, 'status', e.status,
        'contract_ref', e.contract_ref, 'start_date', e.start_date, 'end_date', e.end_date, 'machine_id', m.id, 'reg_number', m.reg_number,
        'make', m.make, 'model', m.model, 'year', m.year, 'machine_status', m.status, 'verification_level', m.verification_level,
        'owner', (select name from public.organizations where id = m.owner_org_id),
        'flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
        'open_transfer', (select t.status from public.transfers t where t.machine_id = m.id and t.status in ('awaiting_buyer', 'awaiting_financier') limit 1),
        'last_event_at', (select max(created_at) from public.events ev where ev.machine_id = m.id)) order by e.start_date desc)
      from public.encumbrances e join public.machines m on m.id = e.machine_id
      where e.holder_org_id = actor and e.status in ('active', 'pending')), '[]'::jsonb);
  elsif app.has_org_type(actor, 'insurer') then
    return coalesce((select jsonb_agg(jsonb_build_object('kind', 'policy', 'id', ip.id, 'policy_number', ip.policy_number, 'coverage', ip.coverage,
        'status', ip.status, 'valid_from', ip.valid_from, 'valid_to', ip.valid_to, 'requires_verification_level', ip.requires_verification_level,
        'machine_id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year, 'machine_status', m.status,
        'verification_level', m.verification_level, 'owner', (select name from public.organizations where id = m.owner_org_id),
        'flags', coalesce((select jsonb_agg(f.type) from public.flags f where f.machine_id = m.id and f.status = 'active'), '[]'::jsonb),
        'last_event_at', (select max(created_at) from public.events ev where ev.machine_id = m.id)) order by ip.valid_to desc)
      from public.insurance_policies ip join public.machines m on m.id = ip.machine_id
      where ip.insurer_org_id = actor and ip.status = 'active'), '[]'::jsonb);
  end if;
  perform app.raise('FORBIDDEN');
  return null;
end $$;

create or replace function public.set_policy_requirement(p_org_id uuid, p_policy_id uuid, p_level smallint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); ip public.insurance_policies; m public.machines;
begin
  update public.insurance_policies set requires_verification_level = p_level where id = p_policy_id and insurer_org_id = actor returning * into ip;
  if ip.id is null then perform app.raise('NOT_FOUND'); end if;
  select * into m from public.machines where id = ip.machine_id;
  if p_level is not null and m.verification_level < p_level and m.owner_org_id is not null then
    perform app.notify_org(m.owner_org_id, 'insurance.requires_verification', jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number,
      'insurer', ip.insurer_name, 'level', p_level), '/machines/' || m.id, 'warning');
  end if;
  perform app.log_event('insurance.requirement_set', m.id, m.owner_org_id, actor, jsonb_build_object('policy_id', ip.id, 'level', p_level));
  return jsonb_build_object('ok', true);
end $$;

-- Alerts: what happened to machines in the org's portfolio (by others). Market alerts are added in step 16.
create or replace function app.portfolio_machine_ids(p_org uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select e.machine_id as id from public.encumbrances e where e.holder_org_id = p_org and e.status in ('active', 'pending')
    union select ip.machine_id from public.insurance_policies ip where ip.insurer_org_id = p_org and ip.status = 'active'
    union select m.id from public.machines m where m.owner_org_id = p_org and m.stock_status is not null
  ) x
$$;

create or replace function public.list_alerts(p_org_id uuid, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); ids uuid[] := app.portfolio_machine_ids(actor);
  auth_ boolean := app.has_org_type(actor, 'authority');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'type', e.type, 'created_at', e.created_at, 'machine_id', e.machine_id,
      'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'actor', (select name from public.organizations where id = e.actor_org_id),
      'payload', e.payload - 'api_key_id') order by e.seq desc)
    from (select * from public.events ev
          where ((ev.machine_id = any (ids) and ev.type in ('flag.raised', 'flag.cleared', 'transfer.initiated', 'ownership.transferred',
                  'conflict.created', 'encumbrance.registered', 'encumbrance.released', 'machine.deregistered', 'machine.scanned_while_stolen',
                  'market.listed', 'market.alert'))
                 or (auth_ and ev.type in ('flag.raised', 'flag.cleared', 'machine.scanned_while_stolen', 'sighting.reported')))
            and ev.actor_org_id is distinct from actor
          order by ev.seq desc limit least(greatest(p_limit, 1), 500)) e
    left join public.machines m on m.id = e.machine_id), '[]'::jsonb);
end $$;

-- ---------- Authority ----------
create or replace function app.require_authority(p_actor uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (app.has_org_type(p_actor, 'authority') or app.is_operator()) is not true then perform app.raise('FORBIDDEN'); end if;
end $$;

-- Partial search (SPEC §7.5): reg number, serial fragment (≥ 4 characters) or make + model + year. Logged per machine.
create or replace function public.authority_search(p_org_id uuid, p_query text default null, p_make text default null, p_model text default null,
  p_year int default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); q text := app.normalize_identifier(p_query); ids uuid[];
begin
  perform app.require_authority(actor);
  if coalesce(length(q), 0) < 4 and nullif(trim(p_make), '') is null and nullif(trim(p_model), '') is null then
    perform app.raise('VALIDATION', '{"field":"query","reason":"min_4"}');
  end if;
  select array_agg(id) into ids from (
    select m.id from public.machines m
    where m.status <> 'draft'
      and (q is null or length(q) < 4 or m.reg_number like '%' || q || '%'
           or exists (select 1 from public.machine_identifiers x where x.machine_id = m.id and x.normalized_value like '%' || q || '%'))
      and (nullif(trim(p_make), '') is null or m.make ilike trim(p_make) || '%')
      and (nullif(trim(p_model), '') is null or m.model ilike '%' || trim(p_model) || '%')
      and (p_year is null or m.year = p_year)
    order by m.updated_at desc limit least(greatest(p_limit, 1), 500)) x;
  if ids is null then return '[]'::jsonb; end if;
  perform app.after_lookup(actor, ids, 'web');
  perform app.log_event('authority.search', null, actor, actor, jsonb_build_object('query', left(coalesce(p_query, ''), 64), 'make', p_make,
    'model', p_model, 'year', p_year, 'hits', cardinality(ids)));
  return coalesce((select jsonb_agg(app.machine_list_item(m, actor) || jsonb_build_object('owner', (select name from public.organizations where id = m.owner_org_id),
      'serial_full', app.machine_primary_serial(m.id)) order by m.updated_at desc)
    from public.machines m where m.id = any (ids)), '[]'::jsonb);
end $$;

create or replace function public.list_flags(p_org_id uuid, p_status public.flag_status default 'active', p_type public.flag_type default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  perform app.require_authority(actor);
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'type', f.type, 'status', f.status, 'reference', f.reference,
      'raised_at', f.raised_at, 'cleared_at', f.cleared_at, 'occurred_at', f.occurred_at, 'location_text', f.location_text,
      'raised_by', (select name from public.organizations where id = f.raised_by_org_id), 'machine_id', m.id, 'reg_number', m.reg_number,
      'make', m.make, 'model', m.model, 'year', m.year, 'owner', (select name from public.organizations where id = m.owner_org_id),
      'serial', app.machine_primary_serial(m.id),
      'last_scan', (select jsonb_build_object('at', a.created_at, 'location', a.approx_location) from public.access_log a
                    where a.machine_id = m.id and a.via = 'scan' order by a.created_at desc limit 1)) order by f.raised_at desc)
    from public.flags f join public.machines m on m.id = f.machine_id
    where (p_status is null or f.status = p_status) and (p_type is null or f.type = p_type)), '[]'::jsonb);
end $$;

-- County (län) for the preparedness export; organisations only carry a city. Unknown cities are grouped as null.
create or replace function app.county_for_city(p_city text)
returns text language sql immutable set search_path = '' as $$
  select case lower(trim(coalesce(p_city, '')))
    when 'stockholm' then 'Stockholms län' when 'solna' then 'Stockholms län' when 'södertälje' then 'Stockholms län' when 'norrtälje' then 'Stockholms län'
    when 'uppsala' then 'Uppsala län' when 'enköping' then 'Uppsala län'
    when 'nyköping' then 'Södermanlands län' when 'eskilstuna' then 'Södermanlands län' when 'katrineholm' then 'Södermanlands län'
    when 'linköping' then 'Östergötlands län' when 'norrköping' then 'Östergötlands län'
    when 'jönköping' then 'Jönköpings län' when 'värnamo' then 'Jönköpings län'
    when 'växjö' then 'Kronobergs län' when 'kalmar' then 'Kalmar län' when 'visby' then 'Gotlands län'
    when 'karlskrona' then 'Blekinge län' when 'malmö' then 'Skåne län' when 'helsingborg' then 'Skåne län' when 'lund' then 'Skåne län'
    when 'kristianstad' then 'Skåne län' when 'halmstad' then 'Hallands län' when 'varberg' then 'Hallands län'
    when 'göteborg' then 'Västra Götalands län' when 'borås' then 'Västra Götalands län' when 'skövde' then 'Västra Götalands län'
    when 'trollhättan' then 'Västra Götalands län' when 'uddevalla' then 'Västra Götalands län'
    when 'karlstad' then 'Värmlands län' when 'örebro' then 'Örebro län' when 'västerås' then 'Västmanlands län' when 'sala' then 'Västmanlands län'
    when 'falun' then 'Dalarnas län' when 'borlänge' then 'Dalarnas län' when 'gävle' then 'Gävleborgs län' when 'sandviken' then 'Gävleborgs län'
    when 'härnösand' then 'Västernorrlands län' when 'sundsvall' then 'Västernorrlands län' when 'örnsköldsvik' then 'Västernorrlands län'
    when 'östersund' then 'Jämtlands län' when 'umeå' then 'Västerbottens län' when 'skellefteå' then 'Västerbottens län'
    when 'luleå' then 'Norrbottens län' when 'kiruna' then 'Norrbottens län' when 'piteå' then 'Norrbottens län'
    else null end
$$;

-- Preparedness export (beredskapsexport): aggregate only – no owner data (SPEC §7.5).
create or replace function public.authority_preparedness_export(p_org_id uuid, p_category public.machine_category default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); rows jsonb;
begin
  perform app.require_authority(actor);
  select coalesce(jsonb_agg(jsonb_build_object('county', county, 'category', category, 'weight_class', weight_class, 'count', n, 'electric', electric)
      order by county nulls last, category, weight_class), '[]'::jsonb) into rows
  from (
    select app.county_for_city(o.city) as county, m.category,
      case when m.service_weight_kg is null then 'unknown' when m.service_weight_kg < 1500 then 'lt_1_5t'
           when m.service_weight_kg < 10000 then '1_5_10t' when m.service_weight_kg < 30000 then '10_30t' else 'gt_30t' end as weight_class,
      count(*) as n, count(*) filter (where m.fuel_type in ('electric', 'hybrid', 'hydrogen')) as electric
    from public.machines m left join public.organizations o on o.id = m.owner_org_id
    where m.status in ('active', 'disputed') and (p_category is null or m.category = p_category)
    group by 1, 2, 3) x;
  perform app.log_event('authority.preparedness_export', null, actor, actor, jsonb_build_object('category', p_category));
  return jsonb_build_object('generated_at', app.iso_ts(now()), 'rows', rows,
    'total', (select count(*) from public.machines where status in ('active', 'disputed') and (p_category is null or category = p_category)));
end $$;

-- ---------- Register extract (registerutdrag) ----------
alter table public.report_snapshots drop constraint report_snapshots_kind_check;
alter table public.report_snapshots add constraint report_snapshots_kind_check check (kind in ('fleet_report', 'project_list', 'register_extract'));
create sequence public.register_extract_seq;
revoke all on sequence public.register_extract_seq from anon, authenticated;

-- Formal extract of one machine without personal identity numbers (sole traders' numbers are masked), with number and
-- hash. Owner, authority and operator may create it.
create or replace function public.create_register_extract(p_org_id uuid, p_machine_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); m public.machines; rel text[]; res jsonb; rn text; s public.report_snapshots;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  rel := app.machine_relations(m.id, array[actor]);
  if (rel && array['owner', 'authority', 'operator']) is not true then perform app.raise('FORBIDDEN'); end if;
  res := jsonb_build_object('org_name', (select name from public.organizations where id = actor), 'generated_at', app.iso_ts(now()),
    'machine', app.machine_base_json(m) - 'description' - 'primary_photo_path' - 'hour_meter_updated_at',
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('type', i.type, 'value', i.value, 'verified', i.verified) order by i.type)
      from public.machine_identifiers i where i.machine_id = m.id), '[]'::jsonb),
    'owner', (select jsonb_build_object('name', o.name, 'org_number', app.org_number_display(o.id), 'city', o.city) from public.organizations o where o.id = m.owner_org_id),
    'ownerships', coalesce((select jsonb_agg(jsonb_build_object('owner', (select name from public.organizations where id = w.owner_org_id),
        'org_number', app.org_number_display(w.owner_org_id), 'from', w.from_date, 'to', w.to_date, 'via', w.acquired_via) order by w.from_date)
      from public.ownerships w where w.machine_id = m.id), '[]'::jsonb),
    'encumbrances', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'status', e.status, 'holder', (select name from public.organizations where id = e.holder_org_id),
        'start_date', e.start_date, 'end_date', e.end_date, 'released_at', e.released_at) order by e.start_date)
      from public.encumbrances e where e.machine_id = m.id and e.status in ('active', 'released', 'transferred') and e.type in ('ownership_reservation', 'leasing')), '[]'::jsonb),
    'flags', coalesce((select jsonb_agg(jsonb_build_object('type', f.type, 'status', f.status, 'raised_at', f.raised_at, 'cleared_at', f.cleared_at) order by f.raised_at)
      from public.flags f where f.machine_id = m.id), '[]'::jsonb),
    'inspection_valid_until', app.inspection_valid_until(m.id),
    'events_through_seq', (select max(seq) from public.events));
  rn := 'U-' || to_char(now() at time zone 'Europe/Stockholm', 'YYYY') || '-' || lpad(nextval('public.register_extract_seq')::text, 6, '0');
  insert into public.report_snapshots (kind, report_number, org_id, params, result, result_hash, created_by_user_id)
  values ('register_extract', rn, actor, jsonb_build_object('machine_id', m.id), res, app.sha256_hex(rn || '|' || res::text), auth.uid()) returning * into s;
  perform app.log_event('register_extract.created', m.id, m.owner_org_id, actor, jsonb_build_object('extract_number', rn));
  return jsonb_build_object('report_number', s.report_number, 'created_at', s.created_at, 'result_hash', s.result_hash, 'result', s.result);
end $$;

-- verify_report also covers register extracts; machines count is 1 for them.
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
    'org_name', s.result ->> 'org_name', 'machines', case when s.kind = 'register_extract' then 1 else jsonb_array_length(s.result -> 'machines') end,
    'reg_number', s.result -> 'machine' ->> 'reg_number');
end $$;

-- ---------- Manufacturer (OEM) delivery data ----------
create or replace function public.submit_oem_records(p_org_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); r jsonb; n int := 0; errs jsonb := '[]'::jsonb; i int := 0; ns text; mid uuid;
begin
  perform app.require_scope('oem:write');
  if not app.has_org_type(actor, 'manufacturer') then perform app.raise('FORBIDDEN'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 10000 then
    perform app.raise('VALIDATION', '{"field":"rows","max":10000}');
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    ns := app.normalize_identifier(r ->> 'serial_number');
    if ns is null or length(ns) < 4 or nullif(trim(r ->> 'make'), '') is null or nullif(trim(r ->> 'model'), '') is null then
      errs := errs || jsonb_build_object('row', i, 'code', 'required');
      continue;
    end if;
    begin
      insert into public.oem_records (manufacturer_org_id, make, model, variant, year, category, serial_number, normalized_serial, engine_make, engine_model,
        engine_serial, emission_stage, engine_power_kw, service_weight_kg, fuel_type, electric_config, has_lifting_device, delivered_at, delivered_to_country, source)
      values (actor, trim(r ->> 'make'), trim(r ->> 'model'), nullif(trim(r ->> 'variant'), ''), nullif(r ->> 'year', '')::int,
        app.category_from_text(r ->> 'category'), trim(r ->> 'serial_number'), ns, nullif(trim(r ->> 'engine_make'), ''), nullif(trim(r ->> 'engine_model'), ''),
        nullif(trim(r ->> 'engine_serial'), ''), nullif(r ->> 'emission_stage', '')::public.emission_stage, nullif(r ->> 'engine_power_kw', '')::numeric,
        nullif(r ->> 'service_weight_kg', '')::int, nullif(r ->> 'fuel_type', '')::public.fuel_type, nullif(r ->> 'electric_config', '')::public.electric_config,
        (r ->> 'has_lifting_device')::boolean, nullif(r ->> 'delivered_at', '')::date, upper(nullif(r ->> 'delivered_to_country', '')),
        case when app.current_api_key_id() is null then 'import' else 'api' end::public.oem_source)
      on conflict (manufacturer_org_id, normalized_serial) do update set make = excluded.make, model = excluded.model, variant = excluded.variant,
        year = excluded.year, category = coalesce(excluded.category, public.oem_records.category), engine_make = excluded.engine_make,
        engine_model = excluded.engine_model, engine_serial = excluded.engine_serial, emission_stage = excluded.emission_stage,
        engine_power_kw = excluded.engine_power_kw, service_weight_kg = excluded.service_weight_kg, fuel_type = excluded.fuel_type,
        electric_config = excluded.electric_config, has_lifting_device = excluded.has_lifting_device, delivered_at = excluded.delivered_at,
        delivered_to_country = excluded.delivered_to_country;
      -- Match a machine that is already registered with this serial/PIN.
      select x.machine_id into mid from public.machine_identifiers x where x.unique_active and x.normalized_value = ns limit 1;
      if mid is not null then update public.oem_records set matched_machine_id = mid where manufacturer_org_id = actor and normalized_serial = ns; end if;
      n := n + 1;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'code', 'invalid', 'detail', left(sqlerrm, 120));
    end;
  end loop;
  perform app.log_event('oem.records_submitted', null, actor, actor, jsonb_build_object('rows', n, 'errors', jsonb_array_length(errs)));
  return jsonb_build_object('ok', true, 'saved', n, 'errors', errs);
end $$;

create or replace function public.list_oem_records(p_org_id uuid, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if not app.has_org_type(actor, 'manufacturer') then perform app.raise('FORBIDDEN'); end if;
  return jsonb_build_object(
    'total', (select count(*) from public.oem_records where manufacturer_org_id = actor),
    'matched', (select count(*) from public.oem_records where manufacturer_org_id = actor and matched_machine_id is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'make', o.make, 'model', o.model, 'year', o.year, 'serial_number', o.serial_number,
        'delivered_at', o.delivered_at, 'source', o.source, 'matched', o.matched_machine_id is not null,
        'reg_number', (select reg_number from public.machines where id = o.matched_machine_id), 'created_at', o.created_at) order by o.created_at desc)
      from (select * from public.oem_records where manufacturer_org_id = actor order by created_at desc limit least(greatest(p_limit, 1), 5000)) o), '[]'::jsonb));
end $$;

-- ---------- Machine view: insurer requirement + claim link for the owner ----------
create or replace function app.machine_view_insurance(m public.machines, p_rel text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_rel && array['owner', 'user'] then jsonb_strip_nulls(jsonb_build_object(
    'insurance_requirement', (select jsonb_build_object('insurer', ip.insurer_name, 'level', ip.requires_verification_level)
      from public.insurance_policies ip where ip.machine_id = m.id and ip.status = 'active' and ip.requires_verification_level > m.verification_level limit 1),
    'claim_url', (select o.settings ->> 'claim_url' from public.insurance_policies ip join public.organizations o on o.id = ip.insurer_org_id
      where ip.machine_id = m.id and ip.status = 'active' and current_date between ip.valid_from and ip.valid_to and o.settings ? 'claim_url' limit 1)))
  else '{}'::jsonb end
$$;

-- Re-declared from step 12 with the insurance extras appended.
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
  )) || app.machine_view_insurance(m, p_rel)
$$;

-- Insurers set a claim link (skadeanmälan) in their org settings.
create or replace function public.set_claim_url(p_org_id uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin');
begin
  if not app.has_org_type(actor, 'insurer') then perform app.raise('FORBIDDEN'); end if;
  if nullif(trim(p_url), '') is not null and (trim(p_url) !~ '^https://[^\s]+\.[^\s]+$' or length(trim(p_url)) > 300) then perform app.raise('VALIDATION', '{"field":"url"}'); end if;
  update public.organizations set settings = case when nullif(trim(p_url), '') is null then coalesce(settings, '{}'::jsonb) - 'claim_url'
    else coalesce(settings, '{}'::jsonb) || jsonb_build_object('claim_url', trim(p_url)) end where id = actor;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  public.add_watch(uuid, text, text, text), public.remove_watch(uuid, uuid), public.list_watch(uuid),
  public.list_portfolio(uuid), public.set_policy_requirement(uuid, uuid, smallint), public.list_alerts(uuid, int),
  public.authority_search(uuid, text, text, text, int, int), public.list_flags(uuid, public.flag_status, public.flag_type),
  public.authority_preparedness_export(uuid, public.machine_category), public.create_register_extract(uuid, uuid),
  public.submit_oem_records(uuid, jsonb), public.list_oem_records(uuid, int), public.set_claim_url(uuid, text)
  to authenticated;
