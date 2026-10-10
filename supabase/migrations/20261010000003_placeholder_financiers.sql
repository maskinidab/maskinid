-- =====================================================================
-- Financing can be registered against a bank that is not a MaskinID customer yet.
--
-- A dealer who receives a bank order from, say, LF Finans must be able to register the financing against
-- LF Finans immediately — and the day LF Finans starts using MaskinID their machines must already be there.
-- The mechanism already existed for the owner side (app.resolve_owner_org creates an unclaimed placeholder
-- organisation, and create_org claims it in place keeping the same id). This migration generalises it to the
-- lender side.
--
-- Security boundary (ADR 0027): app.has_org_type is deliberately NOT changed. A pending placeholder still acts
-- as `owner` only, so it cannot register encumbrances, confirm them, release them or read a portfolio. The new
-- predicate app.can_be_financier_holder is used ONLY where a bank is *named* as the holder of a financing.
-- Being nameable is not a capability: the placeholder can do nothing at all until an operator approves the
-- organisation and a real signatory claims it.
-- =====================================================================

-- ---------- Generalised placeholder resolution ----------
create or replace function app.resolve_org_by_number(p_actor_org uuid, p_org_number text, p_types public.org_type[],
  p_name text default null, p_invite_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare oid uuid; n text; h text; lk jsonb; o public.organizations; token text; types_ public.org_type[];
begin
  types_ := array(select distinct x from unnest(coalesce(p_types, array['owner']::public.org_type[])) x where x <> 'operator');
  if cardinality(types_) = 0 then perform app.raise('VALIDATION', '{"field":"types"}'); end if;
  n := app.normalize_org_number(p_org_number);
  if n is null then perform app.raise('VALIDATION', '{"field":"org_number"}'); end if;
  h := app.org_number_hash(n);
  select * into o from public.organizations where org_number_hash = h;
  if o.id is not null then
    if o.status = 'suspended' then perform app.raise('VALIDATION', '{"field":"org_number","reason":"suspended"}'); end if;
    -- An existing organisation that does not yet declare the type we need (e.g. a dealer we have only ever seen
    -- as an owner) gets it added while it is still unclaimed. A claimed organisation is never silently changed.
    if not (types_ <@ o.types) and not exists (select 1 from public.memberships where org_id = o.id and status = 'active') then
      update public.organizations set types = array(select distinct t from unnest(o.types || types_) t) where id = o.id;
      perform app.log_event('org.types_extended', null, o.id, p_actor_org, jsonb_build_object('added', types_, 'placeholder', true));
    end if;
    return o.id;
  end if;
  if app.is_demo_mode() then
    lk := app.mock_company_lookup(n);
  else
    select jsonb_build_object('name', name, 'city', city, 'address', address, 'is_sole_trader', is_sole_trader, 'source', source)
      into lk from public.company_lookups where org_number_hash = h;
  end if;
  if lk is null and nullif(p_name, '') is null then perform app.raise('LOOKUP_REQUIRED'); end if;
  insert into public.organizations (slug, types, name, org_number, org_number_hash, org_number_enc, is_sole_trader, address, city,
    status, lookup_source, lookup_at, created_by)
  values (app.unique_slug(coalesce(lk ->> 'name', p_name)), types_, coalesce(lk ->> 'name', p_name),
    case when coalesce((lk ->> 'is_sole_trader')::boolean, app.is_sole_trader_number(n)) then null else n end, h,
    case when coalesce((lk ->> 'is_sole_trader')::boolean, app.is_sole_trader_number(n))
         then extensions.pgp_sym_encrypt(n, app.secret('org_number_key')) end,
    coalesce((lk ->> 'is_sole_trader')::boolean, app.is_sole_trader_number(n)), lk -> 'address', lk ->> 'city',
    'pending', lk ->> 'source', case when lk is null then null else now() end, auth.uid())
  returning id into oid;
  perform app.log_event('org.created', null, oid, p_actor_org,
    jsonb_build_object('placeholder', true, 'created_by_org', p_actor_org, 'as_types', types_));
  if nullif(trim(p_invite_email), '') is not null then
    token := encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.memberships (org_id, role, status, invited_by, invite_token_hash, invite_email, invite_expires_at)
    values (oid, 'admin', 'invited', auth.uid(), app.sha256_hex(token), lower(trim(p_invite_email)), now() + interval '30 days');
    insert into public.email_outbox (to_email, org_id, template, data)
    values (lower(trim(p_invite_email)), oid,
      case when 'financier' = any (types_) then 'invite_financier' else 'invite_owner' end,
      jsonb_build_object('token', token, 'org_name', coalesce(lk ->> 'name', p_name),
        'registered_by', (select name from public.organizations where id = p_actor_org)));
  end if;
  return oid;
end $$;

-- resolve_owner_org keeps its contract and becomes a thin call (the owner path is unchanged).
create or replace function app.resolve_owner_org(p_actor_org uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.organizations;
begin
  if p_data ? 'owner_org_id' and nullif(p_data ->> 'owner_org_id', '') is not null then
    select * into o from public.organizations where id = (p_data ->> 'owner_org_id')::uuid and status <> 'suspended';
    if o.id is null then perform app.raise('VALIDATION', '{"field":"owner_org_id"}'); end if;
    return o.id;
  end if;
  if nullif(p_data ->> 'owner_org_number', '') is null then return p_actor_org; end if;
  return app.resolve_org_by_number(p_actor_org, p_data ->> 'owner_org_number', array['owner']::public.org_type[],
    p_data ->> 'owner_name', p_data ->> 'owner_email');
end $$;

-- ---------- Who may be named as the holder of a financing ----------
-- Approved financier, or an unclaimed/pending organisation that declares the financier type. Never suspended.
create or replace function app.can_be_financier_holder(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o
                 where o.id = p_org_id and o.status <> 'suspended' and 'financier' = any (o.types))
$$;

-- ---------- Naming the bank when asking for a financing ----------
-- The old signature is dropped rather than replaced: added parameters with defaults would leave two overloads
-- and make the existing positional/named calls ambiguous.
drop function if exists public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date);

create or replace function public.request_encumbrance(p_org_id uuid, p_machine_id uuid, p_holder_org_id uuid default null,
  p_type public.encumbrance_type default 'ownership_reservation', p_contract_ref text default null,
  p_start_date date default current_date, p_end_date date default null,
  p_holder_org_number text default null, p_holder_name text default null, p_holder_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; existing public.encumbrances; e public.encumbrances;
  ev public.events; holder uuid; placeholder boolean;
begin
  select * into m from public.machines where id = p_machine_id for update;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if (m.owner_org_id = actor or m.registered_by_org_id = actor or m.first_sale_dealer_org_id = actor) is not true then perform app.raise('FORBIDDEN'); end if;
  perform app.assert_not_blocked(m.id, 'request_encumbrance');
  -- Either an organisation we already know, or a bank named by its organisation number (which creates an
  -- unclaimed placeholder the bank can take over later).
  if p_holder_org_id is not null then
    holder := p_holder_org_id;
  elsif nullif(trim(p_holder_org_number), '') is not null then
    holder := app.resolve_org_by_number(actor, p_holder_org_number, array['financier']::public.org_type[], p_holder_name, p_holder_email);
  else
    perform app.raise('VALIDATION', '{"field":"holder_org_id"}');
  end if;
  if not app.can_be_financier_holder(holder) then perform app.raise('FINANCIER_NOT_ELIGIBLE', jsonb_build_object('holder_org_id', holder)); end if;
  perform app.validate_encumbrance_params(p_type, p_start_date, p_end_date);
  if p_type in ('ownership_reservation', 'leasing') then
    select * into existing from public.encumbrances where machine_id = m.id and status = 'active' and type in ('ownership_reservation', 'leasing');
    if existing.id is not null then
      return app.encumbrance_conflict(m.id, actor, existing, jsonb_build_object('type', p_type, 'requested_holder_org_id', holder));
    end if;
  end if;
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    requested_by_org_id, registered_by_user_id)
  values (m.id, p_type, holder, m.owner_org_id, nullif(trim(p_contract_ref), ''), coalesce(p_start_date, current_date), p_end_date,
    'pending', actor, auth.uid())
  returning * into e;
  placeholder := not exists (select 1 from public.memberships where org_id = holder and status = 'active');
  ev := app.log_event('encumbrance.requested', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'type', e.type, 'holder_org_id', holder, 'holder_unclaimed', placeholder));
  -- notify_org writes nothing for an organisation without active members. That is fine and deliberate: get_inbox
  -- and list_portfolio are derived from table state, so every pending row materialises the moment the bank claims
  -- the organisation. The invitation e-mail (resolve_org_by_number) is what knocks on the door.
  perform app.notify_org(holder, 'encumbrance.pending',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'requested_by', (select name from public.organizations where id = actor),
      'encumbrance_id', e.id), '/inbox', 'warning');
  perform app.enqueue_webhook(holder, 'encumbrance.pending', m.id, jsonb_build_object('encumbrance_id', e.id, 'type', e.type), ev.id);
  return jsonb_build_object('ok', true, 'encumbrance', app.encumbrance_json(e, true),
    'holder', app.org_brief(holder), 'holder_unclaimed', placeholder);
