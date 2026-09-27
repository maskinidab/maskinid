-- Step 26 (interpreted, SPEC §21 missing – ADR 0023): operations. A job table drives pg_cron: SQL jobs run in the
-- database, HTTP jobs call Edge Functions through pg_net with the CRON_SECRET header. Every run is recorded; three
-- failures in a row notify the superadmins. Also adds the time-based rules that had no job yet.

-- ============================================================ Jobs
create table public.jobs (
  name                 text primary key check (name ~ '^[a-z0-9_-]{3,40}$'),
  description          text not null,
  schedule             text not null,                 -- cron, Europe/Stockholm is not used: pg_cron runs in UTC
  kind                 text not null check (kind in ('sql', 'http')),
  target               text not null,                 -- sql: function in schema app (no args); http: Edge Function name
  enabled              boolean not null default true,
  last_run_at          timestamptz,
  last_status          text check (last_status in ('ok', 'error', 'dispatched')),
  last_duration_ms     int,
  last_result          jsonb,
  last_error           text,
  consecutive_failures int not null default 0
);
create table public.job_runs (
  id          bigint generated always as identity primary key,
  job_name    text not null references public.jobs (name) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null check (status in ('running', 'ok', 'error', 'dispatched')),
  result      jsonb,
  error       text,
  request_id  bigint
);
create index job_runs_job_idx on public.job_runs (job_name, started_at desc);
alter table public.jobs enable row level security;
alter table public.job_runs enable row level security;

insert into public.app_config (key, value, description) values
  ('FUNCTIONS_BASE_URL', '""', 'Edge Functions base URL for scheduled HTTP jobs, e.g. https://<ref>.supabase.co/functions/v1')
on conflict (key) do nothing;

-- Runs one SQL job (target = a no-argument function in schema app) and records the result.
create or replace function app.run_job(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.jobs; t0 timestamptz := clock_timestamp(); res jsonb; rid bigint; err text; ms int;
begin
  select * into j from public.jobs where name = p_name;
  if j.name is null or j.kind <> 'sql' then perform app.raise('NOT_FOUND'); end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = j.target and p.pronargs = 0) then
    perform app.raise('NOT_FOUND');
  end if;
  insert into public.job_runs (job_name, status) values (j.name, 'running') returning id into rid;
  begin
    execute format('select to_jsonb(app.%I())', j.target) into res;
  exception when others then
    err := left(sqlerrm, 500);
  end;
  ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  update public.job_runs set finished_at = clock_timestamp(), status = case when err is null then 'ok' else 'error' end, result = res, error = err where id = rid;
  update public.jobs set last_run_at = t0, last_status = case when err is null then 'ok' else 'error' end, last_duration_ms = ms, last_result = res,
    last_error = err, consecutive_failures = case when err is null then 0 else consecutive_failures + 1 end
  where name = j.name returning * into j;
  if j.consecutive_failures = 3 then
    perform app.notify_operators('job.failing', jsonb_build_object('job', j.name, 'error', left(err, 200)), '/admin/jobs', 'critical', 'superadmin');
  end if;
  return jsonb_build_object('job', j.name, 'status', j.last_status, 'duration_ms', ms, 'result', res, 'error', err);
end $$;

-- Dispatches an HTTP job (Edge Function) through pg_net; the response is collected by app.collect_http_job_results.
create or replace function app.dispatch_http_job(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.jobs; base text := trim(both '"' from app.config_text('FUNCTIONS_BASE_URL', '')); secret text := app.secret('cron_secret'); rid bigint; req bigint;
begin
  select * into j from public.jobs where name = p_name and kind = 'http';
  if j.name is null then perform app.raise('NOT_FOUND'); end if;
  if to_regnamespace('net') is null or coalesce(base, '') = '' or secret is null then perform app.raise('FEATURE_DISABLED'); end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)' into req
    using base || '/' || j.target, jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret), '{}'::jsonb;
  insert into public.job_runs (job_name, status, request_id) values (j.name, 'dispatched', req) returning id into rid;
  update public.jobs set last_run_at = now(), last_status = 'dispatched' where name = j.name;
  return jsonb_build_object('job', j.name, 'status', 'dispatched', 'request_id', req);
