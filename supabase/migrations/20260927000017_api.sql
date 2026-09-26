-- Step 15: public API and webhooks (SPEC §12). Keys are shown once and stored as SHA-256; the api-v1 Edge Function
-- resolves a key (service role), then calls the same RPCs as the UI with header x-maskinid-api-key-id, so every
-- authorisation rule and event is shared with the web app.

create table public.api_idempotency (
  api_key_id  uuid not null references public.api_keys (id) on delete cascade,
  idem_key    text not null check (length(idem_key) between 1 and 200),
  request_hash text not null,
  status_code int not null,
  response    jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (api_key_id, idem_key)
);
alter table public.api_idempotency enable row level security;
revoke all on public.api_idempotency from anon, authenticated;
-- No policies: only the service role (Edge Function) touches it.

create or replace function app.api_scopes()
returns text[] language sql immutable set search_path = '' as $$
  select array['machines:read', 'machines:write', 'checks:write', 'encumbrances:write', 'transfers:write', 'flags:write',
               'webhooks:manage', 'inspections:write', 'oem:write']
$$;

-- Webhook URLs: https only, never local or private network addresses (SSRF).
create or replace function app.is_safe_webhook_url(p_url text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare host text;
begin
  if p_url is null or p_url !~ '^https://[^/\s?#]+' or length(p_url) > 500 then return false; end if;
  host := lower(substring(p_url from '^https://(?:[^@/]*@)?([^/:?#]+)'));
  if host is null or host = 'localhost' or host like '%.localhost' or host like '%.local' or host like '%.internal' then return false; end if;
  if host ~ '^\d+\.\d+\.\d+\.\d+$' then
    if host ~ '^(10|127|0)\.' or host ~ '^192\.168\.' or host ~ '^169\.254\.' or host ~ '^172\.(1[6-9]|2\d|3[01])\.' or host ~ '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' then
      return false;
    end if;
  end if;
  if host like '[%' or host ~ ':' then return false; end if; -- no IPv6 literals
  return true;
end $$;

-- ---------- API keys ----------
create or replace function public.create_api_key(p_org_id uuid, p_name text, p_scopes text[], p_sandbox boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); key text; k public.api_keys;
begin
  if app.current_api_key_id() is not null then perform app.raise('FORBIDDEN'); end if;
  if nullif(trim(p_name), '') is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  if p_scopes is null or cardinality(p_scopes) = 0 or not (p_scopes <@ app.api_scopes()) then perform app.raise('VALIDATION', '{"field":"scopes"}'); end if;
  if (select count(*) from public.api_keys where org_id = actor and revoked_at is null) >= 20 then perform app.raise('VALIDATION', '{"reason":"limit"}'); end if;
  key := case when coalesce(p_sandbox, false) then 'mk_test_' else 'mk_live_' end || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (org_id, name, key_prefix, key_hash, scopes, sandbox, created_by)
  values (actor, left(trim(p_name), 100), left(key, 16), app.sha256_hex(key), p_scopes, coalesce(p_sandbox, false), auth.uid()) returning * into k;
  perform app.log_event('api_key.created', null, actor, actor, jsonb_build_object('api_key_id', k.id, 'prefix', k.key_prefix, 'scopes', to_jsonb(p_scopes)));
  return jsonb_build_object('id', k.id, 'key', key, 'prefix', k.key_prefix, 'scopes', to_jsonb(k.scopes));
end $$;

create or replace function public.revoke_api_key(p_org_id uuid, p_api_key_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); k public.api_keys;
begin
  update public.api_keys set revoked_at = now() where id = p_api_key_id and org_id = actor and revoked_at is null returning * into k;
  if k.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('api_key.revoked', null, actor, actor, jsonb_build_object('api_key_id', k.id, 'prefix', k.key_prefix));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_api_keys(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'prefix', k.key_prefix, 'scopes', to_jsonb(k.scopes), 'sandbox', k.sandbox,
      'rate_limit_per_min', k.rate_limit_per_min, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at, 'created_at', k.created_at,
      'requests_30d', (select count(*) from public.api_requests r where r.api_key_id = k.id and r.created_at > now() - interval '30 days'),
      'errors_30d', (select count(*) from public.api_requests r where r.api_key_id = k.id and r.status_code >= 400 and r.created_at > now() - interval '30 days'))
      order by k.revoked_at nulls first, k.created_at desc)
    from public.api_keys k where k.org_id = actor), '[]'::jsonb);
