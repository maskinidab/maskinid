-- Step 24 (interpreted, SPEC §20.12–20.16 missing – ADR 0021): register statistics, data export, web push,
-- API sandbox, partial search for professional roles and merging duplicate machine records.

-- ============================================================ Statistics
-- Public numbers are aggregates only and small cells (1–4) are suppressed so no single owner can be singled out.
create table public.statistics_snapshots (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  data       jsonb not null
);
alter table public.statistics_snapshots enable row level security;

create or replace function app.k(p_n bigint, p_suppress boolean)
returns bigint language sql immutable set search_path = '' as $$
  select case when p_suppress and p_n between 1 and 4 then null else p_n end
$$;

create or replace function app.compute_statistics(p_suppress boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  with stock as (
    select m.*, app.county_for_city((select city from public.organizations o where o.id = m.owner_org_id)) county
    from public.machines m where m.status in ('active', 'stolen', 'blocked', 'disputed')
  )
  select jsonb_build_object(
    'generated_at', now(),
    'suppressed', p_suppress,
    'totals', jsonb_build_object(
      'machines', (select count(*) from stock),
      'registered_12m', (select count(*) from public.machines where status <> 'draft' and created_at > now() - interval '12 months'),
      -- Theft numbers are not about owners (the stolen list is public) and are not suppressed.
      'stolen_active', (select count(*) from public.flags where type = 'stolen' and status = 'active'),
      'recovered_12m', (select count(*) from public.flags where type = 'stolen' and status = 'cleared' and cleared_at > now() - interval '12 months'),
      'labels_bound', (select count(*) from public.labels where status = 'bound'),
      'electric_share', round(coalesce((select count(*) filter (where fuel_type = 'electric' or electric_config is not null)::numeric
        / nullif(count(*), 0) from stock), 0), 3)),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('key', category, 'n', app.k(n, p_suppress)) order by n desc)
      from (select category::text, count(*) n from stock group by 1) x), '[]'),
    'by_level', coalesce((select jsonb_agg(jsonb_build_object('key', verification_level, 'n', n) order by verification_level)
      from (select verification_level, count(*) n from stock group by 1) x), '[]'),
    'by_emission_stage', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'n', app.k(n, p_suppress)) order by k)
      from (select coalesce(emission_stage::text, 'unknown') k, count(*) n from stock group by 1) x), '[]'),
    'by_fuel', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'n', app.k(n, p_suppress)) order by n desc)
      from (select coalesce(fuel_type::text, 'unknown') k, count(*) n from stock group by 1) x), '[]'),
    'by_county', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'n', app.k(n, p_suppress)) order by n desc)
      from (select coalesce(county, 'unknown') k, count(*) n from stock group by 1) x), '[]'),
    'by_age', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'n', app.k(n, p_suppress)) order by array_position(array['0-4', '5-9', '10-14', '15+', 'unknown'], k))
      from (select case when year is null then 'unknown' when extract(year from now()) - year < 5 then '0-4'
                        when extract(year from now()) - year < 10 then '5-9' when extract(year from now()) - year < 15 then '10-14' else '15+' end k,
                   count(*) n from stock group by 1) x), '[]'),
    'registrations_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'),
        'n', (select count(*) from public.machines m where m.status <> 'draft' and date_trunc('month', m.created_at at time zone 'Europe/Stockholm') = mo)) order by mo)
      from generate_series(date_trunc('month', now() at time zone 'Europe/Stockholm') - interval '11 months', date_trunc('month', now() at time zone 'Europe/Stockholm'), interval '1 month') mo), '[]'),
    -- Environment (Naturvårdsverket / Energimyndigheten): category × emission stage × fuel with hours, suppressed cells dropped.
    'environment', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'emission_stage', stage, 'fuel', fuel, 'n', n,
        'avg_power_kw', avg_kw, 'avg_hours', avg_h) order by category, stage, fuel)
      from (select category::text category, coalesce(emission_stage::text, 'unknown') stage, coalesce(fuel_type::text, 'unknown') fuel, count(*) n,
              round(avg(engine_power_kw))::int avg_kw, round(avg(hour_meter))::int avg_h
            from stock group by 1, 2, 3) x where not p_suppress or n >= 5), '[]')
  ) into r;
  return r;
