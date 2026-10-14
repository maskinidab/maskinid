-- A history request must not tell the requester who owns the machine (ADR 0032, follow-up).
--
-- lookup_machine withholds the owner's name from an account without a relation. request_mandate, list_mandates,
-- the decline notification and a principal-side revoke all handed it back, so "request, then read Fullmakter"
-- answered the question the lookup refuses to. Until the owner approves, the requester sees "the machine's owner".
-- A fleet request is not affected: the requester typed the company's organisation number to make it.

create or replace function app.mandate_hides_principal(d public.mandates)
returns boolean language sql immutable set search_path = '' as $$
  select d.requested_by = 'agent' and d.machine_id is not null and d.principal_signature_id is null
$$;

-- What the agent may see of a mandate row.
create or replace function app.mandate_for_agent(d public.mandates)
returns jsonb language sql stable set search_path = '' as $$
  select case when app.mandate_hides_principal(d) then to_jsonb(d) - 'principal_org_id' else to_jsonb(d) end
$$;

create or replace function public.request_mandate(p_org_id uuid, p_principal_org_id uuid, p_machine_id uuid default null,
  p_scopes text[] default array['view'], p_valid_to date default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates; m public.machines;
  scopes text[]; valid_to date := coalesce(p_valid_to, current_date + 90); principal uuid := p_principal_org_id;
begin
  scopes := (select array_agg(distinct s order by s) from unnest(p_scopes) s);
  if not (scopes <@ array['view', 'fleet']) then perform app.raise('VALIDATION', '{"field":"scopes"}'); end if;
  if p_machine_id is not null then
    select * into m from public.machines where id = p_machine_id;
    if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
    principal := coalesce(principal, m.owner_org_id);
    if principal <> m.owner_org_id then perform app.raise('VALIDATION', '{"field":"principal_org_id"}'); end if;
  end if;
  if principal is null then perform app.raise('VALIDATION', '{"field":"principal_org_id"}'); end if;
  if principal = actor then perform app.raise('VALIDATION', '{"field":"principal_org_id","reason":"own_org"}'); end if;
  if not exists (select 1 from public.organizations where id = principal and status <> 'suspended') then
    perform app.raise('VALIDATION', '{"field":"principal_org_id"}');
  end if;
  if p_machine_id is not null and app.has_mandate(p_machine_id, actor, 'view') then
    perform app.raise('MANDATE_ALREADY_ACTIVE');
  end if;
  if exists (select 1 from public.mandates where principal_org_id = principal and agent_org_id = actor
             and machine_id is not distinct from p_machine_id and status in ('requested', 'pending', 'active')) then
    perform app.raise('MANDATE_ALREADY_OPEN');
  end if;
  insert into public.mandates (kind, principal_org_id, agent_org_id, machine_id, scopes, valid_to, status,
    requested_by, request_message, created_by)
  values ('power_of_attorney', principal, actor, p_machine_id, scopes, valid_to, 'requested',
    'agent', nullif(trim(p_message), ''), auth.uid())
  returning * into d;
  perform app.log_event('mandate.requested', p_machine_id, principal, actor,
    jsonb_build_object('mandate_id', d.id, 'scopes', d.scopes, 'valid_to', d.valid_to, 'fleet_wide', p_machine_id is null));
  perform app.notify_org(principal, 'mandate.requested',
    jsonb_build_object('mandate_id', d.id, 'agent', (select name from public.organizations where id = actor),
      'reg_number', m.reg_number, 'fleet_wide', p_machine_id is null), '/inbox', 'warning', 'admin');
  return jsonb_build_object('ok', true, 'mandate', app.mandate_for_agent(d));
exception when check_violation or unique_violation then
  perform app.raise('VALIDATION', '{"field":"mandate"}');
end $$;

create or replace function public.decide_mandate_request(p_org_id uuid, p_mandate_id uuid, p_approve boolean,
  p_signature_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates; sig uuid;
begin
  select * into d from public.mandates where id = p_mandate_id for update;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  if d.principal_org_id <> actor or d.status <> 'requested' then perform app.raise('NOT_FOUND'); end if;
  if p_approve then
    sig := app.consume_signature(p_signature_id, 'grant_mandate', actor, jsonb_build_object(
      'agent_org_id', d.agent_org_id, 'machine_id', coalesce(d.machine_id::text, ''),
      'scopes', array_to_string(d.scopes, ', '), 'valid_to', d.valid_to::text));
    update public.mandates set status = 'active', principal_signature_id = sig, accepted_by = auth.uid(), accepted_at = now()
    where id = d.id returning * into d;
  else
    update public.mandates set status = 'declined', ended_at = now(), accepted_by = auth.uid() where id = d.id returning * into d;
  end if;
  perform app.log_event(case when p_approve then 'mandate.request_approved' else 'mandate.request_declined' end,
    d.machine_id, d.principal_org_id, actor, jsonb_build_object('mandate_id', d.id, 'scopes', d.scopes, 'valid_to', d.valid_to));
  -- A declined machine request keeps the owner anonymous: the client renders "the machine's owner" for a null.
  perform app.notify_org(d.agent_org_id, case when p_approve then 'mandate.request_approved' else 'mandate.request_declined' end,
    jsonb_build_object('mandate_id', d.id, 'valid_to', d.valid_to,
      'principal', case when app.mandate_hides_principal(d) then null else (select name from public.organizations where id = actor) end),
    '/mandates', 'info', 'admin');
  return jsonb_build_object('ok', true, 'mandate', to_jsonb(d));
end $$;

create or replace function public.revoke_mandate(p_org_id uuid, p_mandate_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); d public.mandates;
begin
  update public.mandates set status = 'revoked', ended_at = now(), ended_reason = left(nullif(trim(p_reason), ''), 300)
  where id = p_mandate_id and (principal_org_id = actor or agent_org_id = actor)
    and status in ('requested', 'pending', 'active') returning * into d;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('mandate.revoked', d.machine_id, d.principal_org_id, actor, jsonb_build_object('mandate_id', d.id, 'kind', d.kind));
  perform app.notify_org(case when actor = d.principal_org_id then d.agent_org_id else d.principal_org_id end, 'mandate.revoked',
    jsonb_build_object('mandate_id', d.id,
      'by', case when actor = d.principal_org_id and app.mandate_hides_principal(d) then null
                 else (select name from public.organizations where id = actor) end),
    '/mandates', 'warning', 'admin');
  return jsonb_build_object('ok', true, 'mandate',
    case when actor = d.agent_org_id then app.mandate_for_agent(d) else to_jsonb(d) end);
end $$;

create or replace function public.list_mandates(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(
      case when d.principal_org_id = actor then to_jsonb(d) else app.mandate_for_agent(d) end || jsonb_build_object(
      'direction', case when d.principal_org_id = actor then 'granted' else 'received' end,
      'awaiting', case when d.status = 'requested' then 'principal' when d.status = 'pending' then 'agent' end,
      'effective_status', case when d.status = 'active' and d.valid_to < current_date then 'expired' else d.status end,
      'principal', case when d.principal_org_id <> actor and app.mandate_hides_principal(d) then null
                        else app.org_brief(d.principal_org_id) end,
      'agent', app.org_brief(d.agent_org_id),
      'machine', (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model) from public.machines m where m.id = d.machine_id))
      order by (d.status in ('requested', 'pending', 'active')) desc, d.created_at desc)
    from public.mandates d where d.principal_org_id = actor or d.agent_org_id = actor), '[]'::jsonb);
end $$;

revoke all on function app.mandate_hides_principal(public.mandates), app.mandate_for_agent(public.mandates) from public;
grant execute on function app.mandate_hides_principal(public.mandates), app.mandate_for_agent(public.mandates)
  to authenticated, service_role;