end $$;

-- Reads pg_net responses for dispatched HTTP jobs (every 5 minutes).
create or replace function app.collect_http_job_results()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; j public.jobs;
begin
  if to_regclass('net._http_response') is null then return 0; end if;
  for r in execute 'select jr.id, jr.job_name, h.status_code, h.error_msg, left(h.content, 500) content from public.job_runs jr
      join net._http_response h on h.id = jr.request_id where jr.status = ''dispatched''' loop
    update public.job_runs set finished_at = now(), status = case when r.status_code between 200 and 299 then 'ok' else 'error' end,
      error = case when r.status_code between 200 and 299 then null else coalesce(r.error_msg, 'HTTP ' || r.status_code) end,
      result = case when r.status_code between 200 and 299 then to_jsonb(r.content) end
    where id = r.id;
    update public.jobs set last_status = case when r.status_code between 200 and 299 then 'ok' else 'error' end,
      last_error = case when r.status_code between 200 and 299 then null else coalesce(r.error_msg, 'HTTP ' || r.status_code) end,
      consecutive_failures = case when r.status_code between 200 and 299 then 0 else consecutive_failures + 1 end
    where name = r.job_name returning * into j;
    if j.consecutive_failures = 3 then
      perform app.notify_operators('job.failing', jsonb_build_object('job', j.name, 'error', j.last_error), '/admin/jobs', 'critical', 'superadmin');
    end if;
    n := n + 1;
  end loop;
  -- A dispatched run without a response after an hour counts as failed.
  update public.job_runs set status = 'error', finished_at = now(), error = 'no response' where status = 'dispatched' and started_at < now() - interval '1 hour';
  return n;
end $$;

-- (Re)creates the pg_cron schedule from the job table. No-op where pg_cron is not installed (local tests).
create or replace function app.schedule_jobs()
returns int language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n int := 0;
begin
  if to_regnamespace('cron') is null then return 0; end if;
  execute 'select cron.unschedule(jobname) from cron.job where jobname like ''maskinid:%''';
  for j in select * from public.jobs where enabled loop
    execute 'select cron.schedule($1, $2, $3)' using 'maskinid:' || j.name, j.schedule,
      case when j.kind = 'sql' then format('select app.run_job(%L)', j.name) else format('select app.dispatch_http_job(%L)', j.name) end;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ============================================================ New scheduled rules
-- Temporary registrations (SPEC §6.10): reminder 30 days before valid_until; after it, the machine is deregistered as
-- exported (labels revoked, event logged) unless extended.
create or replace function app.run_temporary_registrations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.machines; reminded int := 0; expired int := 0;
begin
  for m in select * from public.machines where registration_type = 'temporary' and status = 'active' and valid_until is not null
             and valid_until between current_date and current_date + 30 loop
    if app.rate_limit_hit('temp-reminder:' || m.id || ':' || m.valid_until, 1, interval '60 days') then
      perform app.notify_org(m.owner_org_id, 'machine.temporary_expiring', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id,
        'valid_until', m.valid_until), '/machines/' || m.id, 'warning');
      reminded := reminded + 1;
    end if;
  end loop;
  for m in select * from public.machines where registration_type = 'temporary' and status = 'active' and valid_until < current_date for update loop
    update public.machines set status = 'exported', deregistration_reason = 'exported', deregistered_at = now() where id = m.id;
    update public.labels set status = 'revoked', revoked_at = now(), revoked_reason = 'temporary_expired' where machine_id = m.id and status = 'bound';
    perform app.log_event('machine.deregistered', m.id, m.owner_org_id, null, jsonb_build_object('reason', 'exported', 'cause', 'temporary_expired',
      'valid_until', m.valid_until));
    perform app.notify_org(m.owner_org_id, 'machine.temporary_expired', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id),
      '/machines/' || m.id, 'warning');
    expired := expired + 1;
  end loop;
  return jsonb_build_object('reminded', reminded, 'expired', expired);
