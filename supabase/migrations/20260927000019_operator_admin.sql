-- Step 17: operator admin (SPEC §9 "/admin", §2.4). Queues and tools for the register keeper: overview, organisations,
-- label batches, API usage, support search, feature flags, system health and the market dashboard. Existing RPCs
-- (approve_org, suspend_org, list_verification_queue, list_conflicts, resolve_conflict, owner corrections,
-- admin_list_events, admin_verify_chain, list_event_anchors, verify_anchor, market alerts) are reused by the UI.
--
-- Every operator lookup of personal or organisation data is written to operator_audit (append-only), so support
-- access can itself be reviewed (SPEC §11: "allt loggas").

create table public.operator_audit (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  action      text not null check (action ~ '^[a-z_.]{3,60}$'),
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index operator_audit_created_idx on public.operator_audit (created_at desc);
alter table public.operator_audit enable row level security;
revoke all on public.operator_audit from public, anon, authenticated;
-- No policies: read through admin_list_audit only.

create or replace function app.operator_audit_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'AUDIT_APPEND_ONLY' using errcode = 'PT403';
end $$;
create trigger operator_audit_no_update before update or delete on public.operator_audit
  for each row execute function app.operator_audit_immutable();
create trigger operator_audit_no_truncate before truncate on public.operator_audit
  for each statement execute function app.operator_audit_immutable();

create or replace function app.audit(p_action text, p_target_type text default null, p_target_id text default null, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.operator_audit (user_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------- Overview ----------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return jsonb_build_object(
    -- The operator org this user belongs to (queues shared with partners take an org id; the UI links to /o/<slug>/…).
    'operator_org', (select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name) from public.memberships m
      join public.organizations o on o.id = m.org_id where m.user_id = auth.uid() and m.status = 'active' and 'operator' = any (o.types)
      order by o.created_at limit 1),
    'operator_role', (select role from public.operator_roles where user_id = auth.uid()),
    'orgs_pending', (select count(*) from public.organizations where status = 'pending'),
    'verifications_open', (select count(*) from public.verification_requests where status in ('open', 'in_review', 'needs_info')),
    'conflicts_open', (select count(*) from public.conflicts where status = 'open'),
    'corrections_pending', (select count(*) from public.owner_corrections where status in ('proposed', 'objection_period')),
    'label_batches_ordered', (select count(*) from public.label_batches where status = 'ordered'),
    'market_alerts_open', (select count(*) from public.market_alerts where status = 'open'),
    'webhooks_failed_24h', (select count(*) from public.webhook_deliveries where status = 'failed' and created_at > now() - interval '24 hours'),
    'api_requests_24h', (select count(*) from public.api_requests where created_at > now() - interval '24 hours'),
    'machines', (select count(*) from public.machines where status <> 'draft'),
    'orgs', (select count(*) from public.organizations where status = 'approved'),
    'last_anchor', (select jsonb_build_object('day', day, 'published_at', published_at) from public.event_anchors order by day desc limit 1));
end $$;

-- ---------- Organisations ----------
create or replace function public.admin_list_orgs(p_status public.org_status default null, p_query text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); q text := nullif(trim(p_query), ''); nr text := app.normalize_org_number(p_query);
begin
  if q is not null then perform app.audit('org.search', null, null, jsonb_build_object('query', left(q, 60))); end if;
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
    select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'org_number', app.org_number_display(o.id), 'is_sole_trader', o.is_sole_trader,
      'types', o.types, 'status', o.status, 'city', o.city, 'created_at', o.created_at,
      'approved_at', o.approved_at, 'suspended_reason', o.suspended_reason, 'lookup_source', o.lookup_source,
      'members', (select count(*) from public.memberships m where m.org_id = o.id and m.status = 'active'),
      'machines', (select count(*) from public.machines ma where ma.owner_org_id = o.id and ma.status <> 'draft')) x
    from public.organizations o
    where (p_status is null or o.status = p_status)
      and (q is null or o.name ilike '%' || q || '%' or o.slug ilike '%' || q || '%'
           or (nr is not null and o.org_number_hash = app.org_number_hash(nr)))
    order by o.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) s), '[]'::jsonb);
end $$;

