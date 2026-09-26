-- =====================================================================
-- 0001 extensions, schemas and shared helpers (SPEC §14, CLAUDE.md step 1)
--
-- Schemas:
--   public      tables (RLS, default deny) and the RPC API exposed by PostgREST
--   app         private helpers used by RPCs and RLS policies (not exposed)
--   extensions  pgcrypto, pg_trgm (Supabase convention)
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- Functions are not executable by default: every exposed RPC grants explicitly.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;
-- Clients never write tables directly (CLAUDE.md rule 2): no write privileges for API roles on new tables,
-- on top of RLS without write policies.
alter default privileges in schema public revoke insert, update, delete, truncate on tables from public, anon, authenticated;
alter default privileges in schema public revoke usage, update on sequences from public, anon, authenticated;

-- ---------- Errors ----------
-- Application errors carry a stable code as the message (e.g. FORBIDDEN, ACTIVE_ENCUMBRANCE_EXISTS)
-- and a PostgREST-compatible SQLSTATE (PTxxx maps to the HTTP status). The detail holds JSON.
create or replace function app.raise(p_code text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql volatile set search_path = '' as $$
declare
  st text := case
    when p_code in ('NOT_AUTHENTICATED') then 'PT401'
    when p_code in ('FORBIDDEN', 'IDENTITY_NOT_VERIFIED', 'ORG_NOT_APPROVED', 'MFA_REQUIRED') then 'PT403'
    when p_code in ('NOT_FOUND') then 'PT404'
    when p_code in ('RATE_LIMITED') then 'PT429'
    when p_code like '%_EXISTS' or p_code like '%CONFLICT%' or p_code like 'MACHINE_%' or p_code like 'TRANSFER_%'
      or p_code like 'LABEL_%' or p_code like 'ENCUMBRANCE_%' then 'PT409'
    else 'PT422' end;
begin
  raise exception using errcode = st, message = p_code, detail = p_detail::text;
end $$;

-- ---------- Generic triggers ----------
create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Identifiers (twins of packages/shared) ----------
create or replace function app.normalize_identifier(v text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(v, ''), '[[:space:]-]', '', 'g')), '')
$$;

-- Registration number alphabet: 32 characters without 0/O/1/I (SPEC §5.1).
create or replace function app.reg_alphabet()
returns text language sql immutable set search_path = '' as $$ select '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' $$;

-- Luhn mod N (N = 32) check character.
create or replace function app.reg_check_char(p_payload text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  a text := app.reg_alphabet();
  factor int := 2; s int := 0; addend int; i int; cp int;
begin
  for i in reverse length(p_payload)..1 loop
    cp := strpos(a, substr(p_payload, i, 1)) - 1;
    if cp < 0 then raise exception 'invalid registration character %', substr(p_payload, i, 1); end if;
    addend := factor * cp;
    factor := case when factor = 2 then 1 else 2 end;
    addend := (addend / 32) + (addend % 32);
    s := s + addend;
  end loop;
  return substr(a, ((32 - (s % 32)) % 32) + 1, 1);
end $$;

create or replace function app.normalize_reg_number(v text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(v, ''), '[[:space:]-]', '', 'g'))
$$;