end $$;

-- Stolen and not recovered within 24 months (SPEC §7.5): the operator gets a suggestion to deregister (once per flag).
create or replace function app.run_stolen_long_term()
returns int language plpgsql security definer set search_path = '' as $$
declare f record; n int := 0;
begin
  for f in select fl.id, m.reg_number, m.id machine_id from public.flags fl join public.machines m on m.id = fl.machine_id
           where fl.type = 'stolen' and fl.status = 'active' and fl.raised_at < now() - interval '24 months' loop
    if app.rate_limit_hit('stolen24:' || f.id, 1, interval '3650 days') then
      perform app.notify_operators('flag.stolen_24_months', jsonb_build_object('reg_number', f.reg_number, 'machine_id', f.machine_id),
        '/admin/flags', 'info', 'verifier');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Daily/weekly e-mail digest for users who chose it in their notification settings.
alter table public.notification_preferences add column last_digest_at timestamptz;

create or replace function app.enqueue_notification_digests(p_mode public.digest_mode)
returns int language plpgsql security definer set search_path = '' as $$
declare pref record; items jsonb; n int := 0; since timestamptz;
begin
  for pref in select np.*, p.email, p.locale, o.name org_name from public.notification_preferences np
      join public.profiles p on p.user_id = np.user_id and p.deleted_at is null and p.email is not null
      join public.organizations o on o.id = np.org_id
      where np.channel = 'email' and np.enabled and np.digest = p_mode loop
    since := coalesce(pref.last_digest_at, now() - case when p_mode = 'weekly' then interval '7 days' else interval '1 day' end);
    select jsonb_agg(jsonb_build_object('type', x.type, 'data', x.data, 'link', x.link, 'severity', x.severity, 'at', x.created_at) order by x.created_at desc)
    into items from (select * from public.notifications nt where nt.user_id = pref.user_id and nt.org_id = pref.org_id and nt.created_at > since
        and (case when cardinality(pref.event_types) = 0 then nt.severity in ('warning', 'critical')
                  else nt.type = any (pref.event_types) or '*' = any (pref.event_types) end)
        order by nt.created_at desc limit 50) x;
    update public.notification_preferences set last_digest_at = now() where user_id = pref.user_id and org_id = pref.org_id and channel = 'email';
    continue when items is null;
    insert into public.email_outbox (to_email, user_id, org_id, template, locale, data)
    values (pref.email, pref.user_id, pref.org_id, 'notification_digest', pref.locale, jsonb_build_object('mode', p_mode, 'org_name', pref.org_name, 'items', items));
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function app.run_daily_digests() returns int language sql security definer set search_path = '' as $$ select app.enqueue_notification_digests('daily') $$;
create or replace function app.run_weekly_digests() returns int language sql security definer set search_path = '' as $$ select app.enqueue_notification_digests('weekly') $$;

-- The whole event chain is re-verified every night; a break is critical.
create or replace function app.run_verify_chain()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb := app.verify_chain();
begin
  if not coalesce((r ->> 'ok')::boolean, false) then
    perform app.notify_operators('chain.broken', jsonb_build_object('at_seq', r ->> 'bad_seq'), '/admin/events', 'critical', 'superadmin');
  end if;
  return r;
end $$;

create or replace function app.run_partitions() returns int language plpgsql security definer set search_path = '' as $$
begin
  perform app.ensure_monthly_partitions('access_log', 3);
  return 1;
end $$;

create or replace function app.run_billing_close() returns jsonb language sql security definer set search_path = '' as $$ select public.close_billing_period(null) $$;
create or replace function app.run_statistics() returns jsonb language sql security definer set search_path = '' as $$ select public.refresh_statistics() $$;