create or replace function public.admin_get_org(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); o public.organizations;
begin
  select * into o from public.organizations where id = p_org_id;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.audit('org.view', 'organization', o.id::text);
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'org_number', app.org_number_display(o.id), 'is_sole_trader', o.is_sole_trader,
      'types', o.types, 'status', o.status, 'city', o.city, 'created_at', o.created_at, 'approved_at', o.approved_at,
      'suspended_reason', o.suspended_reason, 'lookup_source', o.lookup_source, 'dpa_accepted_at', o.dpa_accepted_at),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.full_name, 'email', coalesce(p.email, m.invite_email),
        'role', m.role, 'status', m.status, 'identity_verified', p.identity_verified_at is not null, 'accepted_at', m.accepted_at) order by m.created_at)
      from public.memberships m left join public.profiles p on p.user_id = m.user_id where m.org_id = o.id), '[]'::jsonb),
    'machines', (select count(*) from public.machines where owner_org_id = o.id and status <> 'draft'),
    'api_keys', (select count(*) from public.api_keys where org_id = o.id and revoked_at is null),
    'events', coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'type', e.type, 'created_at', e.created_at, 'machine_id', e.machine_id) order by e.seq desc)
      from (select * from public.events where org_id = o.id or actor_org_id = o.id order by seq desc limit 30) e), '[]'::jsonb));
end $$;

-- Approve with a narrower set of types than requested (e.g. dealer approved, financier not yet).
create or replace function public.admin_set_org_types(p_org_id uuid, p_types public.org_type[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); o public.organizations;
begin
  if p_types is null or cardinality(p_types) = 0 or 'operator' = any (p_types) then perform app.raise('VALIDATION', '{"field":"types"}'); end if;
  update public.organizations set types = (select array_agg(distinct t order by t) from unnest(p_types) t)
  where id = p_org_id and 'operator' <> all (types) returning * into o;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('org.types_changed', null, o.id, op, jsonb_build_object('types', o.types, 'note', p_note));
  perform app.audit('org.types_changed', 'organization', o.id::text, jsonb_build_object('types', o.types));
  return app.org_brief(o.id);
end $$;

-- ---------- Label batches ----------
create or replace function public.admin_list_label_batches(p_status public.label_batch_status default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'quantity', b.quantity, 'status', b.status, 'medium', b.medium,
      'created_at', b.created_at, 'printed_at', b.printed_at, 'printer_ref', b.printer_ref, 'shipping_address', b.shipping_address,
      'assigned_org', app.org_brief(b.assigned_org_id), 'ordered_by', app.org_brief(b.ordered_by_org_id),
      'bound', (select count(*) from public.labels l where l.batch_id = b.id and l.status = 'bound')) order by b.created_at desc)
    from public.label_batches b where p_status is null or b.status = p_status), '[]'::jsonb);
end $$;

-- Codes of a printed batch, for the print file (superadmin only; logged).
create or replace function public.admin_label_batch_codes(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin');
begin
  if not exists (select 1 from public.label_batches where id = p_batch_id and status in ('printed', 'shipped')) then perform app.raise('NOT_FOUND'); end if;
  perform app.audit('labels.codes_exported', 'label_batch', p_batch_id::text);
  return coalesce((select jsonb_agg(l.code order by l.code) from public.labels l where l.batch_id = p_batch_id), '[]'::jsonb);
end $$;

create or replace function public.admin_set_label_batch_status(p_batch_id uuid, p_status public.label_batch_status)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin'); b public.label_batches;
begin
  -- ordered → cancelled, printed → shipped. Printing itself is print_label_batch (creates the codes).
  update public.label_batches set status = p_status
  where id = p_batch_id and ((status = 'ordered' and p_status = 'cancelled') or (status = 'printed' and p_status = 'shipped'))
  returning * into b;
  if b.id is null then perform app.raise('INVALID_STATE'); end if;
  perform app.log_event('labels.' || p_status::text, null, coalesce(b.assigned_org_id, b.ordered_by_org_id), op, jsonb_build_object('batch_id', b.id, 'quantity', b.quantity));
  if coalesce(b.assigned_org_id, b.ordered_by_org_id) is not null then
    perform app.notify_org(coalesce(b.assigned_org_id, b.ordered_by_org_id), 'labels.' || p_status::text, jsonb_build_object('quantity', b.quantity), '/labels', 'info');
  end if;
  return to_jsonb(b);
end $$;

-- ---------- API usage ----------
create or replace function public.admin_api_usage(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
begin
  return jsonb_build_object(
    'per_org', coalesce((select jsonb_agg(x order by (x ->> 'requests')::int desc) from (
      select jsonb_build_object('org', app.org_brief(r.org_id), 'requests', count(*), 'errors', count(*) filter (where r.status_code >= 400),
        'rate_limited', count(*) filter (where r.status_code = 429),
        'p95_ms', percentile_disc(0.95) within group (order by r.latency_ms), 'last_at', max(r.created_at)) x
      from public.api_requests r where r.created_at >= since group by r.org_id) s), '[]'::jsonb),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'requests', n, 'errors', e) order by d)
      from (select date_trunc('day', created_at)::date d, count(*) n, count(*) filter (where status_code >= 400) e
            from public.api_requests where created_at >= since group by 1) s), '[]'::jsonb),
    'top_endpoints', coalesce((select jsonb_agg(jsonb_build_object('endpoint', method || ' ' || endpoint, 'requests', n) order by n desc)
      from (select method, endpoint, count(*) n from public.api_requests where created_at >= since group by 1, 2 order by 3 desc limit 10) s), '[]'::jsonb),
    'webhooks', jsonb_build_object(
      'delivered', (select count(*) from public.webhook_deliveries where status = 'delivered' and created_at >= since),
      'pending', (select count(*) from public.webhook_deliveries where status = 'pending'),
      'failed', (select count(*) from public.webhook_deliveries where status = 'failed' and created_at >= since)));
