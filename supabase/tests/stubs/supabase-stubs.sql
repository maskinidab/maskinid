-- Minimal stand-ins for what a Supabase database provides, so migrations, seed and the RLS/RPC tests can run
-- against a plain PostgreSQL (and PGlite in the browser demo). Mirrors Supabase semantics that matter for
-- security tests: roles anon/authenticated/service_role (service_role bypasses RLS), default privileges that
-- grant table access to API roles (RLS is the barrier), and auth.uid()/auth.role() from request.jwt.claims.
-- NEVER applied to a real Supabase project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to current_user;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
grant usage on schema auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token text default '', recovery_token text default '',
  email_change_token_new text default '', email_change text default '', last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb, is_super_admin boolean,
  phone text, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade, provider_id text,
  provider text, identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade,
  factor_type text, status text, created_at timestamptz default now()
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid,
  metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
grant execute on function storage.foldername(text), storage.filename(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Supabase grants table/sequence/function privileges in public to the API roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