end $$;

create or replace function public.refresh_statistics()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.statistics_snapshots (data) values (app.compute_statistics(true));
  delete from public.statistics_snapshots where created_at < now() - interval '400 days';
  return jsonb_build_object('ok', true);
end $$;

-- Latest daily snapshot (≤ 36 h old), else computed live – always suppressed.
create or replace function public.public_statistics()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select data from public.statistics_snapshots where created_at > now() - interval '36 hours' order by id desc limit 1),
    app.compute_statistics(true))
$$;

create or replace function public.admin_statistics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return app.compute_statistics(false) || jsonb_build_object(
    'orgs_by_type', (select jsonb_object_agg(t, n) from (select unnest(types)::text t, count(*) n from public.organizations where status = 'approved' group by 1) x),
    'checks_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'),
        'n', (select count(*) from public.check_receipts c where date_trunc('month', c.created_at at time zone 'Europe/Stockholm') = mo)) order by mo)
      from generate_series(date_trunc('month', now() at time zone 'Europe/Stockholm') - interval '11 months', date_trunc('month', now() at time zone 'Europe/Stockholm'), interval '1 month') mo), '[]'),
    'transfers_12m', (select count(*) from public.transfers where status = 'completed' and completed_at > now() - interval '12 months'),
    'encumbrances_active', (select count(*) from public.encumbrances where status = 'active'));
end $$;

-- ============================================================ Data export (GDPR art. 15/20, "dataportabilitet")
-- Columns that never leave the database, whatever the table.
create or replace function app.export_secret_columns()
returns text[] language sql immutable set search_path = '' as $$
  select array['key_hash', 'secret', 'token_hash', 'invite_token_hash', 'personal_number_hash', 'org_number_enc', 'org_number_hash',
    'p256dh', 'auth', 'ip_hash', 'draft_data']
$$;

create or replace function app.export_rows(p_table text, p_column text, p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = p_column) then
    return null;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t) - $2), ''[]''::jsonb) from public.%I t where t.%I = $1', p_table, p_column)
    into r using p_org, app.export_secret_columns();
  return r;
end $$;

create or replace function public.export_org_data(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); out jsonb; t record; mids uuid[];
begin
  if not app.rate_limit_hit('export:' || actor, 5, interval '1 day') then perform app.raise('RATE_LIMITED'); end if;
  select array_agg(id) into mids from public.machines where owner_org_id = actor or registered_by_org_id = actor;
  out := jsonb_build_object('format', 'maskinid-export/1', 'exported_at', now(), 'organization', public.get_org(actor),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'email', coalesce(p.email, ms.invite_email), 'role', ms.role,
        'status', ms.status, 'since', ms.accepted_at)), '[]') from public.memberships ms left join public.profiles p on p.user_id = ms.user_id where ms.org_id = actor),
    'machine_identifiers', (select coalesce(jsonb_agg(to_jsonb(i) - app.export_secret_columns()), '[]') from public.machine_identifiers i where i.machine_id = any (mids)),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('seq', e.seq, 'type', e.type, 'machine_id', e.machine_id, 'created_at', e.created_at,
        'payload', e.payload, 'hash', e.hash) order by e.seq), '[]') from public.events e where e.org_id = actor or e.actor_org_id = actor));
  for t in select * from (values ('machines', 'owner_org_id'), ('ownerships', 'owner_org_id'), ('encumbrances', 'holder_org_id'),
      ('check_receipts', 'performed_by_org_id'), ('documents', 'org_id'), ('maintenance_entries', 'org_id'), ('inspections', 'inspector_org_id'),
      ('fuel_entries', 'org_id'), ('daily_checks', 'org_id'), ('insurance_policies', 'insurer_org_id'), ('rentals', 'lessor_org_id'),
      ('projects', 'org_id'), ('operators', 'org_id'), ('attachments', 'org_id'), ('leads', 'org_id'), ('customers', 'org_id'),
      ('mandates', 'principal_org_id'), ('transfers', 'from_org_id'), ('reminders', 'org_id'), ('labels', 'assigned_org_id'),
      ('invoices', 'org_id'), ('support_tickets', 'org_id'), ('api_keys', 'org_id'), ('webhooks', 'org_id'), ('share_links', 'org_id'),
      ('watchlist', 'org_id')) v(tbl, col) loop
    out := out || jsonb_strip_nulls(jsonb_build_object(t.tbl, app.export_rows(t.tbl, t.col, actor)));
  end loop;
  perform app.log_event('org.data_exported', null, actor, actor, jsonb_build_object('sections', (select count(*) from jsonb_object_keys(out))));
  return out;