end $$;

-- ---------- Support search ----------
-- One box for support: organisation (name, orgnr), user (e-mail, name), machine (reg number, serial). Every search is
-- audited. Results show what support needs to route a case – not documents, not history.
create or replace function public.admin_support_search(p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); q text := nullif(trim(p_query), ''); nr text; reg text; ident text;
begin
  if q is null or length(q) < 3 then perform app.raise('VALIDATION', '{"field":"query","min":3}'); end if;
  perform app.audit('support.search', null, null, jsonb_build_object('query', left(q, 60)));
  nr := app.normalize_org_number(q);
  reg := app.normalize_reg_number(q);
  ident := app.normalize_identifier(q);
  return jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'org_number', app.org_number_display(o.id), 'status', o.status,
        'types', o.types, 'city', o.city)) from (select * from public.organizations o
        where o.name ilike '%' || q || '%' or (nr is not null and o.org_number_hash = app.org_number_hash(nr)) order by o.name limit 20) o), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.full_name, 'email', p.email,
        'identity_verified', p.identity_verified_at is not null, 'deleted', p.deleted_at is not null,
        'orgs', (select coalesce(jsonb_agg(jsonb_build_object('id', m.org_id, 'name', og.name, 'role', m.role, 'status', m.status)), '[]'::jsonb)
                 from public.memberships m join public.organizations og on og.id = m.org_id where m.user_id = p.user_id)))
      from (select * from public.profiles p where p.email ilike '%' || q || '%' or p.full_name ilike '%' || q || '%' order by p.full_name limit 20) p), '[]'::jsonb),
    'machines', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year,
        'status', m.status, 'owner', app.org_brief(m.owner_org_id))) from (select distinct m.* from public.machines m
        left join public.machine_identifiers i on i.machine_id = m.id
        where m.status <> 'draft' and ((reg is not null and m.reg_number = reg) or (length(ident) >= 5 and i.normalized_value = ident)) limit 20) m), '[]'::jsonb));
end $$;

-- ---------- Feature flags (app_config) ----------
create or replace function public.admin_list_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'value', c.value, 'is_public', c.is_public, 'description', c.description,
      'updated_at', c.updated_at, 'updated_by', (select full_name from public.profiles where user_id = c.updated_by)) order by c.key)
    from public.app_config c), '[]'::jsonb);
end $$;

create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin'); c public.app_config; old jsonb;
begin
  select value into old from public.app_config where key = p_key;
  -- Only existing keys; flags stay booleans. New keys arrive through migrations.
  if old is null then perform app.raise('NOT_FOUND'); end if;
  if jsonb_typeof(old) = 'boolean' and jsonb_typeof(p_value) <> 'boolean' then perform app.raise('VALIDATION', '{"field":"value"}'); end if;
  update public.app_config set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key returning * into c;
  perform app.log_event('config.changed', null, op, op, jsonb_build_object('key', p_key, 'from', old, 'to', p_value));
  perform app.audit('config.changed', 'app_config', p_key, jsonb_build_object('from', old, 'to', p_value));
  return to_jsonb(c);
end $$;

create or replace function public.admin_list_audit(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
      'details', a.details, 'created_at', a.created_at, 'user', (select full_name from public.profiles where user_id = a.user_id)) order by a.id desc)
    from (select * from public.operator_audit order by id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) a), '[]'::jsonb);
