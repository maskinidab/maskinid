-- The closed pilot (ADR 0034).
--
-- Production goes live with real accounts and real e-mail, but without a BankID broker yet. DEMO_MODE was one switch
-- for three different things – mock identity, demo data shortcuts, and the yellow banner – so turning it off for
-- real e-mail also made every signup impossible (verify_identity and complete_mock_signature refuse outside demo).
--
-- Two new flags, both off by default so nothing changes for staging, tests or the demo:
--   MOCK_IDENTITY        Demo-BankID (identity and signatures) is allowed without demo mode.
--   REQUIRE_ORG_APPROVAL Every new organisation waits for an operator, and a pending one can do nothing.
-- With mock identity nobody's identity is actually verified, so the operator's approval is the safeguard: the
-- pilot always runs both together.

insert into public.app_config (key, value, description) values
  ('MOCK_IDENTITY', 'false', 'Allow Demo-BankID (identity and signatures) outside demo mode – the closed pilot, ADR 0034'),
  ('REQUIRE_ORG_APPROVAL', 'false', 'Every new organisation waits for operator approval and can do nothing until then – ADR 0034')
on conflict (key) do nothing;

alter table public.organizations add column if not exists rejected_at timestamptz;

create or replace function app.mock_identity_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_demo_mode() or app.flag('MOCK_IDENTITY')
$$;

create or replace function app.require_org_approval()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.flag('REQUIRE_ORG_APPROVAL')
$$;

grant execute on function app.mock_identity_allowed(), app.require_org_approval() to anon, authenticated, service_role;

-- ---------- A pending organisation is invisible to its own members' reads ----------
create or replace function app.current_org_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case
    when app.current_api_key_id() is not null then
      coalesce((select array[k.org_id] from public.api_keys k where k.id = app.current_api_key_id() and k.revoked_at is null), '{}')
    else coalesce((
      select array_agg(m.org_id) from public.memberships m
      join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid() and m.status = 'active' and o.status <> 'suspended'
        and not (o.status = 'pending' and app.require_org_approval())), '{}')
  end
$$;

-- ---------- ...and cannot act ----------
create or replace function app.require_actor(
  p_org_id uuid, p_min_role public.member_role default 'member', p_need_verified boolean default true)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare k public.api_keys; o public.organizations; uid uuid := auth.uid();
begin
  if app.current_api_key_id() is not null then
    select * into k from public.api_keys where id = app.current_api_key_id() and revoked_at is null;
    if k.id is null then perform app.raise('NOT_AUTHENTICATED'); end if;
    if p_org_id is not null and p_org_id <> k.org_id then perform app.raise('FORBIDDEN'); end if;
    select * into o from public.organizations where id = k.org_id;
    if o.status = 'suspended' or (o.status = 'pending' and app.require_org_approval()) then
      perform app.raise('ORG_NOT_APPROVED', jsonb_build_object('status', o.status));
    end if;
    return k.org_id;
  end if;
  if uid is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_org_id is null then perform app.raise('ORG_REQUIRED'); end if;
  select * into o from public.organizations where id = p_org_id;
  if o.id is null or not app.is_member_of(p_org_id, p_min_role) then perform app.raise('FORBIDDEN'); end if;
  perform set_config('app.view_as_uid', case when exists (select 1 from public.memberships m where m.org_id = p_org_id and m.user_id = uid
    and m.status = 'active') then '' else uid::text end, true);
  if o.status = 'suspended' then perform app.raise('ORG_NOT_APPROVED', jsonb_build_object('status', o.status)); end if;
  -- The pilot: an application is not an account yet (ADR 0034).
  if o.status = 'pending' and app.require_org_approval() then
    perform app.raise('ORG_NOT_APPROVED', jsonb_build_object('status', o.status));
  end if;
  if p_need_verified and not app.is_verified_user() then perform app.raise('IDENTITY_NOT_VERIFIED'); end if;
  if p_need_verified and not app.is_demo_mode() and o.status = 'approved'
     and o.types && array['financier', 'authority', 'operator']::public.org_type[]
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    perform app.raise('MFA_REQUIRED');
  end if;
  return p_org_id;