end $$;

-- A person's own data, across organisations.
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if not app.rate_limit_hit('export-me:' || uid, 5, interval '1 day') then perform app.raise('RATE_LIMITED'); end if;
  return jsonb_build_object('format', 'maskinid-personal-export/1', 'exported_at', now(),
    'profile', (select to_jsonb(p) - app.export_secret_columns() || jsonb_build_object('identity_verified_with_bankid', p.personal_number_hash is not null)
      from public.profiles p where p.user_id = uid),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object('organization', o.name, 'role', ms.role, 'status', ms.status, 'since', ms.accepted_at)), '[]')
      from public.memberships ms join public.organizations o on o.id = ms.org_id where ms.user_id = uid),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]') from (select * from public.notifications where user_id = uid order by created_at desc limit 1000) n),
    'security_events', (select coalesce(jsonb_agg(to_jsonb(s) - app.export_secret_columns() order by s.created_at desc), '[]') from public.security_events s where s.user_id = uid),
    'legal_acceptances', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.legal_acceptances a where a.user_id = uid),
    'support_messages', (select coalesce(jsonb_agg(jsonb_build_object('ticket', t.number, 'subject', t.subject, 'body', m.body, 'at', m.created_at)), '[]')
      from public.support_messages m join public.support_tickets t on t.id = m.ticket_id where m.author_user_id = uid),
    'push_devices', (select coalesce(jsonb_agg(jsonb_build_object('device', s.ua_family, 'created_at', s.created_at)), '[]') from public.push_subscriptions s where s.user_id = uid),
    'events_as_actor', (select coalesce(jsonb_agg(jsonb_build_object('seq', e.seq, 'type', e.type, 'created_at', e.created_at) order by e.seq), '[]')
      from public.events e where e.actor_user_id = uid));
end $$;

-- ============================================================ Web push
create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  endpoint        text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh          text not null check (length(p256dh) between 40 and 200),
  auth            text not null check (length(auth) between 10 and 100),
  ua_family       text check (length(ua_family) <= 60),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failures        int not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.push_outbox (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  user_id         uuid not null,
  type            text not null,
  data            jsonb not null default '{}'::jsonb,
  link            text,
  severity        public.notification_severity not null default 'info',
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index push_outbox_due_idx on public.push_outbox (next_attempt_at) where status = 'pending';
alter table public.push_subscriptions enable row level security;
alter table public.push_outbox enable row level security;

create or replace function app.push_enabled()
returns boolean language sql stable security definer set search_path = '' as $$ select app.flag('FEATURE_PUSH') or app.is_demo_mode() $$;

-- Push follows the e-mail defaults (warning + critical) unless the user set push preferences for the org.
create or replace function app.queue_push() returns trigger language plpgsql security definer set search_path = '' as $$
declare pref public.notification_preferences; want boolean;
begin
  if not app.push_enabled() or not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  select * into pref from public.notification_preferences where user_id = new.user_id and org_id is not distinct from new.org_id and channel = 'push';
  want := case when pref.user_id is null then new.severity in ('warning', 'critical') when not pref.enabled then false
               when cardinality(pref.event_types) = 0 then new.severity in ('warning', 'critical')
               else new.type = any (pref.event_types) or '*' = any (pref.event_types) end;
  if want then
    insert into public.push_outbox (subscription_id, user_id, type, data, link, severity)
    select s.id, new.user_id, new.type, new.data, new.link, new.severity from public.push_subscriptions s where s.user_id = new.user_id and s.failures < 5;
  end if;
  return new;
end $$;
create trigger notifications_push after insert on public.notifications for each row execute function app.queue_push();

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua_family text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.push_subscriptions;
begin
  if uid is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if (select count(*) from public.push_subscriptions where user_id = uid) >= 10 then perform app.raise('RATE_LIMITED'); end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua_family) values (uid, p_endpoint, p_p256dh, p_auth, left(p_ua_family, 60))
  on conflict (endpoint) do update set user_id = uid, p256dh = excluded.p256dh, auth = excluded.auth, ua_family = excluded.ua_family, failures = 0
  returning * into s;
  return jsonb_build_object('ok', true, 'id', s.id);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"subscription"}');
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'deleted', found);
end $$;

