-- A consent you cannot browse is not much of a consent (ADR 0032, follow-up).
--
-- A fleet-wide power of attorney let the agent open any of the principal's machines, but no list contained them:
-- list_scope_match knew owned, used, registered, previous and consigned stock, nothing else. A bank that had been
-- granted insight into a company's fleet could only open a machine whose regnr or serial it already knew. The new
-- scope `shared` is every machine another organisation has granted us a `view` or `fleet` mandate for.

create or replace function app.list_scope_match(m public.machines, p_org uuid, p_scope text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_scope
    when 'owned' then m.owner_org_id = p_org and m.status <> 'draft'
    when 'stock' then m.status <> 'draft' and ((m.owner_org_id = p_org and m.stock_status is not null)
      or exists (select 1 from public.mandates d where d.machine_id = m.id and d.agent_org_id = p_org and d.kind = 'consignment'
                 and d.status = 'active' and current_date between d.valid_from and d.valid_to))
    when 'used' then m.user_org_id = p_org and m.status <> 'draft'
    when 'registered' then m.registered_by_org_id = p_org and m.status <> 'draft'
    when 'previous' then m.owner_org_id <> p_org and exists (select 1 from public.ownerships w where w.machine_id = m.id and w.owner_org_id = p_org and w.to_date is not null)
    when 'all' then (m.owner_org_id = p_org or m.user_org_id = p_org or m.registered_by_org_id = p_org) and m.status <> 'draft'
    -- Same test as the access itself (app.has_mandate), so the list never shows a machine that will not open.
    when 'shared' then m.status <> 'draft' and m.owner_org_id <> p_org
      and (app.has_mandate(m.id, p_org, 'view') or app.has_mandate(m.id, p_org, 'fleet'))
    else false end
$$;

create or replace function public.list_machines(p_org_id uuid, p_scope text default 'owned', p_query text default null,
  p_status public.machine_status default null, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if p_scope not in ('owned', 'used', 'registered', 'previous', 'stock', 'all', 'shared') then perform app.raise('VALIDATION', '{"field":"scope"}'); end if;
  return jsonb_build_object(
    'total', (select count(*) from public.machines m where app.list_scope_match(m, actor, p_scope) and (p_status is null or m.status = p_status)
      and (q is null or m.reg_number = app.normalize_reg_number(q) or (coalesce(m.make, '') || ' ' || coalesce(m.model, '')) ilike '%' || q || '%'
           or exists (select 1 from public.machine_identifiers x where x.machine_id = m.id and x.normalized_value = app.normalize_identifier(q)))),
    'items', coalesce((select jsonb_agg(app.machine_list_item(m, actor) order by app.machine_status_rank(m.status), m.updated_at desc) from (
      select * from public.machines m where app.list_scope_match(m, actor, p_scope) and (p_status is null or m.status = p_status)
        and (q is null or m.reg_number = app.normalize_reg_number(q) or (coalesce(m.make, '') || ' ' || coalesce(m.model, '')) ilike '%' || q || '%'
             or exists (select 1 from public.machine_identifiers x where x.machine_id = m.id and x.normalized_value = app.normalize_identifier(q)))
      order by app.machine_status_rank(m.status), m.updated_at desc
      limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) m), '[]'::jsonb));
end $$;
