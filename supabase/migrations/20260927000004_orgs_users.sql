-- =====================================================================
-- 0003 organisations & users (SPEC §2, §4.1, §4.8, §6.1, §11.1, §11.7)
--
-- Also creates the org-level infrastructure every later RPC needs:
-- notifications (+ preferences), the e-mail outbox, webhooks and
-- deliveries, API keys and the API request log (RPCs for keys/webhooks
-- come in step 15).
-- =====================================================================

-- ---------- Secrets (Vault in production, app.secrets fallback) ----------
create table app.secrets (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
revoke all on app.secrets from public, anon, authenticated, service_role;
insert into app.secrets (name, value) values
  ('org_number_key', encode(extensions.gen_random_bytes(32), 'hex')),
  ('personal_number_salt', encode(extensions.gen_random_bytes(32), 'hex')),
  ('ip_hash_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- Reads a secret from Supabase Vault if available, otherwise from app.secrets.
create or replace function app.secret(p_name text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  end if;
  if v is null then select value into v from app.secrets where name = p_name; end if;
  return v;
end $$;

create or replace function app.slugify(p text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(p, '')), 'åäöéèüæøß', 'aaoeeuaos'), '[^a-z0-9]+', '-', 'g'))
$$;

-- ---------- Organisations ----------
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  types           public.org_type[] not null check (cardinality(types) > 0),
  name            text not null check (length(trim(name)) between 2 and 200),
  org_number      text unique,                    -- legal entities only (public information)
  org_number_hash text unique,                    -- keyed hash of the normalised number, for all orgs incl. sole traders
  org_number_enc  bytea,                          -- sole traders only: personal number, pgp_sym_encrypt (SPEC §11.7)
  is_sole_trader  boolean not null default false,
  country         char(2) not null default 'SE',
  vat_number      text,
  address         jsonb,
  city            text,
  email           text,
  phone           text,
  website         text,
  status          public.org_status not null default 'pending',
  approved_by     uuid,
  approved_at     timestamptz,
  suspended_reason text,
  lookup_source   text,                           -- 'roaring' | 'bolagsverket' | 'mock' | null (not looked up)
  lookup_at       timestamptz,
  parent_org_id   uuid references public.organizations (id),
  settings        jsonb not null default '{}'::jsonb,  -- min_trusted_level, show_authority_reads_to_owner, claims_url …
  dpa_accepted_at timestamptz,
  dpa_version     text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (not is_sole_trader or org_number is null)
);
create index organizations_types_idx on public.organizations using gin (types);
create index organizations_name_trgm on public.organizations using gin (name extensions.gin_trgm_ops);
create index organizations_parent_idx on public.organizations (parent_org_id);
create trigger organizations_updated before update on public.organizations for each row execute function app.set_updated_at();

create table public.profiles (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  full_name            text,
  email                text,
  phone                text,
  locale               text not null default 'sv' check (locale in ('sv', 'en')),
  identity_verified_at timestamptz,
  identity_provider    text check (identity_provider in ('bankid', 'mock')),
  personal_number_hash text,   -- sha256 with secret salt, never clear text (rule 6)
  last_active_org_id   uuid references public.organizations (id),
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index profiles_pnr_hash_uq on public.profiles (personal_number_hash) where personal_number_hash is not null;
create trigger profiles_updated before update on public.profiles for each row execute function app.set_updated_at();

create table public.memberships (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id),
  user_id           uuid references auth.users (id) on delete cascade,
  role              public.member_role not null default 'member',
  status            public.membership_status not null default 'invited',
  invited_by        uuid,
  invite_token_hash text unique,
  invite_email      text,
  invite_expires_at timestamptz,
  accepted_at       timestamptz,
  removed_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';
create index memberships_org_idx on public.memberships (org_id);
create unique index memberships_invite_email_uq on public.memberships (org_id, lower(invite_email)) where status = 'invited';

create table public.operator_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.operator_role not null,
  granted_by uuid,
  created_at timestamptz not null default now()
);

-- Cached company lookups (Roaring/Bolagsverket via Edge Function company-lookup, or the demo mock).
create table public.company_lookups (
  org_number_hash text primary key,
  name            text not null,
  address         jsonb,
  city            text,
  is_sole_trader  boolean not null default false,
  source          text not null,
  data            jsonb not null default '{}'::jsonb,
  looked_up_at    timestamptz not null default now()
);

-- ---------- Notifications & e-mail ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  org_id     uuid references public.organizations (id),
  type       text not null,
  title      text,          -- optional free text; normally the client renders notifications.<type> from data (i18n)
  body       text,
  data       jsonb not null default '{}'::jsonb,
  link       text,
  severity   public.notification_severity not null default 'info',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_preferences (
  user_id     uuid not null references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organizations (id),
  channel     public.notification_channel not null,
  event_types text[] not null default '{}',   -- empty = defaults (critical+warning for email)
  digest      public.digest_mode not null default 'instant',
  enabled     boolean not null default true,
  primary key (user_id, org_id, channel)
);