create or replace function public.list_my_push_subscriptions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'endpoint_host', split_part(split_part(endpoint, '://', 2), '/', 1), 'ua_family', ua_family,
    'created_at', created_at, 'last_success_at', last_success_at, 'failing', failures > 0) order by created_at desc), '[]'::jsonb)
  from public.push_subscriptions where user_id = auth.uid()
$$;

create or replace function public.send_test_push()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if not app.rate_limit_hit('push-test:' || auth.uid(), 10, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  insert into public.push_outbox (subscription_id, user_id, type, data, link, severity)
  select id, user_id, 'push.test', '{}'::jsonb, '/notifications', 'info' from public.push_subscriptions where user_id = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'queued', n);
end $$;

-- Edge Function push-send (service role).
create or replace function public.claim_push_outbox(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  with c as (
    update public.push_outbox o set status = 'sending', attempts = attempts + 1
    where o.id in (select id from public.push_outbox where status = 'pending' and next_attempt_at <= now() order by created_at
                   limit least(greatest(p_limit, 1), 500) for update skip locked)
    returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'data', c.data, 'link', c.link, 'severity', c.severity,
      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'locale', coalesce(p.locale, 'sv'))), '[]'::jsonb) into r
  from c join public.push_subscriptions s on s.id = c.subscription_id left join public.profiles p on p.user_id = c.user_id;
  return r;
end $$;