end $$;

revoke all on function public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text) from public;
grant execute on function public.request_encumbrance(uuid, uuid, uuid, public.encumbrance_type, text, date, date, text, text, text)
  to authenticated, service_role;

-- ---------- Holder transfer accepts a not-yet-onboarded lender too ----------
create or replace function public.transfer_encumbrance_holder(p_org_id uuid, p_encumbrance_id uuid, p_new_holder_org_id uuid, p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); e public.encumbrances; n public.encumbrances; m public.machines; sig uuid;
begin
  select * into e from public.encumbrances where id = p_encumbrance_id for update;
  if e.id is null then perform app.raise('NOT_FOUND'); end if;
  if e.holder_org_id <> actor then perform app.raise('FORBIDDEN'); end if;
  if e.status <> 'active' then perform app.raise('ENCUMBRANCE_NOT_ACTIVE'); end if;
  if not app.can_be_financier_holder(p_new_holder_org_id) or p_new_holder_org_id = actor then
    perform app.raise('VALIDATION', '{"field":"new_holder_org_id"}');
  end if;
  if exists (select 1 from public.encumbrances where transferred_from_encumbrance_id = e.id and status = 'pending') then
    perform app.raise('ENCUMBRANCE_TRANSFER_PENDING');
  end if;
  sig := app.consume_signature(p_signature_id, 'transfer_encumbrance_holder', e.id, jsonb_build_object('new_holder_org_id', p_new_holder_org_id));
  insert into public.encumbrances (machine_id, type, holder_org_id, counterparty_org_id, contract_ref, start_date, end_date, status,
    transferred_from_encumbrance_id, requested_by_org_id, registered_by_user_id, notes)
  values (e.machine_id, e.type, p_new_holder_org_id, e.counterparty_org_id, e.contract_ref, e.start_date, e.end_date, 'pending',
    e.id, actor, auth.uid(), e.notes) returning * into n;
  select * into m from public.machines where id = e.machine_id;
  perform app.log_event('encumbrance.transfer_initiated', m.id, m.owner_org_id, actor,
    jsonb_build_object('encumbrance_id', e.id, 'new_encumbrance_id', n.id, 'new_holder_org_id', p_new_holder_org_id, 'signature_id', sig));
  perform app.notify_org(p_new_holder_org_id, 'encumbrance.transfer_offered',
    jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'from', (select name from public.organizations where id = actor), 'encumbrance_id', n.id),
    '/inbox', 'warning');
  return jsonb_build_object('ok', true, 'new_encumbrance_id', n.id);
