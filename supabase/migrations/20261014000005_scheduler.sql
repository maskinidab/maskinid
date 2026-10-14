-- Scheduled jobs never ran, on staging or in production (ADR 0034).
--
-- app.schedule_jobs() is a no-op without pg_cron and app.dispatch_http_job() needs pg_net and a cron secret – none
-- of which any environment had. So no e-mail was ever sent, payoff quotes never expired, transfers never timed out
-- and the event chain was never anchored outside tests. Enabled here where the extensions exist (Supabase); plain
-- PostgreSQL in CI and the in-browser database do not have them and are left alone, as before.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      -- pg_cron must be preloaded; where it is offered but not loaded, scheduling stays off rather than failing the migration.
      raise notice 'pg_cron not enabled: %', sqlerrm;
    end;
  end if;
end $$;

-- The secret the scheduler sends to the Edge Functions (x-cron-secret). Created once; the deploy pipeline reads it and
-- sets the same value as the functions' CRON_SECRET, so it never has to pass through a person.
create or replace function app.ensure_cron_secret()
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  insert into app.secrets (name, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (name) do nothing;
  select value into v from app.secrets where name = 'cron_secret';
  return v;
end $$;

revoke all on function app.ensure_cron_secret() from public, anon, authenticated, service_role;