-- ok ⇒ sent; gone (404/410) ⇒ subscription removed; else retry with backoff, max 5 attempts.
create or replace function public.record_push_result(p_id uuid, p_ok boolean, p_gone boolean default false, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.push_outbox;
begin
  select * into o from public.push_outbox where id = p_id for update;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_ok then
    update public.push_outbox set status = 'sent', sent_at = now(), last_error = null where id = o.id;
    update public.push_subscriptions set last_success_at = now(), failures = 0 where id = o.subscription_id;
  elsif p_gone then
    delete from public.push_subscriptions where id = o.subscription_id;
  else
    update public.push_outbox set status = case when o.attempts >= 5 then 'failed' else 'pending' end, last_error = left(p_error, 300),
      next_attempt_at = now() + (interval '1 minute' * power(4, o.attempts)) where id = o.id;
    update public.push_subscriptions set failures = failures + 1 where id = o.subscription_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Fix: the settings page saves "all" as event_types ['*'], which notify_user compared literally, so "all" sent no
-- e-mail at all. Same function as in migration 0004 with the wildcard honoured.
create or replace function app.notify_user(
  p_user_id uuid, p_org_id uuid, p_type text, p_data jsonb, p_link text,
  p_severity public.notification_severity default 'info')
returns void language plpgsql security definer set search_path = '' as $$
declare pref public.notification_preferences; p public.profiles; send_email boolean;
begin
  if p_user_id is null then return; end if;
  insert into public.notifications (user_id, org_id, type, data, link, severity)
  values (p_user_id, p_org_id, p_type, coalesce(p_data, '{}'), p_link, p_severity);
  select * into p from public.profiles where user_id = p_user_id;
  if p.email is null or p.deleted_at is not null then return; end if;
  select * into pref from public.notification_preferences
    where user_id = p_user_id and org_id is not distinct from p_org_id and channel = 'email';
  send_email := case when pref.user_id is null then app.default_email(p_severity)
                     when not pref.enabled then false
                     when cardinality(pref.event_types) = 0 then app.default_email(p_severity)
                     else p_type = any (pref.event_types) or '*' = any (pref.event_types) end;
  if send_email and coalesce(pref.digest, 'instant') = 'instant' then
    insert into public.email_outbox (to_email, user_id, org_id, template, locale, data)
    values (p.email, p_user_id, p_org_id, 'notification', p.locale,
            jsonb_build_object('type', p_type, 'data', p_data, 'link', p_link, 'severity', p_severity));
  end if;
  if p_severity = 'critical' and app.flag('FEATURE_SMS') and p.phone is not null then
    insert into public.email_outbox (to_email, user_id, org_id, template, locale, data)
    values (p.phone, p_user_id, p_org_id, 'sms', p.locale, jsonb_build_object('type', p_type, 'data', p_data, 'link', p_link));
  end if;
end $$;

-- ============================================================ API sandbox
-- Sandbox keys (mk_test_) are answered from a fixed test dataset in the api-v1 function and never reach the register.
-- Their requests are still logged for the key's usage view, but never billed.
create or replace function app.meter_api() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status_code < 500 and new.status_code <> 429
     and not coalesce((select sandbox from public.api_keys where id = new.api_key_id), false) then
    perform app.record_usage(new.org_id, 'api_call', 1, 'api:' || new.id, new.created_at);
  end if;
  return new;
end $$;

-- ============================================================ Partial search
-- For lenders, insurers, dealers and inspection bodies: find a machine from part of a serial or reg number (≥ 5
-- characters), e.g. a worn nameplate. Returns at most 10 candidates with the identifier masked except the matched
-- part – never owner or financing; a full check is then made on the chosen machine.
create or replace function app.mask_match(p_value text, p_q text)
returns text language sql immutable set search_path = '' as $$
  select case when p_value is null or strpos(p_value, p_q) = 0 then null
    else repeat('•', strpos(p_value, p_q) - 1) || p_q || repeat('•', greatest(length(p_value) - strpos(p_value, p_q) - length(p_q) + 1, 0)) end
$$;

create or replace function public.partial_search(p_org_id uuid, p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member'); q text := app.normalize_identifier(p_query); res jsonb;
begin
  perform app.require_scope('machines:read');
  if not (app.has_org_type(actor, 'financier') or app.has_org_type(actor, 'insurer') or app.has_org_type(actor, 'dealer')
          or app.has_org_type(actor, 'inspector') or app.has_org_type(actor, 'authority') or app.has_org_type(actor, 'operator')) then
    perform app.raise('FORBIDDEN');
  end if;
  if coalesce(length(q), 0) < 5 then perform app.raise('VALIDATION', '{"field":"query","reason":"min_5"}'); end if;
  if not app.rate_limit_hit('partial:' || actor, 30, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  select coalesce(jsonb_agg(x order by x ->> 'reg_number'), '[]'::jsonb) into res from (
    select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year, 'category', m.category,
      'flagged', m.status in ('stolen', 'blocked', 'disputed'),
      'match', coalesce(app.mask_match(m.reg_number, q), (select app.mask_match(i.normalized_value, q) from public.machine_identifiers i
        where i.machine_id = m.id and i.type in ('serial', 'pin', 'vin') and i.normalized_value like '%' || q || '%' limit 1)),
      'match_type', case when m.reg_number like '%' || q || '%' then 'reg' else (select i.type::text from public.machine_identifiers i
        where i.machine_id = m.id and i.type in ('serial', 'pin', 'vin') and i.normalized_value like '%' || q || '%' limit 1) end) x
    from public.machines m
    where m.status not in ('draft') and m.merged_into_id is null
      and (m.reg_number like '%' || q || '%' or exists (select 1 from public.machine_identifiers i where i.machine_id = m.id
             and i.type in ('serial', 'pin', 'vin') and i.normalized_value like '%' || q || '%'))
    limit 10) s;
  perform app.log_event('machine.partial_search', null, actor, actor, jsonb_build_object('query_length', length(q), 'hits', jsonb_array_length(res)));
  return res;
end $$;

-- ============================================================ Merge duplicate machine records
alter table public.machines add column merged_into_id uuid references public.machines (id);

create or replace function public.admin_merge_machines(p_keep_id uuid, p_merge_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); k public.machines; d public.machines; t text; moved jsonb := '{}'::jsonb; n int;
begin
  if p_keep_id = p_merge_id then perform app.raise('VALIDATION', '{"field":"machines"}'); end if;
  if nullif(trim(p_note), '') is null then perform app.raise('VALIDATION', '{"field":"note"}'); end if;
  select * into k from public.machines where id = p_keep_id for update;
  select * into d from public.machines where id = p_merge_id for update;
  if k.id is null or d.id is null then perform app.raise('NOT_FOUND'); end if;
  if k.status in ('scrapped', 'exported', 'deregistered', 'draft') or d.merged_into_id is not null or d.status in ('scrapped', 'exported') then
    perform app.raise('VALIDATION', '{"field":"status"}');
  end if;
  -- Only records of the same owner (or an ownerless/draft duplicate) are merged; different owners are an ownership dispute.
  if d.owner_org_id is not null and k.owner_org_id is distinct from d.owner_org_id then perform app.raise('VALIDATION', '{"field":"owner"}'); end if;
  if exists (select 1 from public.transfers where machine_id in (k.id, d.id) and status in ('draft', 'awaiting_buyer', 'awaiting_financier')) then
    perform app.raise('TRANSFER_ALREADY_OPEN');
  end if;
  if (select count(*) from public.encumbrances where machine_id in (k.id, d.id) and status = 'active' and type in ('leasing', 'ownership_reservation')) > 1 then
    perform app.raise('ACTIVE_ENCUMBRANCE_EXISTS');
  end if;

  -- 1. The duplicate becomes a read-only record pointing to the kept machine (frees its identifiers' unique slots).
  update public.machines set status = 'deregistered', deregistration_reason = 'misregistered', deregistered_at = now(), merged_into_id = k.id
  where id = d.id;
  -- 2. Identifiers the kept machine lacks move over; exact duplicates stay on the old record.
  update public.machine_identifiers i set machine_id = k.id, conflict_id = null
  where i.machine_id = d.id and not exists (select 1 from public.machine_identifiers x where x.machine_id = k.id and x.type = i.type
    and x.normalized_value = i.normalized_value);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('machine_identifiers', n);
  -- 3. Labels: a second primary becomes secondary.
  update public.labels set role = 'secondary' where machine_id = d.id and status = 'bound' and role = 'primary'
    and exists (select 1 from public.labels l where l.machine_id = k.id and l.status = 'bound' and l.role = 'primary');
  update public.labels set machine_id = k.id where machine_id = d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('labels', n);
  -- 4. Flags: active flags of a type the kept machine already has are cleared, the rest move.
  update public.flags set status = 'cleared', cleared_at = now(), cleared_reason = 'merged'
  where machine_id = d.id and status = 'active' and exists (select 1 from public.flags f where f.machine_id = k.id and f.type = flags.type and f.status = 'active');
  -- 5. Everything else that hangs on the machine. A table whose rows would break a one-open-per-machine rule keeps them on
  --    the old record (visible via the link) rather than failing the merge.
  foreach t in array array['flags', 'encumbrances', 'documents', 'inspections', 'maintenance_entries', 'fuel_entries', 'daily_checks',
      'insurance_policies', 'reminders', 'rentals', 'leads', 'attachment_mounts', 'attachments', 'machine_assignments', 'machine_operators',
      'machine_departments', 'verification_requests', 'tips', 'market_alerts'] loop
    begin
      execute format('update public.%I set machine_id = $1 where machine_id = $2', t) using k.id, d.id;
      get diagnostics n = row_count;
      if n > 0 then moved := moved || jsonb_build_object(t, n); end if;
    exception when unique_violation then
      moved := moved || jsonb_build_object(t, 'kept_on_merged_record');
    end;
  end loop;
  -- 6. Open conflicts between the two are settled by the merge.
  update public.conflicts set status = 'resolved', resolved_by_user_id = auth.uid(), resolved_at = now(), resolution_note = 'merged: ' || trim(p_note)
  where status = 'open' and ((machine_id = k.id and related_machine_id = d.id) or (machine_id = d.id and related_machine_id = k.id));
  update public.machines set hour_meter = greatest(k.hour_meter, d.hour_meter),
    verification_level = greatest(k.verification_level, d.verification_level), updated_at = now() where id = k.id;
  perform app.recompute_machine_status(k.id);
  perform app.log_event('machine.merged', k.id, k.owner_org_id, op, jsonb_build_object('merged_id', d.id, 'merged_reg_number', d.reg_number));
  perform app.log_event('machine.merged_into', d.id, d.owner_org_id, op, jsonb_build_object('keep_id', k.id, 'keep_reg_number', k.reg_number));
  perform app.audit('machine.merged', 'machine', k.id::text, jsonb_build_object('merged_id', d.id, 'note', trim(p_note), 'moved', moved));
  if k.owner_org_id is not null then
    perform app.notify_org(k.owner_org_id, 'machine.merged', jsonb_build_object('reg_number', k.reg_number, 'merged_reg_number', d.reg_number,
      'machine_id', k.id), '/machines/' || k.id, 'info');
  end if;
  return jsonb_build_object('ok', true, 'keep_id', k.id, 'merged_id', d.id, 'moved', moved);
end $$;

-- History of a machine includes the events of records merged into it.
create or replace function public.get_machine_history(p_org_id uuid, p_machine_id uuid, p_limit int default 200, p_before_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); ids uuid[];
begin
  perform app.require_scope('machines:read');
  if not (app.can_view_machine(p_machine_id) or app.is_operator()) then perform app.raise('NOT_FOUND'); end if;
  ids := array[p_machine_id] || coalesce((select array_agg(id) from public.machines where merged_into_id = p_machine_id), '{}');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'seq', e.seq, 'id', e.id, 'type', e.type, 'category', app.event_category(e.type), 'created_at', e.created_at,
      'actor_type', e.actor_type,
      'actor_org', case when e.actor_org_id is null then null else jsonb_build_object('id', e.actor_org_id,
        'name', (select name from public.organizations where id = e.actor_org_id)) end,
      'actor_name', case when e.actor_org_id = any (app.current_org_ids()) or app.is_operator()
        then (select coalesce(p.full_name, 'user') from public.profiles p where p.user_id = e.actor_user_id and p.deleted_at is null) end,
      'payload', e.payload,
      'from_merged_record', case when e.machine_id <> p_machine_id then (select reg_number from public.machines where id = e.machine_id) end) order by e.seq desc)
    from (select * from public.events ev where ev.machine_id = any (ids)
            and (p_before_seq is null or ev.seq < p_before_seq)
            and app.can_read_event(ev.machine_id, ev.org_id, ev.type, ev.created_at)
          order by ev.seq desc limit least(greatest(p_limit, 1), 1000)) e), '[]'::jsonb);
