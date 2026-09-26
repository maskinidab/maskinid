-- =====================================================================
-- Step 8 – RPCs the application shell needs
-- =====================================================================

-- Signature status for the BankID polling in the signing dialog.
create or replace function public.get_signature_status(p_signature_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('id', id, 'status', status, 'provider', provider, 'signed_at', signed_at)
    from public.signatures where id = p_signature_id and signer_user_id = auth.uid()), jsonb_build_object('status', 'not_found'))
$$;

-- Org activity: people are named only when they belong to the org itself; other actors appear as their organisation.
create or replace function public.list_org_events(p_org_id uuid, p_types text[] default null, p_limit int default 100, p_before_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'type', e.type, 'created_at', e.created_at,
      'machine_id', e.machine_id, 'reg_number', (select reg_number from public.machines where id = e.machine_id),
      'actor_name', case when e.actor_org_id = actor
        then (select full_name from public.profiles where user_id = e.actor_user_id and deleted_at is null)
        else (select name from public.organizations where id = e.actor_org_id) end,
      'actor_type', e.actor_type, 'payload', e.payload) order by e.seq desc)
    from (select * from public.events ev where (ev.actor_org_id = actor or ev.org_id = actor)
            and (p_types is null or ev.type = any (p_types)) and (p_before_seq is null or ev.seq < p_before_seq)
          order by ev.seq desc limit least(greatest(p_limit, 1), 500)) e), '[]'::jsonb);
end $$;

-- DEMO_MODE only: shortcuts for the demo script (SPEC §17) – a green machine, the stolen one, a financed one.
create or replace function public.demo_shortcuts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_demo_mode() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    (select 'active_level2' as kind, m.reg_number, l.code from public.machines m join public.labels l on l.machine_id = m.id and l.status = 'bound' and l.role = 'primary'
      where m.status = 'active' and m.verification_level = 2 order by m.created_at limit 1)
    union all
    (select 'stolen', m.reg_number, l.code from public.machines m left join public.labels l on l.machine_id = m.id and l.status = 'bound' and l.role = 'primary'
      where m.status = 'stolen' order by m.created_at limit 1)
    union all
    (select 'financed', m.reg_number, l.code from public.machines m join public.encumbrances e on e.machine_id = m.id and e.status = 'active'
      left join public.labels l on l.machine_id = m.id and l.status = 'bound' and l.role = 'primary'
      where m.status = 'active' order by m.created_at limit 1)
    union all
    (select 'scrapped', m.reg_number, null from public.machines m where m.status = 'scrapped' order by m.created_at limit 1)
  ) x), '[]'::jsonb);
end $$;

grant execute on function public.get_signature_status(uuid) to authenticated;
grant execute on function public.demo_shortcuts() to anon, authenticated;