-- Housekeeping: short-lived technical rows only; nothing in the register or the event chain is deleted.
create or replace function app.run_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int; e int;
begin
  delete from app.rate_limits where window_start < now() - interval '2 days'; get diagnostics a = row_count;
  delete from public.api_idempotency where created_at < now() - interval '2 days'; get diagnostics b = row_count;
  delete from public.push_outbox where status in ('sent', 'failed') and created_at < now() - interval '30 days'; get diagnostics c = row_count;
  delete from public.email_outbox where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '90 days'; get diagnostics d = row_count;
  delete from public.job_runs where started_at < now() - interval '90 days'; get diagnostics e = row_count;
  return jsonb_build_object('rate_limits', a, 'idempotency', b, 'push_outbox', c, 'email_outbox', d, 'job_runs', e);
end $$;

insert into public.jobs (name, description, schedule, kind, target) values
  ('expire-transfers',     'Cancel transfers not accepted within 14 days',            '*/15 * * * *', 'sql',  'expire_transfers'),
  ('rental-statuses',      'Rentals: planned → active → overdue',                     '10 * * * *',   'sql',  'update_rental_statuses'),
  ('reminders',            'Service/inspection reminder notifications',               '0 5 * * *',    'sql',  'run_reminder_notifications'),
  ('weekly-digest',        'Weekly fleet digest e-mail',                              '30 5 * * 1',   'sql',  'enqueue_weekly_digest'),
  ('daily-digests',        'Daily notification digests',                              '45 5 * * *',   'sql',  'run_daily_digests'),
  ('weekly-digests',       'Weekly notification digests',                             '50 5 * * 1',   'sql',  'run_weekly_digests'),
  ('temporary-regs',       'Temporary registrations: reminders and expiry',           '15 4 * * *',   'sql',  'run_temporary_registrations'),
  ('stolen-24-months',     'Suggest deregistration of machines stolen > 24 months',   '0 6 * * 1',    'sql',  'run_stolen_long_term'),
  ('purge-leads',          'Delete leads older than the retention period',            '0 3 * * *',    'sql',  'purge_old_leads'),
  ('anonymize-market',     'Anonymise old market observations',                       '10 3 * * *',   'sql',  'anonymize_old_observations'),
  ('partitions',           'Create access log partitions ahead',                      '0 2 * * *',    'sql',  'run_partitions'),
  ('statistics',           'Daily public statistics snapshot',                        '30 2 * * *',   'sql',  'run_statistics'),
  ('verify-chain',         'Re-verify the whole event chain',                         '40 1 * * *',   'sql',  'run_verify_chain'),
  ('billing-close',        'Invoice last month (1st of month)',                       '0 4 1 * *',    'sql',  'run_billing_close'),
  ('cleanup',              'Delete short-lived technical rows',                       '20 * * * *',   'sql',  'run_cleanup'),
  ('collect-http-results', 'Record Edge Function job responses',                      '*/5 * * * *',  'sql',  'collect_http_job_results'),
  ('email-send',           'Send queued e-mail',                                      '* * * * *',    'http', 'email-send'),
  ('webhook-dispatch',     'Deliver webhooks',                                        '* * * * *',    'http', 'webhook-dispatch'),
  ('push-send',            'Send web push',                                           '* * * * *',    'http', 'push-send'),
  ('anchor-events',        'Publish yesterday''s event anchor',                       '15 0 * * *',   'http', 'anchor-events'),
  ('telematics-sync',      'Fetch telematics feeds',                                  '*/15 * * * *', 'http', 'telematics-sync'),
  ('theft-sync',           'Sync with the theft register',                            '*/10 * * * *', 'http', 'theft-sync'),
  ('billing-sync',         'Push invoices to Stripe',                                 '30 * * * *',   'http', 'billing-sync');