end $$;

-- Called by api-v1 (service role) with the SHA-256 of the presented key. Rate limit per key and minute.
create or replace function public.resolve_api_key(p_key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; o public.organizations;
begin
  select * into k from public.api_keys where key_hash = lower(p_key_hash);
  if k.id is null or k.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); end if;
  select * into o from public.organizations where id = k.org_id;
  if o.status = 'suspended' then return jsonb_build_object('ok', false, 'error', 'ORG_NOT_APPROVED'); end if;
  if not app.rate_limit_hit('api:' || k.id, k.rate_limit_per_min, interval '1 minute') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED', 'limit', k.rate_limit_per_min);
  end if;
  update public.api_keys set last_used_at = now() where id = k.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return jsonb_build_object('ok', true, 'id', k.id, 'org_id', k.org_id, 'org_slug', o.slug, 'scopes', to_jsonb(k.scopes), 'sandbox', k.sandbox);
end $$;

create or replace function public.log_api_request(p_api_key_id uuid, p_endpoint text, p_method text, p_status int, p_latency_ms int,
  p_ip_hash text, p_error_code text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.api_requests (api_key_id, org_id, endpoint, method, status_code, latency_ms, ip_hash, error_code)
  values (p_api_key_id, (select org_id from public.api_keys where id = p_api_key_id), left(p_endpoint, 200), left(p_method, 10), p_status,
          p_latency_ms, p_ip_hash, left(p_error_code, 64))
$$;

create or replace function public.api_idempotency_get(p_api_key_id uuid, p_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.api_idempotency;
begin
  delete from public.api_idempotency where created_at < now() - interval '24 hours';
  select * into r from public.api_idempotency where api_key_id = p_api_key_id and idem_key = p_key;
  if r.api_key_id is null then return null; end if;
  if r.request_hash <> p_request_hash then return jsonb_build_object('conflict', true); end if;
  return jsonb_build_object('status', r.status_code, 'body', r.response);
end $$;

create or replace function public.api_idempotency_put(p_api_key_id uuid, p_key text, p_request_hash text, p_status int, p_response jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.api_idempotency (api_key_id, idem_key, request_hash, status_code, response)
  values (p_api_key_id, p_key, p_request_hash, p_status, p_response) on conflict do nothing
$$;

create or replace function public.api_usage(p_org_id uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin', false);
begin
  return jsonb_build_object(
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'requests', n, 'errors', e) order by d) from (
      select (created_at at time zone 'Europe/Stockholm')::date d, count(*) n, count(*) filter (where status_code >= 400) e
      from public.api_requests where org_id = actor and created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) group by 1) x), '[]'::jsonb),
    'per_endpoint', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'method', method, 'requests', n, 'avg_ms', avg_ms) order by n desc) from (
      select endpoint, method, count(*) n, round(avg(latency_ms)) avg_ms from public.api_requests
      where org_id = actor and created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) group by 1, 2 limit 50) x), '[]'::jsonb));
end $$;

-- ---------- Webhooks ----------
create or replace function app.webhook_event_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['machine.registered', 'machine.verified', 'encumbrance.pending', 'encumbrance.confirmed', 'encumbrance.conflict',
    'encumbrance.released', 'transfer.initiated', 'transfer.awaiting_you', 'transfer.completed', 'flag.raised', 'flag.cleared',
    'machine.scanned', 'market.alert', 'label.bound', 'lead.created', 'ping']
$$;

