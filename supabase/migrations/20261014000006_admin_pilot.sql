-- The operator's view of the closed pilot (ADR 0034).
--
-- The admin area could approve organisations but not see people: who signed up, whether they confirmed their e-mail,
-- whether they have BankID and two-factor, which organisations they belong to. Nor what was e-mailed, which lenders
-- exist (with or without an account), or what operators had done. All operator-only (support and up), and every look
-- at a person is itself written to the operator audit log.

create or replace function app.admin_user_json(u_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', u.id, 'email', u.email, 'full_name', p.full_name, 'phone', p.phone,
    'created_at', u.created_at, 'email_confirmed_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at,
    'identity_verified', p.identity_verified_at is not null, 'identity_verified_at', p.identity_verified_at,
    'identity_provider', p.identity_provider,
    'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
    'operator_role', (select role from public.operator_roles r where r.user_id = u.id),
    'deleted', p.deleted_at is not null,
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status,
        'types', o.types, 'role', m.role) order by o.name)
      from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = u.id and m.status = 'active'), '[]'::jsonb))
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = u_id
$$;
revoke all on function app.admin_user_json(uuid) from public, anon, authenticated;

-- ---------- Accounts ----------
create or replace function public.admin_list_users(p_query text default null, p_limit int default 200)
-- Volatile, not stable: it writes the audit row.
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); q text := nullif(trim(p_query), '');
begin
  if q is not null then perform app.audit('user.search', null, null, jsonb_build_object('query', left(q, 60))); end if;
  return coalesce((select jsonb_agg(app.admin_user_json(x.id) order by x.created_at desc) from (
    select u.id, u.created_at from auth.users u left join public.profiles p on p.user_id = u.id
    where q is null or u.email ilike '%' || q || '%' or p.full_name ilike '%' || q || '%'
    order by u.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]'::jsonb);
end $$;

create or replace function public.admin_get_user(p_user_id uuid)
-- Volatile, not stable: it writes the audit row.
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); u jsonb;
begin
  u := app.admin_user_json(p_user_id);
  if u is null then perform app.raise('NOT_FOUND'); end if;
  perform app.audit('user.view', 'user', p_user_id::text);
  return jsonb_build_object(
    'user', u,
    'orgs', u -> 'orgs',
    'pending_invites', coalesce((select jsonb_agg(jsonb_build_object('org', app.org_brief(m.org_id), 'role', m.role, 'expires_at', m.invite_expires_at))
      from public.memberships m where m.status = 'invited' and lower(m.invite_email) = lower(u ->> 'email')), '[]'::jsonb),
    'security_events', coalesce((select jsonb_agg(jsonb_build_object('type', s.type, 'ua_family', s.ua_family, 'created_at', s.created_at) order by s.created_at desc)
      from (select * from public.security_events where user_id = p_user_id order by created_at desc limit 30) s), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'template', e.template, 'type', e.data ->> 'type', 'status', e.status,
        'last_error', e.last_error, 'created_at', e.created_at, 'sent_at', e.sent_at) order by e.created_at desc)
      from (select * from public.email_outbox where user_id = p_user_id or lower(to_email) = lower(u ->> 'email')
            order by created_at desc limit 30) e), '[]'::jsonb));
end $$;

-- ---------- Lenders ----------
create or replace function public.admin_list_financiers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return coalesce((select jsonb_agg(x order by x ->> 'name') from (
    select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'org_number', app.org_number_display(o.id), 'types', o.types,
      'status', o.status, 'lookup_source', o.lookup_source, 'created_at', o.created_at,
      'members', (select count(*) from public.memberships m where m.org_id = o.id and m.status = 'active'),
      -- No member: a bank somebody named in a financing that has not taken over its account yet (ADR 0027).
      'placeholder', not exists (select 1 from public.memberships m where m.org_id = o.id and m.status = 'active'),
      'active_encumbrances', (select count(*) from public.encumbrances e where e.holder_org_id = o.id and e.status = 'active'),
      'pending_encumbrances', (select count(*) from public.encumbrances e where e.holder_org_id = o.id and e.status = 'pending'),
      'open_payoffs', (select count(*) from public.payoff_requests p where p.holder_org_id = o.id
        and p.status in ('requested', 'quoted', 'settlement_submitted')),
      'last_activity_at', (select max(ev.created_at) from public.events ev where ev.actor_org_id = o.id)) x
    from public.organizations o where 'financier' = any (o.types)) s), '[]'::jsonb);
end $$;

-- ---------- E-mail ----------
create or replace function public.admin_email_log(p_status text default null, p_query text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); q text := nullif(trim(p_query), '');
begin
  if p_status is not null and p_status not in ('pending', 'sent', 'failed', 'skipped') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.email_outbox where status = 'pending'),
      'sent', (select count(*) from public.email_outbox where status = 'sent'),
      'failed', (select count(*) from public.email_outbox where status = 'failed'),
      'skipped', (select count(*) from public.email_outbox where status = 'skipped')),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'to_email', e.to_email, 'template', e.template,
        'type', e.data ->> 'type', 'locale', e.locale, 'status', e.status, 'attempts', e.attempts, 'last_error', e.last_error,
        'created_at', e.created_at, 'send_after', e.send_after, 'sent_at', e.sent_at,
        'org', case when e.org_id is null then null else app.org_brief(e.org_id) end) order by e.created_at desc)
      from (select * from public.email_outbox
            where (p_status is null or status = p_status) and (q is null or to_email ilike '%' || q || '%' or template ilike '%' || q || '%')
            order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) e), '[]'::jsonb));
end $$;

-- ---------- What operators did ----------
create or replace function public.admin_audit_log(p_limit int default 200, p_before_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
      'details', a.details, 'created_at', a.created_at, 'operator_email', p.email, 'operator_name', p.full_name) order by a.id desc)
    from (select * from public.operator_audit where p_before_id is null or id < p_before_id
          order by id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) a
    left join public.profiles p on p.user_id = a.user_id), '[]'::jsonb);
end $$;

-- ---------- The overview, with what the pilot needs watched ----------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op uuid := app.require_operator('support');
begin
  return jsonb_build_object(
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
    'users_total', (select count(*) from auth.users),
    'users_unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
    'emails_pending', (select count(*) from public.email_outbox where status = 'pending'),
    'emails_failed_24h', (select count(*) from public.email_outbox where status = 'failed' and created_at > now() - interval '24 hours'),
    'pilot', jsonb_build_object('demo_mode', app.is_demo_mode(), 'mock_identity', app.flag('MOCK_IDENTITY'),
      'require_org_approval', app.require_org_approval()),
    'last_anchor', (select jsonb_build_object('day', day, 'published_at', published_at) from public.event_anchors order by day desc limit 1));
end $$;

revoke all on function public.admin_list_users(text, int), public.admin_get_user(uuid), public.admin_list_financiers(),
  public.admin_email_log(text, text, int), public.admin_audit_log(int, bigint) from public;
grant execute on function public.admin_list_users(text, int), public.admin_get_user(uuid), public.admin_list_financiers(),
  public.admin_email_log(text, text, int), public.admin_audit_log(int, bigint) to authenticated, service_role;
