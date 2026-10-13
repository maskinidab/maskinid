-- =====================================================================================================================
-- Enforcing the per-organisation modules, and getting them to the client (ADR 0031).
--
-- Hiding a menu item is not enough: `appRoutes` carries no role metadata, so every page in the app is reachable by
-- typing its address. The four modules taken out of the dealer view therefore need a server-side guard as well.
--
-- Implemented as BEFORE INSERT triggers on the four tables rather than as checks inside the RPCs. Two reasons:
-- a trigger catches every path at once (RPC, api-v1, a future import) instead of needing the guard repeated in
-- eight functions, and the alternative — putting it in app.require_fleet_access — would have spread it to
-- record_hours and the whole service history, which are not part of any module.
--
-- Reads are deliberately left open:
--   * list_rentals returns both directions (`out` and `in`), so a dealer that *rents a machine in* must keep
--     seeing it. It is renting out that is switched off, not reading.
--   * list_daily_checks / list_fuel / list_operators only ever return the caller's own rows, and with the module
--     off there are none to return.
--   * list_checklist_templates is NOT guarded: it is where Inbytestest gets its checklist, and a dealer with the
--     daily-check module off still has to be able to load the built-in templates.
-- =====================================================================================================================

-- The owning column is read through to_jsonb rather than as new.<col>: PL/pgSQL resolves a record field against
-- the actual row type when it plans the expression, so naming new.org_id at all would fail on `rentals`, which
-- has lessor_org_id instead — even in a CASE branch that is never taken.
create or replace function app.guard_module() returns trigger language plpgsql security definer set search_path = '' as $$
declare org uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
begin
  perform app.require_module(org, tg_argv[0]);
  return new;
end $$;

create trigger daily_checks_module before insert on public.daily_checks
  for each row execute function app.guard_module('daily_check', 'org_id');
create trigger fuel_entries_module before insert on public.fuel_entries
  for each row execute function app.guard_module('climate', 'org_id');
create trigger operators_module before insert on public.operators
  for each row execute function app.guard_module('operators', 'org_id');
create trigger machine_operators_module before insert on public.machine_operators
  for each row execute function app.guard_module('operators', 'org_id');
create trigger rentals_module before insert on public.rentals
  for each row execute function app.guard_module('rentals', 'lessor_org_id');

-- ---------- The organisation turns its own modules on ----------
-- A module is a view simplification, not a security boundary, so the organisation's own admin may switch one on —
-- the same place that already edits financing_defaults and min_trusted_level. Keeping it operator-only would have
-- made "aktivera den för de handlare som vill ha den" a support ticket every time.
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
                 'partner_verification', 'public_inspection_badge', 'digest_day', 'financing_defaults', 'modules') then
      perform app.raise('VALIDATION', jsonb_build_object('field', 'settings.' || k));
    end if;
  end loop;
  if settings_patch ? 'min_trusted_level' and (settings_patch ->> 'min_trusted_level')::int not between 0 and 2 then
    perform app.raise('VALIDATION', '{"field":"settings.min_trusted_level"}');
  end if;
  if settings_patch ? 'modules' then
    if jsonb_typeof(settings_patch -> 'modules') <> 'object' then perform app.raise('VALIDATION', '{"field":"settings.modules"}'); end if;
    -- Only known module names, only booleans: neither an admin nor an API client invents a key.
    for k in select jsonb_object_keys(settings_patch -> 'modules') loop
      if not (k = any (app.module_names())) or jsonb_typeof(settings_patch -> 'modules' -> k) <> 'boolean' then
        perform app.raise('VALIDATION', jsonb_build_object('field', 'settings.modules.' || k));
      end if;
    end loop;
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
  return app.org_brief(p_org_id);
end $$;

-- ---------- The operator can also set them, e.g. while helping a customer ----------
create or replace function public.admin_set_org_modules(p_org_id uuid, p_modules jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); o public.organizations; k text;
begin
  if jsonb_typeof(p_modules) <> 'object' then perform app.raise('VALIDATION', '{"field":"modules"}'); end if;
  for k in select jsonb_object_keys(p_modules) loop
    if not (k = any (app.module_names())) or jsonb_typeof(p_modules -> k) <> 'boolean' then
      perform app.raise('VALIDATION', jsonb_build_object('field', 'modules.' || k));
    end if;
  end loop;
  update public.organizations
  set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('modules', coalesce(settings -> 'modules', '{}'::jsonb) || p_modules)
  where id = p_org_id returning * into o;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('org.modules_changed', null, o.id, op, jsonb_build_object('modules', o.settings -> 'modules'));
  perform app.audit('org.modules_changed', 'organization', o.id::text, jsonb_build_object('modules', o.settings -> 'modules'));
  return jsonb_build_object('ok', true, 'modules', o.settings -> 'modules');
end $$;
revoke all on function public.admin_set_org_modules(uuid, jsonb) from public;
grant execute on function public.admin_set_org_modules(uuid, jsonb) to authenticated, service_role;

-- ---------- my_context carries the effective modules per membership ----------
-- Effective, not stored: the client needs the answer, and the answer is derived from the org type unless a key
-- has been set. Sending the raw settings would make the web app duplicate app.module_default.
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
        select jsonb_build_object('membership_id', m.id, 'role', m.role, 'org', app.org_brief(o.id),
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
    'demo_mode', app.is_demo_mode()
  );
end $$;