end $$;

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
    -- step 22: stolen-list publication, for those who may toggle it (set_flag_public)
    || coalesce((select jsonb_build_object('stolen_public', jsonb_build_object('flag_id', f.id, 'published', f.publish_public))
      from public.flags f where f.machine_id = m.id and f.type = 'stolen' and f.status = 'active'
        and (p_rel && array['owner', 'authority'] or f.raised_by_org_id = p_org_id) limit 1), '{}'::jsonb)
    -- step 24: a merged record points to the machine it was merged into
    || case when m.merged_into_id is not null then jsonb_build_object('merged_into', jsonb_build_object('id', m.merged_into_id,
         'reg_number', (select reg_number from public.machines where id = m.merged_into_id))) else '{}'::jsonb end
$$;

revoke execute on function public.refresh_statistics(), public.claim_push_outbox(int), public.record_push_result(uuid, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.refresh_statistics(), public.claim_push_outbox(int), public.record_push_result(uuid, boolean, boolean, text) to service_role;
grant execute on function public.public_statistics() to anon, authenticated;
grant execute on function public.admin_statistics(), public.export_org_data(uuid), public.export_my_data(), public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text), public.list_my_push_subscriptions(), public.send_test_push(), public.partial_search(uuid, text),
  public.admin_merge_machines(uuid, uuid, text), public.get_machine_history(uuid, uuid, int, bigint) to authenticated;
select app.grant_api_access();