create or replace function app.is_valid_reg_number(v text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare n text := app.normalize_reg_number(v);
begin
  if n !~ '^[2-9A-HJ-NP-Z]{7}$' then return false; end if;
  return app.reg_check_char(left(n, 6)) = right(n, 1);
end $$;

create or replace function app.format_reg_number(v text)
returns text language sql immutable set search_path = '' as $$
  select case when length(v) = 7 then left(v, 3) || '-' || right(v, 4) else v end
$$;

-- Generates a unique-looking registration number where both display groups mix letters and digits.
-- Uniqueness is guaranteed by the unique index on machines.reg_number (callers retry on collision).
create or replace function app.generate_reg_number()
returns text language plpgsql volatile set search_path = '' as $$
declare
  a text := app.reg_alphabet();
  bytes bytea; payload text; reg text; g1 text; g2 text; i int;
begin
  loop
    bytes := extensions.gen_random_bytes(6);
    payload := '';
    for i in 0..5 loop
      payload := payload || substr(a, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    reg := payload || app.reg_check_char(payload);
    g1 := left(reg, 3); g2 := right(reg, 4);
    if g1 ~ '[2-9]' and g1 ~ '[A-Z]' and g2 ~ '[2-9]' and g2 ~ '[A-Z]' then
      return reg;
    end if;
  end loop;
end $$;

-- QR label code: 22 characters base62 (~131 bits) from a CSPRNG (SPEC §5.2).
create or replace function app.generate_label_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  a text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  bytes bytea := extensions.gen_random_bytes(44);
  out text := ''; i int := 0; b int;
begin
  -- rejection sampling on bytes < 248 (= 4 * 62) keeps the distribution uniform
  while length(out) < 22 loop
    if i >= 44 then bytes := extensions.gen_random_bytes(44); i := 0; end if;
    b := get_byte(bytes, i); i := i + 1;
    if b < 248 then out := out || substr(a, (b % 62) + 1, 1); end if;
  end loop;
  return out;
end $$;

create or replace function app.mask_serial(v text, visible int default 3)
returns text language sql immutable set search_path = '' as $$
  select case when v is null then null
              when length(v) <= visible then repeat('•', length(v))
              else repeat('•', greatest(3, length(v) - visible)) || right(v, visible) end
$$;

-- Swedish org number NNNNNN-NNNN (accepts 10 or 12 digits).
create or replace function app.normalize_org_number(v text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(v, ''), '\D', '', 'g');
begin
  if length(d) = 12 then d := substr(d, 3); end if;
  if length(d) <> 10 then return null; end if;
  return substr(d, 1, 6) || '-' || substr(d, 7);
end $$;

create or replace function app.is_sole_trader_number(v text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(substr(app.normalize_org_number(v), 3, 2)::int between 1 and 12, false)
$$;

create or replace function app.sha256_hex(v text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(v, ''), 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function app.iso_ts(t timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- ---------- Configuration & feature flags (SPEC §14) ----------
create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  is_public   boolean not null default true,
  description text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke insert, update, delete, truncate on public.app_config from public, anon, authenticated;
create policy app_config_public_read on public.app_config for select to anon, authenticated using (is_public);

insert into public.app_config (key, value, description) values
  ('DEMO_MODE',          'true',  'Mock adapters everywhere and a visible DEMO banner'),
  ('FEATURE_MARKET',     'true',  'Market surveillance (SPEC §8)'),
  ('FEATURE_VALUATION',  'false', 'Market value index (SPEC §7.7)'),
  ('FEATURE_SMS',        'false', 'SMS for critical notifications'),
  ('FEATURE_NFC',        'false', 'NFC labels (SPEC §7.8)'),
  ('FEATURE_PAYMENTS',   'false', 'Stripe payments (test mode)'),
  ('FEATURE_TELEMATICS', 'false', 'Telematics integrations (SPEC §7.8)'),
  ('FEATURE_THEFT_SYNC', 'false', 'Theft register sync (Larmtjänst adapter)'),
  ('FEATURE_PUSH',       'false', 'Web push notifications')
on conflict (key) do nothing;

create or replace function app.flag(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_config where key = p_key), false)
$$;

create or replace function app.is_demo_mode()
returns boolean language sql stable security definer set search_path = '' as $$ select app.flag('DEMO_MODE') $$;

create or replace function app.config_text(p_key text, p_default text default null)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.app_config where key = p_key), p_default)
$$;

grant execute on function app.flag(text), app.is_demo_mode(), app.normalize_identifier(text),
  app.normalize_reg_number(text), app.is_valid_reg_number(text), app.format_reg_number(text),
  app.mask_serial(text, int), app.reg_check_char(text), app.reg_alphabet() to anon, authenticated, service_role;

-- Public RPC: feature flags for the client.
create or replace function public.get_app_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.app_config where is_public
$$;
grant execute on function public.get_app_config() to anon, authenticated;