end $$;

-- ---------- Claiming a placeholder ----------
-- A placeholder that already carries encumbrances is as load-bearing as one that carries machines: taking it over
-- hands someone every financing registered against that bank. Require a signatory for both.
create or replace function app.placeholder_is_load_bearing(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.machines where owner_org_id = p_org_id)
      or exists (select 1 from public.encumbrances where holder_org_id = p_org_id)
$$;

-- lookup_company tells the UI whether the organisation can be taken over, so onboarding can offer the claim path
-- instead of only "request access" (which notifies admins a placeholder does not have).
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
    if c.org_number_hash is null then perform app.raise('LOOKUP_REQUIRED'); end if;
    r := jsonb_build_object('name', c.name, 'city', c.city, 'address', c.address, 'is_sole_trader', c.is_sole_trader, 'source', c.source);
  end if;
  select * into existing from public.organizations where org_number_hash = h;
  return r || jsonb_build_object('org_number', case when (r ->> 'is_sole_trader')::boolean then '19XXXXXX-XXXX' else n end,
    'existing_org', case when existing.id is null then null else
      app.org_brief(existing.id) || jsonb_build_object(
        'claimable', not exists (select 1 from public.memberships where org_id = existing.id and status = 'active'),
        'needs_signatory', app.placeholder_is_load_bearing(existing.id)) end);
end $$;

-- ---------- create_org: the signatory requirement now covers placeholders carrying encumbrances ----------
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
    -- A placeholder that carries machines OR encumbrances can only be claimed by a signatory (or via operator
    -- review): taking over a bank's placeholder would hand someone every financing registered against it.
    if app.placeholder_is_load_bearing(existing.id) then perform app.raise('SIGNATORY_REQUIRED'); end if;
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