create or replace function app.require_webhook_manager(p_org_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if app.current_api_key_id() is not null then
    perform app.require_scope('webhooks:manage');
    return app.require_actor(p_org_id);
  end if;
  return app.require_actor(p_org_id, 'admin');
end $$;

create or replace function public.create_webhook(p_org_id uuid, p_url text, p_event_types text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_webhook_manager(p_org_id); w public.webhooks; secret text := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.is_safe_webhook_url(p_url) then perform app.raise('VALIDATION', '{"field":"url"}'); end if;
  if not (coalesce(p_event_types, '{}') <@ app.webhook_event_types()) then perform app.raise('VALIDATION', '{"field":"event_types"}'); end if;
  if (select count(*) from public.webhooks where org_id = actor and active) >= 10 then perform app.raise('VALIDATION', '{"reason":"limit"}'); end if;
  insert into public.webhooks (org_id, url, secret, event_types, created_by) values (actor, p_url, secret, coalesce(p_event_types, '{}'), auth.uid()) returning * into w;
  perform app.log_event('webhook.created', null, actor, actor, jsonb_build_object('webhook_id', w.id, 'url', w.url, 'event_types', to_jsonb(w.event_types)));
  -- The secret is returned once; it is kept to sign deliveries but never shown again.
  return jsonb_build_object('id', w.id, 'url', w.url, 'event_types', to_jsonb(w.event_types), 'secret', secret);
end $$;

create or replace function public.delete_webhook(p_org_id uuid, p_webhook_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_webhook_manager(p_org_id);
begin
  update public.webhooks set active = false where id = p_webhook_id and org_id = actor and active;
  if not found then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('webhook.deleted', null, actor, actor, jsonb_build_object('webhook_id', p_webhook_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_webhooks(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_webhook_manager(p_org_id);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'url', w.url, 'event_types', to_jsonb(w.event_types), 'active', w.active, 'created_at', w.created_at,
      'delivered_24h', (select count(*) from public.webhook_deliveries d where d.webhook_id = w.id and d.status = 'delivered' and d.created_at > now() - interval '24 hours'),
      'failed_24h', (select count(*) from public.webhook_deliveries d where d.webhook_id = w.id and d.status = 'failed' and d.created_at > now() - interval '24 hours'))
      order by w.created_at desc)
    from public.webhooks w where w.org_id = actor and w.active), '[]'::jsonb);
end $$;

create or replace function public.list_webhook_deliveries(p_org_id uuid, p_webhook_id uuid default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_webhook_manager(p_org_id);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'webhook_id', d.webhook_id, 'event_type', d.event_type, 'status', d.status,
      'attempt', d.attempt, 'response_code', d.response_code, 'last_error', d.last_error, 'next_retry_at', d.next_retry_at,
      'delivered_at', d.delivered_at, 'created_at', d.created_at, 'payload', d.payload) order by d.created_at desc)
    from (select d.* from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
          where w.org_id = actor and (p_webhook_id is null or d.webhook_id = p_webhook_id)
          order by d.created_at desc limit least(greatest(p_limit, 1), 500)) d), '[]'::jsonb);
end $$;