-- ============================================================ Operator
create or replace function public.admin_list_jobs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) || jsonb_build_object('runs', (select coalesce(jsonb_agg(jsonb_build_object('started_at', r.started_at,
        'status', r.status, 'error', r.error, 'ms', (extract(epoch from r.finished_at - r.started_at) * 1000)::int) order by r.started_at desc), '[]'::jsonb)
        from (select * from public.job_runs r2 where r2.job_name = j.name order by r2.started_at desc limit 5) r)) order by j.kind desc, j.name) from public.jobs j), '[]'::jsonb),
    'scheduler', jsonb_build_object('pg_cron', to_regnamespace('cron') is not null, 'pg_net', to_regnamespace('net') is not null,
      'functions_url', coalesce(trim(both '"' from app.config_text('FUNCTIONS_BASE_URL', '')), '') <> '', 'cron_secret', app.secret('cron_secret') is not null));
end $$;

create or replace function public.admin_run_job(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r jsonb;
begin
  perform app.require_operator('superadmin');
  select * into j from public.jobs where name = p_name;
  if j.name is null then perform app.raise('NOT_FOUND'); end if;
  r := case when j.kind = 'sql' then app.run_job(j.name) else app.dispatch_http_job(j.name) end;
  perform app.audit('job.run', 'job', j.name, jsonb_build_object('status', r ->> 'status'));
  return r;
end $$;

create or replace function public.admin_set_job_enabled(p_name text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_operator('superadmin');
  update public.jobs set enabled = p_enabled where name = p_name;
  if not found then perform app.raise('NOT_FOUND'); end if;
  perform app.schedule_jobs();
  perform app.audit(case when p_enabled then 'job.enabled' else 'job.disabled' end, 'job', p_name);
  return jsonb_build_object('ok', true);
end $$;

-- Health endpoint for uptime monitoring (Edge Function "health", service role): cheap checks, no register data.
create or replace function public.health_check()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', not exists (select 1 from public.jobs where enabled and consecutive_failures >= 3),
    'db', true, 'failing_jobs', (select coalesce(jsonb_agg(name), '[]'::jsonb) from public.jobs where enabled and consecutive_failures >= 3),
    'email_backlog', (select count(*) from public.email_outbox where status = 'pending' and created_at < now() - interval '15 minutes'),
    'webhook_backlog', (select count(*) from public.webhook_deliveries where status = 'pending' and created_at < now() - interval '15 minutes'),
    'last_anchor_day', (select max(day) from public.event_anchors where published_at is not null),
    'checked_at', now())
$$;

-- /status shows whether scheduled jobs are healthy (counts only).
create or replace function public.public_system_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'database', 'ok',
    'demo', app.is_demo_mode(),
    'last_anchor', (select jsonb_build_object('day', a.day, 'root', a.root_hash, 'published_at', a.published_at, 'reference', a.external_ref)
      from public.event_anchors a where a.published_at is not null order by a.day desc limit 1),
    'events_last_24h', (select count(*) from public.events where created_at > now() - interval '24 hours'),
    'statistics_at', (select max(created_at) from public.statistics_snapshots),
    'jobs', jsonb_build_object('total', (select count(*) from public.jobs where enabled),
      'failing', (select count(*) from public.jobs where enabled and consecutive_failures >= 3)),
    'integrations', jsonb_build_object('nfc', app.flag('FEATURE_NFC') or app.is_demo_mode(), 'telematics', app.flag('FEATURE_TELEMATICS') or app.is_demo_mode(),
      'theft_sync', app.theft_sync_enabled(), 'push', app.push_enabled(), 'payments', app.payments_enabled()),
    'checked_at', now())
$$;

select app.schedule_jobs();

revoke execute on function public.health_check() from public, anon, authenticated;
grant execute on function public.health_check() to service_role;
grant execute on function public.admin_list_jobs(), public.admin_run_job(text), public.admin_set_job_enabled(text, boolean) to authenticated;
select app.grant_api_access();