create table public.email_outbox (
  id          uuid primary key default gen_random_uuid(),
  to_email    text not null,
  user_id     uuid,
  org_id      uuid,
  template    text not null,
  locale      text not null default 'sv',
  data        jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts    int not null default 0,
  last_error  text,
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index email_outbox_pending_idx on public.email_outbox (send_after) where status = 'pending';

-- ---------- API keys, webhooks (RPCs in step 15) ----------
create table public.api_keys (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id),
  name              text not null,
  key_prefix        text not null unique,        -- first 8 characters, shown in the UI
  key_hash          text not null unique,        -- sha256 of the full key; the key is shown once
  scopes            text[] not null default '{}',
  rate_limit_per_min int not null default 60,
  sandbox           boolean not null default false,
  last_used_at      timestamptz,
  created_by        uuid,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index api_keys_org_idx on public.api_keys (org_id);

create table public.api_requests (
  id          bigint generated always as identity primary key,
  api_key_id  uuid references public.api_keys (id),
  org_id      uuid,
  endpoint    text not null,
  method      text not null,
  status_code int not null,
  latency_ms  int,
  ip_hash     text,
  error_code  text,
  created_at  timestamptz not null default now()
);
create index api_requests_key_idx on public.api_requests (api_key_id, created_at desc);
create index api_requests_created_idx on public.api_requests (created_at);

create table public.webhooks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id),
  url         text not null check (url ~ '^https://'),
  secret      text not null,
  event_types text[] not null default '{}',
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index webhooks_org_idx on public.webhooks (org_id) where active;

create table public.webhook_deliveries (
  id            uuid primary key default gen_random_uuid(),
  webhook_id    uuid not null references public.webhooks (id) on delete cascade,
  event_id      uuid,
  event_type    text not null,
  payload       jsonb not null,
  attempt       int not null default 0,
  status        public.webhook_delivery_status not null default 'pending',
  response_code int,
  last_error    text,
  next_retry_at timestamptz not null default now(),
  delivered_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index webhook_deliveries_pending_idx on public.webhook_deliveries (next_retry_at) where status = 'pending';
create index webhook_deliveries_webhook_idx on public.webhook_deliveries (webhook_id, created_at desc);

-- ---------- Helpers ----------
create or replace function app.role_rank(r public.member_role)
returns int language sql immutable set search_path = '' as $$
  select case r when 'admin' then 3 when 'member' then 2 else 1 end
$$;

-- Orgs where the current user is an active member (or the API key's org).
create or replace function app.current_org_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case
    when app.current_api_key_id() is not null then
      coalesce((select array[k.org_id] from public.api_keys k where k.id = app.current_api_key_id() and k.revoked_at is null), '{}')
    else coalesce((
      select array_agg(m.org_id) from public.memberships m
      join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid() and m.status = 'active' and o.status <> 'suspended'), '{}')
  end
$$;

create or replace function app.is_member_of(p_org_id uuid, p_min_role public.member_role default 'readonly')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
      and app.role_rank(m.role) >= app.role_rank(p_min_role))
$$;

-- Effective capability: approved orgs have their types; pending orgs act as owners (SPEC §2.2); suspended: nothing.
create or replace function app.has_org_type(p_org_id uuid, p_type public.org_type)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = p_org_id and o.status <> 'suspended' and (
    (o.status = 'approved' and p_type = any (o.types))
    or (p_type = 'owner' and ('owner' = any (o.types) or o.status = 'pending'))))
$$;

-- True if any of the current user's orgs has the type.
create or replace function app.acts_as(p_type public.org_type)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(app.current_org_ids()) x(id) where app.has_org_type(x.id, p_type))
$$;

create or replace function app.operator_role_rank(r public.operator_role)
returns int language sql immutable set search_path = '' as $$
  select case r when 'superadmin' then 3 when 'verifier' then 2 else 1 end
$$;

-- Operator check. p_min_role null = any operator role (support included).
create or replace function app.is_operator(p_min_role public.operator_role default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.operator_roles r where r.user_id = auth.uid()
    and (p_min_role is null or app.operator_role_rank(r.role) >= app.operator_role_rank(p_min_role)))
$$;

create or replace function app.is_verified_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.identity_verified_at is not null and p.deleted_at is null)
$$;