end $$;

-- ---------- Demo-BankID without demo mode ----------
create or replace function public.record_identity_verification(p_user_id uuid, p_personal_number text, p_provider text, p_evidence jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; other uuid;
begin
  if p_provider not in ('bankid', 'mock') then perform app.raise('VALIDATION', '{"field":"provider"}'); end if;
  if p_provider = 'mock' and not app.mock_identity_allowed() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  h := app.sha256_hex(app.secret('personal_number_salt') || ':' || regexp_replace(coalesce(p_personal_number, ''), '\D', '', 'g'));
  select user_id into other from public.profiles where personal_number_hash = h and user_id <> p_user_id;
  if other is not null then
    perform app.raise('IDENTITY_IN_USE');
  end if;
  update public.profiles set identity_verified_at = now(), identity_provider = p_provider, personal_number_hash = h
  where user_id = p_user_id;
  if not found then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('identity.verified', null, null, null,
    jsonb_build_object('user_id', p_user_id, 'provider', p_provider));
  perform app.auto_approve_orgs_for(p_user_id);
  return jsonb_build_object('ok', true, 'identity_verified_at', now(), 'provider', p_provider);
end $$;

create or replace function public.verify_identity(p_provider text default 'mock')
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_provider <> 'mock' then perform app.raise('USE_BANKID_FLOW'); end if;
  if not app.mock_identity_allowed() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  return public.record_identity_verification(auth.uid(), 'demo-' || auth.uid()::text, 'mock',
    jsonb_build_object('demo', true, 'pilot', not app.is_demo_mode(), 'at', app.iso_ts(now())));
end $$;

create or replace function public.start_signature(p_org_id uuid, p_action text, p_subject_id uuid, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); s public.signatures; loc text;
begin
  if app.current_api_key_id() is not null then perform app.raise('SIGNATURE_REQUIRES_USER'); end if;
  select locale into loc from public.profiles where user_id = auth.uid();
  insert into public.signatures (provider, action, subject_type, subject_id, params, org_id, signer_user_id, signed_text)
  values (case when app.mock_identity_allowed() then 'mock' else 'bankid' end::public.signature_provider, p_action,
          case when p_action like '%transfer%' and p_action not like '%encumbrance%' then 'transfer'
               when p_action like '%encumbrance%' and p_action <> 'register_encumbrance' then 'encumbrance' else 'machine' end,
          p_subject_id, coalesce(p_params, '{}'), actor, auth.uid(), app.signature_text(p_action, p_subject_id, p_params, coalesce(loc, 'sv')))
  returning * into s;
  return jsonb_build_object('id', s.id, 'provider', s.provider, 'signed_text', s.signed_text, 'expires_at', s.expires_at);
end $$;

create or replace function public.complete_mock_signature(p_signature_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.signatures;
begin
  if not app.mock_identity_allowed() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  update public.signatures set status = 'completed', signed_at = now(),
    evidence = jsonb_build_object('demo', true, 'at', app.iso_ts(now()))
  where id = p_signature_id and signer_user_id = auth.uid() and status = 'pending' and provider = 'mock' and expires_at > now()
  returning * into s;
  if s.id is null then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

create or replace function app.consume_signature(p_signature_id uuid, p_action text, p_subject_id uuid, p_params jsonb default '{}'::jsonb,
  p_api_allowed boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.signatures;
begin
  if app.current_api_key_id() is not null and p_api_allowed then return null; end if;
  if p_signature_id is null then perform app.raise('SIGNATURE_REQUIRED', jsonb_build_object('action', p_action)); end if;
  select * into s from public.signatures where id = p_signature_id for update;
  if s.id is null or s.signer_user_id is distinct from auth.uid() or s.action <> p_action or s.subject_id <> p_subject_id then
    perform app.raise('SIGNATURE_INVALID');
  end if;
  if s.status <> 'completed' then perform app.raise('SIGNATURE_REQUIRED', jsonb_build_object('status', s.status)); end if;
  if s.consumed_at is not null then perform app.raise('SIGNATURE_ALREADY_USED'); end if;
  if s.signed_at < now() - interval '30 minutes' then perform app.raise('SIGNATURE_EXPIRED'); end if;
  if s.provider <> 'bankid' and not app.mock_identity_allowed() then perform app.raise('SIGNATURE_PROVIDER_NOT_ALLOWED'); end if;
  if jsonb_strip_nulls(coalesce(s.params, '{}')) <> jsonb_strip_nulls(coalesce(p_params, '{}')) then
    perform app.raise('SIGNATURE_PARAMS_MISMATCH');
  end if;
  update public.signatures set consumed_at = now() where id = s.id;
  return s.id;
end $$;

-- ---------- No automatic approval in the pilot ----------
create or replace function app.auto_approve_orgs_for(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o record; h text;
begin
  if app.require_org_approval() then return; end if;
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

-- ---------- Company lookup: entered by hand when there is no provider, and the operator checks it ----------
create or replace function public.lookup_company(p_org_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n text := app.normalize_org_number(p_org_number); h text; r jsonb; c public.company_lookups; existing public.organizations;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if n is null then perform app.raise('VALIDATION', '{"field":"org_number"}'); end if;
  h := app.org_number_hash(n);
  if app.is_demo_mode() then
    r := app.mock_company_lookup(n);
    perform public.record_company_lookup(n, r);
  else
    select * into c from public.company_lookups where org_number_hash = h and looked_up_at > now() - interval '30 days';
    if c.org_number_hash is not null then
      r := jsonb_build_object('name', c.name, 'city', c.city, 'address', c.address, 'is_sole_trader', c.is_sole_trader, 'source', c.source);
    elsif app.require_org_approval() then
      -- No register to ask: the applicant types the name, and the operator checks it against Bolagsverket.
      r := jsonb_build_object('name', null, 'city', null, 'address', null, 'is_sole_trader', app.is_sole_trader_number(n),
        'source', 'manual', 'manual', true);
    else
      perform app.raise('LOOKUP_REQUIRED');
    end if;
  end if;
  select * into existing from public.organizations where org_number_hash = h;
  return r || jsonb_build_object('org_number', case when (r ->> 'is_sole_trader')::boolean then '19XXXXXX-XXXX' else n end,
    'existing_org', case when existing.id is null then null else
      app.org_brief(existing.id) || jsonb_build_object(
        'claimable', not exists (select 1 from public.memberships where org_id = existing.id and status = 'active'),
        'needs_signatory', app.placeholder_is_load_bearing(existing.id) and not app.require_org_approval()) end);
end $$;

create or replace function public.create_org(
  p_org_number text, p_types public.org_type[], p_name text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_country text default 'SE', p_address jsonb default null, p_accept_dpa_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n text; h text; lk public.company_lookups; o public.organizations; sole boolean; name_ text; st public.org_status;
  types_ public.org_type[]; existing public.organizations; manual boolean := false; review boolean := app.require_org_approval();
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
    manual := lk.org_number_hash is null;
    sole := coalesce(lk.is_sole_trader, app.is_sole_trader_number(n));
    name_ := coalesce(lk.name, nullif(trim(p_name), ''));
  else
    n := nullif(trim(p_org_number), '');
    h := case when n is null then null else app.sha256_hex(app.secret('org_number_key') || ':' || upper(p_country) || ':' || n) end;
    sole := false;
    manual := true;
    name_ := nullif(trim(p_name), '');
  end if;
  if name_ is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  st := case when review then 'pending'
             when types_ = array['owner']::public.org_type[] and lk.org_number_hash is not null and coalesce(p_country, 'SE') = 'SE'
               and app.is_signatory(lk) then 'approved' else 'pending' end;
  -- Taking over a load-bearing placeholder needs a signatory – or, in the pilot, the operator's review.
  if existing.id is not null and st <> 'approved' and not app.is_demo_mode() and not review then
    if app.placeholder_is_load_bearing(existing.id) then perform app.raise('SIGNATORY_REQUIRED'); end if;
  end if;
  if existing.id is not null then
    update public.organizations set types = types_, name = name_, status = st, approved_at = case when st = 'approved' then now() end,
      email = nullif(trim(p_email), ''), phone = nullif(trim(p_phone), ''), website = nullif(trim(p_website), ''),
      lookup_source = coalesce(lk.source, case when manual and review then 'manual' end, lookup_source),
      lookup_at = coalesce(lk.looked_up_at, lookup_at),
      dpa_accepted_at = now(), dpa_version = p_accept_dpa_version, created_by = uid, rejected_at = null
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
      case when st = 'approved' then now() end, coalesce(lk.source, case when manual and review then 'manual' end), lk.looked_up_at,
      now(), p_accept_dpa_version, uid)
    returning * into o;
  end if;
  insert into public.memberships (org_id, user_id, role, status, accepted_at) values (o.id, uid, 'admin', 'active', now());
  update public.profiles set last_active_org_id = o.id where user_id = uid;
  perform app.log_event(case when existing.id is null then 'org.created' else 'org.claimed' end, null, o.id, o.id,
    jsonb_build_object('types', types_, 'status', st, 'sole_trader', sole, 'dpa_version', p_accept_dpa_version, 'manual', manual));
  if st = 'pending' then
    -- Warning severity, so it reaches the operators' inbox as e-mail and not only as a bell notification.
    perform app.notify_operators('org.pending_approval',
      jsonb_build_object('org_id', o.id, 'name', o.name, 'types', types_, 'manual', manual),
      '/admin/organizations/' || o.id, 'warning');
    perform app.notify_user(uid, o.id, 'org.received', jsonb_build_object('name', o.name), '/app', 'warning');
  end if;
  return app.org_brief(o.id) || jsonb_build_object('status', o.status, 'claimed', existing.id is not null);
end $$;

-- ---------- Approve, and the new reject ----------
create or replace function public.approve_org(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); o public.organizations;
begin
  update public.organizations set status = 'approved', approved_by = auth.uid(), approved_at = now(), suspended_reason = null,
    rejected_at = null
  where id = p_org_id and status <> 'approved' returning * into o;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('org.approved', null, o.id, op, jsonb_build_object('types', o.types));
  perform app.audit('org.approved', 'organization', o.id::text, jsonb_build_object('types', o.types));
  perform app.notify_org(o.id, 'org.approved', jsonb_build_object('name', o.name), '/dashboard', 'warning');
  return app.org_brief(o.id);
end $$;

-- Rejecting an application. Stored as `suspended` – every existing check already treats that as closed – with the
-- reason and rejected_at, so the applicant's waiting screen can say why. The operator can still approve later.
create or replace function public.reject_org(p_org_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); o public.organizations;
begin
  if nullif(trim(p_reason), '') is null then perform app.raise('VALIDATION', '{"field":"reason"}'); end if;
  update public.organizations set status = 'suspended', suspended_reason = left(trim(p_reason), 500), rejected_at = now()
  where id = p_org_id and status = 'pending' and 'operator' <> all (types) returning * into o;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('org.rejected', null, o.id, op, jsonb_build_object('reason', o.suspended_reason));
  perform app.audit('org.rejected', 'organization', o.id::text, jsonb_build_object('reason', o.suspended_reason));
  perform app.notify_org(o.id, 'org.rejected', jsonb_build_object('name', o.name, 'reason', o.suspended_reason), '/app', 'warning');
  return app.org_brief(o.id);
end $$;

revoke all on function public.reject_org(uuid, text) from public;
grant execute on function public.reject_org(uuid, text) to authenticated, service_role;

-- ---------- The applicant's context says where they stand ----------
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.profiles; va public.view_as_sessions;
begin
  if uid is null then return null; end if;
  select * into p from public.profiles where user_id = uid;
  select * into va from public.view_as_sessions where user_id = uid and ended_at is null and expires_at > now() order by started_at desc limit 1;
  return jsonb_build_object(
    'user_id', uid,
    'email', p.email,
    'full_name', p.full_name,
    'phone', p.phone,
    'locale', coalesce(p.locale, 'sv'),
    'identity_verified_at', p.identity_verified_at,
    'identity_provider', p.identity_provider,
    'last_active_org_id', p.last_active_org_id,
    'operator_role', (select role from public.operator_roles where user_id = uid),
    'memberships', coalesce((
      select jsonb_agg(x order by x -> 'org' ->> 'name') from (
        select jsonb_build_object('membership_id', m.id, 'role', m.role,
          'org', app.org_brief(o.id) || jsonb_build_object('rejection_reason', case when o.rejected_at is not null then o.suspended_reason end,
            'created_at', o.created_at),
          'effective_types', (select coalesce(jsonb_agg(t), '[]') from unnest(enum_range(null::public.org_type)) t where app.has_org_type(o.id, t)),
          'min_trusted_level', coalesce((o.settings ->> 'min_trusted_level')::int, 0),
          'modules', (select coalesce(jsonb_object_agg(n, app.org_module(o.id, n)), '{}'::jsonb) from unnest(app.module_names()) n)) x
        from public.memberships m join public.organizations o on o.id = m.org_id
        where m.user_id = uid and m.status = 'active'
        union all
        select jsonb_build_object('membership_id', null, 'role', 'readonly', 'org', app.org_brief(o.id), 'view_as', true, 'view_as_expires_at', va.expires_at,
          'effective_types', (select coalesce(jsonb_agg(t), '[]') from unnest(enum_range(null::public.org_type)) t where app.has_org_type(o.id, t)),
          'min_trusted_level', coalesce((o.settings ->> 'min_trusted_level')::int, 0),
          'modules', (select coalesce(jsonb_object_agg(n, app.org_module(o.id, n)), '{}'::jsonb) from unnest(app.module_names()) n))
        from public.organizations o where o.id = va.org_id and app.is_operator('support')) s), '[]'::jsonb),
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object('membership_id', m.id, 'org', app.org_brief(m.org_id), 'role', m.role))
      from public.memberships m where m.status = 'invited' and lower(m.invite_email) = p.email
        and (m.invite_expires_at is null or m.invite_expires_at > now())), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.notifications where user_id = uid and read_at is null),
    'legal_pending', app.legal_pending(uid),
    'demo_mode', app.is_demo_mode(),
    'mock_identity', app.mock_identity_allowed(),
    'require_org_approval', app.require_org_approval()
  );
end $$;

-- ---------- The first operator in a real environment ----------
-- The seed creates the operator directly; production has no seed. Called by the deploy pipeline with the
-- environment's OPERATOR_EMAIL once that person has signed up. Idempotent, and a no-op before they have.
create or replace function app.bootstrap_operator(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; op uuid;
begin
  select user_id into uid from public.profiles where lower(email) = lower(trim(p_email)) and deleted_at is null;
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'no_such_user'); end if;
  op := app.operator_org_id();
  if op is null then
    insert into public.organizations (slug, types, name, status, approved_at, lookup_source, country, dpa_accepted_at, dpa_version, created_by)
    values (app.unique_slug('MaskinID'), array['operator']::public.org_type[], 'MaskinID', 'approved', now(), 'operator', 'SE',
      now(), 'operator', uid)
    returning id into op;
    perform app.log_event('org.created', null, op, op, jsonb_build_object('operator', true));
  end if;
  insert into public.memberships (org_id, user_id, role, status, accepted_at) values (op, uid, 'admin', 'active', now())
  on conflict do nothing;
  update public.memberships set status = 'active', role = 'admin' where org_id = op and user_id = uid;
  insert into public.operator_roles (user_id, role) values (uid, 'superadmin')
  on conflict (user_id) do update set role = 'superadmin';
  -- No signed-in operator here (the pipeline runs it), so the audit row names the person who was made one.
  insert into public.operator_audit (user_id, action, target_type, target_id, details)
  values (uid, 'operator.bootstrapped', 'user', uid::text, jsonb_build_object('email', lower(trim(p_email))));
  return jsonb_build_object('ok', true, 'user_id', uid, 'operator_org_id', op);
end $$;

revoke all on function app.bootstrap_operator(text) from public, anon, authenticated;
grant execute on function app.bootstrap_operator(text) to service_role;