-- "Skicka igen" (SPEC §12).
create or replace function public.redeliver_webhook(p_org_id uuid, p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_webhook_manager(p_org_id);
begin
  update public.webhook_deliveries d set status = 'pending', attempt = 0, next_retry_at = now(), last_error = null
  from public.webhooks w where w.id = d.webhook_id and w.org_id = actor and d.id = p_delivery_id;
  if not found then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.test_webhook(p_org_id uuid, p_webhook_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_webhook_manager(p_org_id); w public.webhooks; did uuid;
begin
  select * into w from public.webhooks where id = p_webhook_id and org_id = actor and active;
  if w.id is null then perform app.raise('NOT_FOUND'); end if;
  insert into public.webhook_deliveries (webhook_id, event_type, payload)
  values (w.id, 'ping', jsonb_build_object('id', gen_random_uuid(), 'type', 'ping', 'created_at', app.iso_ts(now()), 'machine', null, 'data', '{}'::jsonb))
  returning webhook_deliveries.id into did;
  return jsonb_build_object('ok', true, 'delivery_id', did);
end $$;

-- Dispatcher (webhook-dispatch Edge Function, service role): claim due deliveries, then report each result.
create or replace function public.claim_webhook_deliveries(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with due as (
    select d.id from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
    where d.status = 'pending' and d.next_retry_at <= now() and w.active
    order by d.next_retry_at limit least(greatest(p_limit, 1), 200) for update of d skip locked),
  upd as (
    update public.webhook_deliveries d set attempt = d.attempt + 1, next_retry_at = now() + interval '10 minutes'
    from due where d.id = due.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'url', w.url, 'secret', w.secret, 'event_type', upd.event_type,
      'attempt', upd.attempt, 'payload', upd.payload)), '[]'::jsonb) into out
  from upd join public.webhooks w on w.id = upd.webhook_id;
  return out;
end $$;

-- Retry 5 times with backoff (1 min, 5 min, 30 min, 2 h, 12 h), then failed.
create or replace function public.record_webhook_result(p_delivery_id uuid, p_ok boolean, p_status int default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.webhook_deliveries;
begin
  select * into d from public.webhook_deliveries where id = p_delivery_id for update;
  if d.id is null then return; end if;
  if p_ok then
    update public.webhook_deliveries set status = 'delivered', delivered_at = now(), response_code = p_status, last_error = null where id = d.id;
  elsif d.attempt >= 5 then
    update public.webhook_deliveries set status = 'failed', response_code = p_status, last_error = left(p_error, 500) where id = d.id;
  else
    update public.webhook_deliveries set response_code = p_status, last_error = left(p_error, 500),
      next_retry_at = now() + (array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours', interval '12 hours'])[greatest(d.attempt, 1)]
    where id = d.id;
  end if;
end $$;

-- Public badge data (GET /embed/badge/:reg.svg): only what the public card shows.
create or replace function public.badge_data(p_reg text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when m.id is null then jsonb_build_object('found', false)
    else jsonb_build_object('found', true, 'reg_number', m.reg_number, 'status', m.status, 'verification_level', m.verification_level,
      'stolen', exists (select 1 from public.flags f where f.machine_id = m.id and f.status = 'active' and f.type = 'stolen')) end
  from (select 1) x left join public.machines m on m.reg_number = app.normalize_reg_number(p_reg) and m.status <> 'draft'
$$;

revoke execute on function public.resolve_api_key(text), public.log_api_request(uuid, text, text, int, int, text, text),
  public.api_idempotency_get(uuid, text, text), public.api_idempotency_put(uuid, text, text, int, jsonb),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.resolve_api_key(text), public.log_api_request(uuid, text, text, int, int, text, text),
  public.api_idempotency_get(uuid, text, text), public.api_idempotency_put(uuid, text, text, int, jsonb),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid, boolean, int, text) to service_role;
grant execute on function
  public.create_api_key(uuid, text, text[], boolean), public.revoke_api_key(uuid, uuid), public.list_api_keys(uuid), public.api_usage(uuid, int),
  public.create_webhook(uuid, text, text[]), public.delete_webhook(uuid, uuid), public.list_webhooks(uuid),
  public.list_webhook_deliveries(uuid, uuid, int), public.redeliver_webhook(uuid, uuid), public.test_webhook(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.badge_data(text) to anon, authenticated;

-- API parity: api-v1 calls the same RPCs as the web app, as service_role with the API key header. Every function a
-- signed-in user may execute is therefore also executable by service_role (authorisation still happens inside,
-- via app.require_actor and the key's scopes). Later migrations call app.grant_api_access() at the end.
create or replace function app.grant_api_access()
returns void language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute') loop
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke execute on function app.grant_api_access() from public;
select app.grant_api_access();