create or replace function app.require_scope(p_scope text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if app.current_api_key_id() is null then return; end if;
  if not exists (select 1 from public.api_keys k where k.id = app.current_api_key_id() and p_scope = any (k.scopes)) then
    perform app.raise('FORBIDDEN', jsonb_build_object('missing_scope', p_scope));
  end if;
end $$;

-- Resolves and authorises the acting organisation for a write (or a privileged read).
-- API keys act for their org; users must be active members with at least p_min_role, identity-verified for writes
-- (SPEC §2.5) and – outside DEMO_MODE – have MFA (aal2) in financier/authority/operator orgs (SPEC §11.1).
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
    if o.status = 'suspended' then perform app.raise('ORG_NOT_APPROVED', jsonb_build_object('status', o.status)); end if;
    return k.org_id;
  end if;
  if uid is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_org_id is null then perform app.raise('ORG_REQUIRED'); end if;
  select * into o from public.organizations where id = p_org_id;
  if o.id is null or not app.is_member_of(p_org_id, p_min_role) then perform app.raise('FORBIDDEN'); end if;
  if o.status = 'suspended' then perform app.raise('ORG_NOT_APPROVED', jsonb_build_object('status', o.status)); end if;
  if p_need_verified and not app.is_verified_user() then perform app.raise('IDENTITY_NOT_VERIFIED'); end if;
  if p_need_verified and not app.is_demo_mode() and o.status = 'approved'
     and o.types && array['financier', 'authority', 'operator']::public.org_type[]
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    perform app.raise('MFA_REQUIRED');
  end if;
  return p_org_id;
end $$;

-- Operator actions run in the operator organisation's name.
create or replace function app.operator_org_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.organizations where 'operator' = any (types) and status = 'approved' order by created_at limit 1
$$;

create or replace function app.require_operator(p_min_role public.operator_role default 'verifier')
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if not app.is_operator(p_min_role) then perform app.raise('FORBIDDEN'); end if;
  if not app.is_verified_user() then perform app.raise('IDENTITY_NOT_VERIFIED'); end if;
  return app.operator_org_id();
end $$;

-- Org number helpers (SPEC §11.7)
create or replace function app.org_number_hash(p_org_number text)
returns text language sql stable security definer set search_path = '' as $$
  select case when app.normalize_org_number(p_org_number) is null then null
    else app.sha256_hex(app.secret('org_number_key') || ':' || app.normalize_org_number(p_org_number)) end
$$;

-- What the current viewer may see of an organisation's number.
create or replace function app.org_number_display(p_org_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations;
begin
  select * into o from public.organizations where id = p_org_id;
  if o.id is null then return null; end if;
  if not o.is_sole_trader then return o.org_number; end if;
  if app.is_operator('superadmin') or app.acts_as('authority') then
    return extensions.pgp_sym_decrypt(o.org_number_enc, app.secret('org_number_key'));
  end if;
  return '19XXXXXX-XXXX';
end $$;

create or replace function app.org_brief(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'org_number', app.org_number_display(o.id),
    'is_sole_trader', o.is_sole_trader, 'types', o.types, 'status', o.status, 'city', o.city)
  from public.organizations o where o.id = p_org_id
$$;

-- ---------- Notifications, e-mail, webhooks ----------
create or replace function app.default_email(p_severity public.notification_severity)
returns boolean language sql immutable set search_path = '' as $$ select p_severity in ('warning', 'critical') $$;

-- Notifies one user: in-app always; e-mail per preferences (default: warning + critical).
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
                     else p_type = any (pref.event_types) end;
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

-- Notifies all active members of an org (optionally only admins).
create or replace function app.notify_org(
  p_org_id uuid, p_type text, p_data jsonb, p_link text,
  p_severity public.notification_severity default 'info', p_min_role public.member_role default 'readonly')
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if p_org_id is null then return; end if;
  for m in select user_id from public.memberships
           where org_id = p_org_id and status = 'active' and user_id is not null
             and app.role_rank(role) >= app.role_rank(p_min_role) loop
    perform app.notify_user(m.user_id, p_org_id, p_type, p_data, p_link, p_severity);
  end loop;
end $$;

create or replace function app.notify_operators(p_type text, p_data jsonb, p_link text,
  p_severity public.notification_severity default 'info', p_min_role public.operator_role default 'verifier')
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select user_id from public.operator_roles where app.operator_role_rank(role) >= app.operator_role_rank(p_min_role) loop
    perform app.notify_user(r.user_id, app.operator_org_id(), p_type, p_data, p_link, p_severity);
  end loop;
end $$;

-- Queues webhook deliveries for an org's active webhooks subscribed to the event type (SPEC §12).
create or replace function app.enqueue_webhook(p_org_id uuid, p_event_type text, p_machine_id uuid, p_data jsonb, p_event_id uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare w record; n int := 0; payload jsonb; mreg text;
begin
  if p_org_id is null then return 0; end if;
  if to_regclass('public.machines') is not null and p_machine_id is not null then
    execute 'select reg_number from public.machines where id = $1' into mreg using p_machine_id;
  end if;
  for w in select * from public.webhooks where org_id = p_org_id and active
           and (cardinality(event_types) = 0 or p_event_type = any (event_types)) loop
    payload := jsonb_build_object('id', gen_random_uuid(), 'type', p_event_type, 'created_at', app.iso_ts(now()),
      'machine', case when p_machine_id is null then null else jsonb_build_object('id', p_machine_id, 'reg_number', mreg) end,
      'data', coalesce(p_data, '{}'));
    insert into public.webhook_deliveries (webhook_id, event_id, event_type, payload) values (w.id, p_event_id, p_event_type, payload);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Auth hook: profile for every new auth user ----------
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, full_name, locale)
  values (new.id, lower(new.email), nullif(new.raw_user_meta_data ->> 'full_name', ''),
          case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'sv' end)
  on conflict (user_id) do update set email = excluded.email;
  -- Pending invitations to this e-mail become visible in the user's inbox.
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- ---------- Demo company register (mock CompanyLookup) ----------
create table app.mock_companies (
  org_number text primary key,
  name       text not null,
  city       text,
  address    jsonb,
  is_sole_trader boolean not null default false
);
revoke all on app.mock_companies from public, anon, authenticated, service_role;

create or replace function app.mock_company_lookup(p_org_number text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare n text := app.normalize_org_number(p_org_number); c app.mock_companies;
  cities text[] := array['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Umeå', 'Luleå', 'Örebro', 'Linköping', 'Västerås', 'Jönköping'];
  city text;
begin
  if n is null then return null; end if;
  select * into c from app.mock_companies where org_number = n;
  if c.org_number is not null then
    return jsonb_build_object('name', c.name, 'city', c.city, 'address', coalesce(c.address, jsonb_build_object('city', c.city)),
      'is_sole_trader', c.is_sole_trader, 'source', 'mock');
  end if;
  city := cities[(substr(n, 10, 1)::int % 10) + 1];
  if app.is_sole_trader_number(n) then
    return jsonb_build_object('name', 'Enskild firma ' || substr(n, 8, 3), 'city', city,
      'address', jsonb_build_object('city', city), 'is_sole_trader', true, 'source', 'mock');
  end if;
  return jsonb_build_object('name', 'Demoföretag ' || substr(n, 1, 6) || ' AB', 'city', city,
    'address', jsonb_build_object('street', 'Industrivägen ' || substr(n, 9, 2), 'postal_code', substr(n, 1, 3) || ' ' || substr(n, 4, 2), 'city', city),
    'is_sole_trader', false, 'source', 'mock');
end $$;

-- ---------- RLS ----------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.operator_roles enable row level security;
alter table public.company_lookups enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.email_outbox enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_requests enable row level security;
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;

-- Column-level privileges: secrets and personal data never leave the database through direct reads.
revoke all on public.organizations, public.profiles, public.memberships, public.operator_roles, public.company_lookups,
  public.notifications, public.notification_preferences, public.email_outbox, public.api_keys, public.api_requests,
  public.webhooks, public.webhook_deliveries from anon, authenticated;
grant select (id, slug, types, name, org_number, is_sole_trader, country, vat_number, address, city, email, phone, website,
  status, approved_at, parent_org_id, created_at, updated_at) on public.organizations to authenticated;
grant select (user_id, full_name, email, phone, locale, identity_verified_at, identity_provider, last_active_org_id, created_at)
  on public.profiles to authenticated;
grant select (id, org_id, user_id, role, status, invited_by, invite_email, invite_expires_at, accepted_at, created_at)
  on public.memberships to authenticated;
grant select on public.operator_roles, public.notifications, public.notification_preferences to authenticated;
grant select (id, org_id, name, key_prefix, scopes, rate_limit_per_min, sandbox, last_used_at, created_by, revoked_at, created_at)
  on public.api_keys to authenticated;
grant select on public.api_requests to authenticated;
grant select (id, org_id, url, event_types, active, created_by, created_at) on public.webhooks to authenticated;
grant select on public.webhook_deliveries to authenticated;

-- organizations: own, operator/authority all, searchable approved partners (SPEC §11.2). Counterparties are added
-- in the encumbrances/transfers migration.
create policy organizations_read on public.organizations for select to authenticated using (
  id = any (app.current_org_ids())
  or app.is_operator()
  or app.acts_as('authority')
  or (status = 'approved' and types && array['financier', 'dealer', 'inspector', 'insurer', 'manufacturer']::public.org_type[])
);

create policy profiles_read on public.profiles for select to authenticated using (
  user_id = auth.uid()
  or app.is_operator()
  or exists (select 1 from public.memberships m where m.user_id = profiles.user_id and m.status = 'active'
             and m.org_id = any (app.current_org_ids()))
);

create policy memberships_read on public.memberships for select to authenticated using (
  user_id = auth.uid() or org_id = any (app.current_org_ids()) or app.is_operator()
);

create policy operator_roles_read on public.operator_roles for select to authenticated using (
  user_id = auth.uid() or app.is_operator()
);

create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_read on public.notification_preferences for select to authenticated using (user_id = auth.uid());

create policy api_keys_read on public.api_keys for select to authenticated using (
  app.is_member_of(org_id, 'admin') or app.is_operator()
);
create policy api_requests_read on public.api_requests for select to authenticated using (
  (org_id is not null and app.is_member_of(org_id, 'admin')) or app.is_operator()
);
create policy webhooks_read on public.webhooks for select to authenticated using (app.is_member_of(org_id, 'admin') or app.is_operator('superadmin'));
create policy webhook_deliveries_read on public.webhook_deliveries for select to authenticated using (
  exists (select 1 from public.webhooks w where w.id = webhook_id and (app.is_member_of(w.org_id, 'admin') or app.is_operator('superadmin')))
);
-- company_lookups, email_outbox: no client policies (service role / RPC only).

-- ---------- RPC: context ----------
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.profiles;
begin
  if uid is null then return null; end if;
  select * into p from public.profiles where user_id = uid;
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
      select jsonb_agg(jsonb_build_object('membership_id', m.id, 'role', m.role, 'org', app.org_brief(o.id),
        'effective_types', (select coalesce(jsonb_agg(t), '[]') from unnest(enum_range(null::public.org_type)) t where app.has_org_type(o.id, t)),
        'min_trusted_level', coalesce((o.settings ->> 'min_trusted_level')::int, 0))
        order by o.name)
      from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = uid and m.status = 'active'), '[]'::jsonb),
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object('membership_id', m.id, 'org', app.org_brief(m.org_id), 'role', m.role))
      from public.memberships m where m.status = 'invited' and lower(m.invite_email) = p.email
        and (m.invite_expires_at is null or m.invite_expires_at > now())), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.notifications where user_id = uid and read_at is null),
    'demo_mode', app.is_demo_mode()
  );