end $$;

-- ---------- System health ----------
create or replace function public.admin_system_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); last_seq bigint; chain jsonb;
begin
  select max(seq) into last_seq from public.events;
  -- The last 2 000 events are verified on every load; the full chain is verified by the daily anchor job.
  chain := public.admin_verify_chain(greatest(coalesce(last_seq, 0) - 2000, 0), last_seq);
  return jsonb_build_object(
    'checked_at', now(),
    'chain', chain,
    'events', jsonb_build_object('total', coalesce(last_seq, 0), 'last_24h', (select count(*) from public.events where created_at > now() - interval '24 hours')),
    'anchors', jsonb_build_object('last_day', (select max(day) from public.event_anchors),
      'unpublished', (select count(*) from public.event_anchors where published_at is null),
      'missing_days', (select count(*) from generate_series(current_date - 7, current_date - 1, interval '1 day') d
        where not exists (select 1 from public.event_anchors a where a.day = d::date))),
    'webhooks', jsonb_build_object('pending', (select count(*) from public.webhook_deliveries where status = 'pending'),
      'overdue', (select count(*) from public.webhook_deliveries where status = 'pending' and next_retry_at < now() - interval '15 minutes'),
      'failed_24h', (select count(*) from public.webhook_deliveries where status = 'failed' and created_at > now() - interval '24 hours')),
    'market', jsonb_build_object('errors_24h', (select count(*) from public.market_runs where status = 'error' and started_at > now() - interval '24 hours'),
      'stuck_runs', (select count(*) from public.market_runs where status = 'running' and started_at < now() - interval '2 hours')),
    'email_outbox', jsonb_build_object('pending', (select count(*) from public.email_outbox where status = 'pending'),
      'overdue', (select count(*) from public.email_outbox where status = 'pending' and send_after < now() - interval '1 hour')),
    'flags', (select jsonb_object_agg(key, value) from public.app_config where jsonb_typeof(value) = 'boolean'));
end $$;

-- ---------- Market dashboard (SPEC §8.5) ----------
create or replace function public.admin_market_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return jsonb_build_object(
    'sources', public.list_market_sources(),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'source', s.name, 'started_at', r.started_at, 'finished_at', r.finished_at,
        'status', r.status, 'fetched', r.fetched, 'new', r.new_count, 'matched', r.matched, 'alerts', r.alerts, 'error', r.error) order by r.started_at desc)
      from (select * from public.market_runs order by started_at desc limit 50) r join public.market_sources s on s.id = r.source_id), '[]'::jsonb),
    'volume', coalesce((select jsonb_agg(jsonb_build_object('source', s.name, 'active', n_active, 'matched', n_matched, 'with_serial', n_serial, 'private', n_private))
      from (select source_id, count(*) filter (where active) n_active, count(*) filter (where active and matched_machine_id is not null) n_matched,
                   count(*) filter (where active and normalized_serial is not null) n_serial, count(*) filter (where active and seller_type = 'private') n_private
            from public.market_observations group by source_id) v join public.market_sources s on s.id = v.source_id), '[]'::jsonb),
    'alerts_open', coalesce((select jsonb_object_agg(type, n) from (select type, count(*) n from public.market_alerts where status = 'open' group by type) a), '{}'::jsonb));
end $$;

revoke execute on function
  public.admin_overview(), public.admin_list_orgs(public.org_status, text, int), public.admin_get_org(uuid),
  public.admin_set_org_types(uuid, public.org_type[], text), public.admin_list_label_batches(public.label_batch_status),
  public.admin_label_batch_codes(uuid), public.admin_set_label_batch_status(uuid, public.label_batch_status), public.admin_api_usage(int),
  public.admin_support_search(text), public.admin_list_config(), public.admin_set_config(text, jsonb), public.admin_list_audit(int),
  public.admin_system_health(), public.admin_market_overview()
from public, anon;
grant execute on function
  public.admin_overview(), public.admin_list_orgs(public.org_status, text, int), public.admin_get_org(uuid),
  public.admin_set_org_types(uuid, public.org_type[], text), public.admin_list_label_batches(public.label_batch_status),
  public.admin_label_batch_codes(uuid), public.admin_set_label_batch_status(uuid, public.label_batch_status), public.admin_api_usage(int),
  public.admin_support_search(text), public.admin_list_config(), public.admin_set_config(text, jsonb), public.admin_list_audit(int),
  public.admin_system_health(), public.admin_market_overview()
to authenticated;
select app.grant_api_access();