-- ---------- Bank master data attached to a financing ----------
-- When a dealer picks a finance company the right details for that bank should come along automatically:
-- contact route, default product and term, and how that bank wants payoff requests handled.
create or replace function public.get_financier_profile(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations;
begin
  if auth.uid() is null and app.current_api_key_id() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  select * into o from public.organizations where id = p_org_id;
  if o.id is null or not ('financier' = any (o.types)) then perform app.raise('NOT_FOUND'); end if;
  return app.org_brief(o.id) || jsonb_build_object(
    'email', o.email, 'phone', o.phone, 'website', o.website, 'address', o.address,
    'claimable', not exists (select 1 from public.memberships where org_id = o.id and status = 'active'),
    'financing_defaults', coalesce(o.settings -> 'financing_defaults', '{}'::jsonb));
end $$;

-- OCR read a bank name and/or an organisation number off a bank order. Resolve it to an organisation so the
-- dealer only has to confirm. Exact on the organisation number, otherwise a trigram match on the name.
create or replace function public.match_financier(p_org_id uuid, p_name text default null, p_org_number text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); n text; o public.organizations; hit uuid; score real;
begin
  n := app.normalize_org_number(p_org_number);
  if n is not null then
    select * into o from public.organizations where org_number_hash = app.org_number_hash(n);
    if o.id is not null then
      return jsonb_build_object('source', 'org_number', 'score', 1.0,
        'financier', case when 'financier' = any (o.types) then public.get_financier_profile(o.id) end,
        'org', app.org_brief(o.id), 'eligible', app.can_be_financier_holder(o.id));
    end if;
    return jsonb_build_object('source', 'org_number', 'score', 1.0, 'org', null, 'eligible', false, 'org_number', n);
  end if;
  if nullif(trim(p_name), '') is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  select x.id, extensions.similarity(x.name, trim(p_name)) into hit, score from public.organizations x
  where x.status = 'approved' and 'financier' = any (x.types) and extensions.similarity(x.name, trim(p_name)) > 0.3
  order by 2 desc limit 1;
  if hit is null then return jsonb_build_object('source', 'name', 'score', 0, 'org', null, 'eligible', false); end if;
  return jsonb_build_object('source', 'name', 'score', score, 'org', app.org_brief(hit),
    'financier', public.get_financier_profile(hit), 'eligible', app.can_be_financier_holder(hit));
end $$;

revoke all on function public.get_financier_profile(uuid), public.match_financier(uuid, text, text) from public;
grant execute on function public.get_financier_profile(uuid), public.match_financier(uuid, text, text) to authenticated, service_role;

-- ---------- A lender's financing defaults are an org setting ----------
-- financing_defaults: { contract_ref_prefix, default_type, default_term_months, contact_email, contact_phone,
-- payoff_instructions }. Surfaced by get_financier_profile and pre-filled into the dealer's financing form.
create or replace function public.update_org(p_org_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed text[] := array['email', 'phone', 'website', 'address', 'vat_number'];
  settings_patch jsonb := coalesce(p_patch -> 'settings', '{}'); k text;
begin
  perform app.require_actor(p_org_id, 'admin');
  for k in select jsonb_object_keys(p_patch) loop
    if k <> 'settings' and not (k = any (allowed)) then perform app.raise('VALIDATION', jsonb_build_object('field', k)); end if;
  end loop;
  for k in select jsonb_object_keys(settings_patch) loop
    if k not in ('min_trusted_level', 'show_authority_reads_to_owner', 'claims_url', 'require_level2_for_insurance',
                 'partner_verification', 'public_inspection_badge', 'digest_day', 'financing_defaults') then
      perform app.raise('VALIDATION', jsonb_build_object('field', 'settings.' || k));
    end if;
  end loop;
  if settings_patch ? 'min_trusted_level' and (settings_patch ->> 'min_trusted_level')::int not between 0 and 2 then
    perform app.raise('VALIDATION', '{"field":"settings.min_trusted_level"}');
  end if;
  update public.organizations set
    email = case when p_patch ? 'email' then nullif(trim(p_patch ->> 'email'), '') else email end,
    phone = case when p_patch ? 'phone' then nullif(trim(p_patch ->> 'phone'), '') else phone end,
    website = case when p_patch ? 'website' then nullif(trim(p_patch ->> 'website'), '') else website end,
    vat_number = case when p_patch ? 'vat_number' then nullif(trim(p_patch ->> 'vat_number'), '') else vat_number end,
    address = case when p_patch ? 'address' then p_patch -> 'address' else address end,
    city = case when p_patch ? 'address' then coalesce(p_patch -> 'address' ->> 'city', city) else city end,
    settings = settings || settings_patch
  where id = p_org_id;
  perform app.log_event('org.updated', null, p_org_id, p_org_id, jsonb_build_object('fields', (select jsonb_agg(k2) from jsonb_object_keys(p_patch) k2)));
  return public.get_org(p_org_id);
end $$;