end $$;

create or replace function public.update_profile(p_full_name text default null, p_phone text default null, p_locale text default null,
  p_last_active_org_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_locale is not null and p_locale not in ('sv', 'en') then perform app.raise('VALIDATION', '{"field":"locale"}'); end if;
  if p_last_active_org_id is not null and not app.is_member_of(p_last_active_org_id) then perform app.raise('FORBIDDEN'); end if;
  update public.profiles set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone = coalesce(nullif(trim(p_phone), ''), phone),
    locale = coalesce(p_locale, locale),
    last_active_org_id = coalesce(p_last_active_org_id, last_active_org_id)
  where user_id = auth.uid();
  return public.my_context();
end $$;

-- ---------- RPC: identity (SPEC §2.5, §11.1) ----------
-- Records a completed identity verification. Called by Edge Function bankid-identify (service role) with the
-- personal number from the BankID broker; only a salted hash is stored (rule 6).
create or replace function public.record_identity_verification(p_user_id uuid, p_personal_number text, p_provider text, p_evidence jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; other uuid;
begin
  if p_provider not in ('bankid', 'mock') then perform app.raise('VALIDATION', '{"field":"provider"}'); end if;
  if p_provider = 'mock' and not app.is_demo_mode() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  h := app.sha256_hex(app.secret('personal_number_salt') || ':' || regexp_replace(coalesce(p_personal_number, ''), '\D', '', 'g'));
  select user_id into other from public.profiles where personal_number_hash = h and user_id <> p_user_id;
  if other is not null then
    -- The same person already has an account: do not link silently (account takeover risk).
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

-- DEMO_MODE only: "Demo-BankID". Generates a fake personal number per user so the hash is stable.
create or replace function public.verify_identity(p_provider text default 'mock')
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_provider <> 'mock' then perform app.raise('USE_BANKID_FLOW'); end if;
  if not app.is_demo_mode() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  return public.record_identity_verification(auth.uid(), 'demo-' || auth.uid()::text, 'mock',
    jsonb_build_object('demo', true, 'at', app.iso_ts(now())));
end $$;

-- Owner-only orgs are approved as soon as an identity-verified admin exists and the org number has been looked up.
create or replace function app.auto_approve_orgs_for(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  for o in select org.* from public.organizations org
           join public.memberships m on m.org_id = org.id and m.user_id = p_user_id and m.status = 'active' and m.role = 'admin'
           where org.status = 'pending' and org.types = array['owner']::public.org_type[] and org.lookup_source is not null loop
    update public.organizations set status = 'approved', approved_at = now() where id = o.id;
    perform app.log_event('org.approved', null, o.id, o.id, jsonb_build_object('auto', true));
  end loop;
end $$;

-- ---------- RPC: company lookup (SPEC §6.1) ----------
-- Stores a lookup result. Called by Edge Function company-lookup (service role) after querying Roaring/Bolagsverket.
create or replace function public.record_company_lookup(p_org_number text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text := app.org_number_hash(p_org_number);
begin
  if h is null then perform app.raise('VALIDATION', '{"field":"org_number"}'); end if;
  insert into public.company_lookups (org_number_hash, name, address, city, is_sole_trader, source, data)
  values (h, p_result ->> 'name', p_result -> 'address', p_result ->> 'city', coalesce((p_result ->> 'is_sole_trader')::boolean, false),
          coalesce(p_result ->> 'source', 'unknown'), p_result - 'personal_number')
  on conflict (org_number_hash) do update set name = excluded.name, address = excluded.address, city = excluded.city,
    is_sole_trader = excluded.is_sole_trader, source = excluded.source, data = excluded.data, looked_up_at = now();
  return p_result;
end $$;

-- Client-facing lookup. DEMO_MODE: mock register in the database. Otherwise the cached result from company-lookup
-- (the client calls the Edge Function first). Also tells whether the org already exists in the register.
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
    'existing_org', case when existing.id is null then null else app.org_brief(existing.id) end);
end $$;

-- ---------- RPC: organisations ----------
create or replace function app.unique_slug(p_name text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare base text := left(nullif(app.slugify(p_name), ''), 48); s text; i int := 1;
begin
  if base is null then base := 'org'; end if;
  s := base;
  while exists (select 1 from public.organizations where slug = s) loop
    i := i + 1; s := base || '-' || i;
  end loop;
  return s;
end $$;

create or replace function public.create_org(
  p_org_number text, p_types public.org_type[], p_name text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_country text default 'SE', p_address jsonb default null, p_accept_dpa_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n text; h text; lk public.company_lookups; o public.organizations; sole boolean; name_ text; st public.org_status;
  types_ public.org_type[];
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
    if exists (select 1 from public.organizations where org_number_hash = h) then
      perform app.raise('ORG_EXISTS', jsonb_build_object('org', app.org_brief((select id from public.organizations where org_number_hash = h))));
    end if;
    if app.is_demo_mode() then perform public.lookup_company(n); end if;
    select * into lk from public.company_lookups where org_number_hash = h;
    sole := coalesce(lk.is_sole_trader, app.is_sole_trader_number(n));
    name_ := coalesce(lk.name, nullif(trim(p_name), ''));
  else
    -- Foreign organisations: manual approval by the operator (SPEC §11.1).
    n := nullif(trim(p_org_number), '');
    h := case when n is null then null else app.sha256_hex(app.secret('org_number_key') || ':' || upper(p_country) || ':' || n) end;
    sole := false;
    name_ := nullif(trim(p_name), '');
  end if;
  if name_ is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  st := case when types_ = array['owner']::public.org_type[] and lk.org_number_hash is not null and coalesce(p_country, 'SE') = 'SE'
             then 'approved' else 'pending' end;
  insert into public.organizations (slug, types, name, org_number, org_number_hash, org_number_enc, is_sole_trader, country,
    address, city, email, phone, website, status, approved_at, lookup_source, lookup_at, dpa_accepted_at, dpa_version, created_by)
  values (app.unique_slug(name_), types_, name_,
    case when sole or coalesce(p_country, 'SE') <> 'SE' then null else n end, h,
    case when sole then extensions.pgp_sym_encrypt(n, app.secret('org_number_key')) else null end,
    sole, upper(coalesce(p_country, 'SE')), coalesce(lk.address, p_address), coalesce(lk.city, p_address ->> 'city'),
    nullif(trim(p_email), ''), nullif(trim(p_phone), ''), nullif(trim(p_website), ''), st,
    case when st = 'approved' then now() end, lk.source, lk.looked_up_at, now(), p_accept_dpa_version, uid)
  returning * into o;
  insert into public.memberships (org_id, user_id, role, status, accepted_at) values (o.id, uid, 'admin', 'active', now());
  update public.profiles set last_active_org_id = o.id where user_id = uid;
  perform app.log_event('org.created', null, o.id, o.id,
    jsonb_build_object('types', types_, 'status', st, 'sole_trader', sole, 'dpa_version', p_accept_dpa_version));
  if st = 'pending' then
    perform app.notify_operators('org.pending_approval', jsonb_build_object('org_id', o.id, 'name', o.name, 'types', types_),
      '/admin/organizations', 'info');
  end if;
  return app.org_brief(o.id) || jsonb_build_object('status', o.status);
end $$;

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
                 'partner_verification', 'public_inspection_badge', 'digest_day') then
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

create or replace function public.get_org(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if not (app.is_member_of(p_org_id) or app.is_operator()) then perform app.raise('FORBIDDEN'); end if;
  select * into o from public.organizations where id = p_org_id;
  return app.org_brief(o.id) || jsonb_build_object('email', o.email, 'phone', o.phone, 'website', o.website, 'address', o.address,
    'vat_number', o.vat_number, 'country', o.country, 'settings', o.settings, 'approved_at', o.approved_at,
    'lookup_source', o.lookup_source, 'created_at', o.created_at, 'dpa_version', o.dpa_version,
    'parent_org_id', o.parent_org_id);
end $$;

-- Search for counterparties: approved financiers/dealers/inspectors/insurers by name (+city), or any org by exact org
-- number. Sole traders are found by name + city, never by personal number (SPEC §11.7).
create or replace function public.search_orgs(p_query text, p_type public.org_type default null, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := trim(coalesce(p_query, '')); n text := app.normalize_org_number(p_query);
begin
  if auth.uid() is null and app.current_api_key_id() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if n is not null and not app.is_sole_trader_number(n) then
    return coalesce((select jsonb_agg(app.org_brief(o.id)) from public.organizations o
      where o.org_number = n and o.status <> 'suspended' and (p_type is null or p_type = any (o.types))), '[]'::jsonb);
  end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(app.org_brief(x.id)) from (
    select o.id from public.organizations o
    where o.status = 'approved' and o.types && array['financier', 'dealer', 'inspector', 'insurer', 'manufacturer', 'owner', 'client']::public.org_type[]
      and (p_type is null or p_type = any (o.types))
      and (o.name ilike '%' || q || '%' or (o.city || ' ' || o.name) ilike '%' || q || '%')
    order by extensions.similarity(o.name, q) desc, o.name
    limit least(greatest(p_limit, 1), 50)) x), '[]'::jsonb);
end $$;

-- ---------- RPC: members & invitations (SPEC §6.1 step 4) ----------
create or replace function public.invite_member(p_org_id uuid, p_email text, p_role public.member_role default 'member')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_org uuid := app.require_actor(p_org_id, 'admin');
  e text := lower(trim(p_email)); token text := encode(extensions.gen_random_bytes(24), 'hex'); m public.memberships;
  existing_user uuid; org_name text;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform app.raise('VALIDATION', '{"field":"email"}'); end if;
  select user_id into existing_user from public.profiles where email = e;
  if existing_user is not null and exists (select 1 from public.memberships where org_id = p_org_id and user_id = existing_user and status = 'active') then
    perform app.raise('MEMBER_EXISTS');
  end if;
  delete from public.memberships where org_id = p_org_id and status = 'invited' and lower(invite_email) = e;
  insert into public.memberships (org_id, role, status, invited_by, invite_token_hash, invite_email, invite_expires_at)
  values (p_org_id, p_role, 'invited', auth.uid(), app.sha256_hex(token), e, now() + interval '14 days')
  returning * into m;
  select name into org_name from public.organizations where id = p_org_id;
  insert into public.email_outbox (to_email, org_id, template, locale, data)
  values (e, p_org_id, 'invite', coalesce((select locale from public.profiles where user_id = auth.uid()), 'sv'),
          jsonb_build_object('org_name', org_name, 'token', token, 'role', p_role,
            'inviter', (select full_name from public.profiles where user_id = auth.uid())));
  if existing_user is not null then
    perform app.notify_user(existing_user, p_org_id, 'member.invited', jsonb_build_object('org_name', org_name, 'membership_id', m.id), '/inbox', 'info');
  end if;
  perform app.log_event('member.invited', null, actor_org, actor_org, jsonb_build_object('membership_id', m.id, 'role', p_role));
  return jsonb_build_object('membership_id', m.id, 'token', token, 'expires_at', m.invite_expires_at);
end $$;

-- Accepts an invitation by token (link in the e-mail) or by membership id (pending invite shown in the inbox).
-- The invitation's e-mail must match the signed-in user's e-mail.
create or replace function public.accept_invite(p_token text default null, p_membership_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.memberships; me public.profiles;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  select * into me from public.profiles where user_id = auth.uid();
  if p_token is not null then
    select * into m from public.memberships where invite_token_hash = app.sha256_hex(p_token) and status = 'invited';
  else
    select * into m from public.memberships where id = p_membership_id and status = 'invited';
  end if;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if m.invite_expires_at is not null and m.invite_expires_at < now() then perform app.raise('INVITE_EXPIRED'); end if;
  if lower(m.invite_email) <> me.email then perform app.raise('INVITE_EMAIL_MISMATCH'); end if;
  if exists (select 1 from public.memberships where org_id = m.org_id and user_id = auth.uid() and status = 'active') then
    delete from public.memberships where id = m.id;
    return app.org_brief(m.org_id);
  end if;
  delete from public.memberships where org_id = m.org_id and user_id = auth.uid() and status = 'removed';
  update public.memberships set user_id = auth.uid(), status = 'active', accepted_at = now(), invite_token_hash = null where id = m.id;
  perform app.log_event('member.joined', null, m.org_id, m.org_id, jsonb_build_object('membership_id', m.id, 'role', m.role));
  perform app.notify_org(m.org_id, 'member.joined', jsonb_build_object('name', coalesce(me.full_name, me.email)), '/settings/members', 'info', 'admin');
  return app.org_brief(m.org_id);
end $$;

-- Orgs whose members share the user's e-mail domain (SPEC §6.1: "Inbjudna med @samma-domän föreslås").
create or replace function public.suggested_orgs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare dom text;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select split_part(email, '@', 2) into dom from public.profiles where user_id = auth.uid();
  if dom is null or dom in ('gmail.com', 'hotmail.com', 'outlook.com', 'live.se', 'hotmail.se', 'yahoo.com', 'icloud.com', 'telia.com', 'me.com') then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(distinct app.org_brief(m.org_id)) from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.status = 'active' and split_part(p.email, '@', 2) = dom
      and m.org_id <> all (app.current_org_ids())), '[]'::jsonb);
end $$;

create or replace function public.request_membership(p_org_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  select * into me from public.profiles where user_id = auth.uid();
  perform app.notify_org(p_org_id, 'member.access_requested',
    jsonb_build_object('name', coalesce(me.full_name, me.email), 'email', me.email, 'message', left(p_message, 500)),
    '/settings/members', 'info', 'admin');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_org_members(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_member_of(p_org_id) or app.is_operator()) then perform app.raise('FORBIDDEN'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('membership_id', m.id, 'user_id', m.user_id, 'role', m.role, 'status', m.status,
      'full_name', p.full_name, 'email', coalesce(p.email, m.invite_email), 'identity_verified', p.identity_verified_at is not null,
      'invite_expires_at', m.invite_expires_at, 'created_at', m.created_at) order by m.status, p.full_name)
    from public.memberships m left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org_id and m.status <> 'removed'), '[]'::jsonb);
end $$;

create or replace function public.set_member_role(p_membership_id uuid, p_role public.member_role)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_membership_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.require_actor(m.org_id, 'admin');
  if m.role = 'admin' and p_role <> 'admin' and (select count(*) from public.memberships
      where org_id = m.org_id and role = 'admin' and status = 'active') <= 1 then
    perform app.raise('LAST_ADMIN');
  end if;
  update public.memberships set role = p_role where id = m.id;
  perform app.log_event('member.role_changed', null, m.org_id, m.org_id, jsonb_build_object('membership_id', m.id, 'role', p_role));
  return public.list_org_members(m.org_id);
end $$;

create or replace function public.remove_member(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_membership_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if m.user_id is distinct from auth.uid() then perform app.require_actor(m.org_id, 'admin'); end if;
  if m.role = 'admin' and m.status = 'active' and (select count(*) from public.memberships
      where org_id = m.org_id and role = 'admin' and status = 'active') <= 1 then
    perform app.raise('LAST_ADMIN');
  end if;
  if m.status = 'invited' then
    delete from public.memberships where id = m.id;
  else
    update public.memberships set status = 'removed', removed_at = now() where id = m.id;
  end if;
  perform app.log_event('member.removed', null, m.org_id, m.org_id, jsonb_build_object('membership_id', m.id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- RPC: operator approval (SPEC §2.2) ----------
create or replace function public.approve_org(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); o public.organizations;
begin
  update public.organizations set status = 'approved', approved_by = auth.uid(), approved_at = now(), suspended_reason = null
  where id = p_org_id and status <> 'approved' returning * into o;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('org.approved', null, o.id, op, jsonb_build_object('types', o.types));
  perform app.notify_org(o.id, 'org.approved', jsonb_build_object('name', o.name), '/dashboard', 'info');
  return app.org_brief(o.id);
end $$;

create or replace function public.suspend_org(p_org_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin'); o public.organizations;
begin
  if nullif(trim(p_reason), '') is null then perform app.raise('VALIDATION', '{"field":"reason"}'); end if;
  update public.organizations set status = 'suspended', suspended_reason = p_reason where id = p_org_id and 'operator' <> all (types)
  returning * into o;
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('org.suspended', null, o.id, op, jsonb_build_object('reason', p_reason));
  perform app.notify_org(o.id, 'org.suspended', jsonb_build_object('name', o.name, 'reason', p_reason), '/settings', 'critical', 'admin');
  return app.org_brief(o.id);
end $$;

-- ---------- RPC: notifications ----------
create or replace function public.list_notifications(p_limit int default 50, p_before timestamptz default null, p_unread_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  return coalesce((select jsonb_agg(to_jsonb(n) - 'user_id' order by n.created_at desc) from (
    select * from public.notifications where user_id = auth.uid()
      and (p_before is null or created_at < p_before) and (not p_unread_only or read_at is null)
    order by created_at desc limit least(greatest(p_limit, 1), 200)) n), '[]'::jsonb);
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.set_notification_preferences(p_org_id uuid, p_channel public.notification_channel,
  p_event_types text[], p_digest public.digest_mode default 'instant', p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_member_of(p_org_id) then perform app.raise('FORBIDDEN'); end if;
  insert into public.notification_preferences (user_id, org_id, channel, event_types, digest, enabled)
  values (auth.uid(), p_org_id, p_channel, coalesce(p_event_types, '{}'), p_digest, p_enabled)
  on conflict (user_id, org_id, channel) do update set event_types = excluded.event_types, digest = excluded.digest, enabled = excluded.enabled;
  return coalesce((select jsonb_agg(to_jsonb(p) - 'user_id') from public.notification_preferences p
    where user_id = auth.uid() and org_id = p_org_id), '[]'::jsonb);
end $$;

-- ---------- Grants ----------
grant execute on function
  app.current_org_ids(), app.is_member_of(uuid, public.member_role), app.has_org_type(uuid, public.org_type),
  app.acts_as(public.org_type), app.is_operator(public.operator_role), app.role_rank(public.member_role),
  app.operator_role_rank(public.operator_role), app.is_verified_user()
  to authenticated, service_role;

grant execute on function
  public.my_context(), public.update_profile(text, text, text, uuid), public.verify_identity(text),
  public.lookup_company(text),
  public.create_org(text, public.org_type[], text, text, text, text, text, jsonb, text),
  public.update_org(uuid, jsonb), public.get_org(uuid), public.search_orgs(text, public.org_type, int),
  public.invite_member(uuid, text, public.member_role), public.accept_invite(text, uuid), public.suggested_orgs(),
  public.request_membership(uuid, text), public.list_org_members(uuid), public.set_member_role(uuid, public.member_role),
  public.remove_member(uuid), public.approve_org(uuid), public.suspend_org(uuid, text),
  public.list_notifications(int, timestamptz, boolean), public.mark_notifications_read(uuid[]),
  public.set_notification_preferences(uuid, public.notification_channel, text[], public.digest_mode, boolean)
  to authenticated;

grant execute on function public.record_identity_verification(uuid, text, text, jsonb), public.record_company_lookup(text, jsonb)
  to service_role;
