-- Step 27: "Visa som organisation" is strictly read-only (ADR 0024).
-- View-as grants the operator the org's readonly role, and a few RPCs let readonly members write (support tickets and
-- their messages). The e2e suite showed an operator could create a ticket in the org's name while viewing it.
-- Fix: require_actor marks the transaction when access comes from a view-as session only, and triggers on every table
-- such an RPC could write refuse the write. Reads (including their access logging) keep working.

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
  -- Access without an active membership can only come from a view-as session: remember that for the write guards.
  perform set_config('app.view_as_uid', case when exists (select 1 from public.memberships m where m.org_id = p_org_id and m.user_id = uid
    and m.status = 'active') then '' else uid::text end, true);
  if o.status = 'suspended' then perform app.raise('ORG_NOT_APPROVED', jsonb_build_object('status', o.status)); end if;
  if p_need_verified and not app.is_verified_user() then perform app.raise('IDENTITY_NOT_VERIFIED'); end if;
  if p_need_verified and not app.is_demo_mode() and o.status = 'approved'
     and o.types && array['financier', 'authority', 'operator']::public.org_type[]
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    perform app.raise('MFA_REQUIRED');
  end if;
  return p_org_id;
end $$;

create or replace function app.deny_view_as_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and current_setting('app.view_as_uid', true) = auth.uid()::text then
    perform app.raise('VIEW_AS_READ_ONLY');
  end if;
  return coalesce(new, old);
end $$;
revoke all on function app.deny_view_as_write() from public, anon, authenticated;

-- events covers every register write (each one logs an event); the support tables are the readonly-role writes.
create trigger events_view_as_read_only before insert on public.events
  for each row execute function app.deny_view_as_write();
create trigger support_tickets_view_as_read_only before insert or update on public.support_tickets
  for each row execute function app.deny_view_as_write();
create trigger support_messages_view_as_read_only before insert on public.support_messages
  for each row execute function app.deny_view_as_write();

select app.grant_api_access();
