-- =====================================================================
-- Step 4 – events & audit: read access, history timeline, chain
-- verification for operators, anchor publishing (SPEC §4.5, §9.4, §11.4)
-- =====================================================================

-- Category of an event type, used for role filtering (financiers see encumbrance/transfer/flag events,
-- insurers flag events – SPEC §11.2).
create or replace function app.event_category(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_type like 'encumbrance.%' then 'encumbrance'
    when p_type like 'transfer.%' or p_type like 'ownership.%' then 'transfer'
    when p_type like 'flag.%' or p_type in ('machine.deregistered', 'machine.stolen_scanned') then 'flag'
    else split_part(p_type, '.', 1) end
$$;

-- May the current user read this event? Redefined when later steps add relations.
create or replace function app.can_read_event(p_machine_id uuid, p_org_id uuid, p_type text, p_created_at timestamptz)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare rel text[];
begin
  if app.is_operator() or app.acts_as('authority') then return true; end if;
  if p_machine_id is null then
    return p_org_id is not null and p_org_id = any (app.current_org_ids());
  end if;
  rel := app.machine_relations(p_machine_id);
  if rel && array['owner', 'user', 'registered_by', 'draft_owner'] then return true; end if;
  if 'previous_owner' = any (rel) then
    -- Previous owners see history up to the end of their last ownership period (SPEC §6.7 step 3).
    return p_created_at < (select (max(w.to_date) + 1)::timestamptz from public.ownerships w
      where w.machine_id = p_machine_id and w.owner_org_id = any (app.current_org_ids()) and w.to_date is not null);
  end if;
  if 'holder' = any (rel) and app.event_category(p_type) in ('encumbrance', 'transfer', 'flag') then return true; end if;
  if 'insurer' = any (rel) and app.event_category(p_type) = 'flag' then return true; end if;
  return false;
end $$;
grant execute on function app.can_read_event(uuid, uuid, text, timestamptz), app.event_category(text) to authenticated, service_role;

create policy events_read on public.events for select to authenticated using (app.can_read_event(machine_id, org_id, type, created_at));

-- Timeline for the machine page (SPEC §9.4): newest first, role-filtered, with actor names for the i18n sentences
-- ("Nordea Finance registrerade förbehåll").
create or replace function public.get_machine_history(p_org_id uuid, p_machine_id uuid, p_limit int default 200, p_before_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  perform app.require_scope('machines:read');
  if not (app.can_view_machine(p_machine_id) or app.is_operator()) then perform app.raise('NOT_FOUND'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'seq', e.seq, 'id', e.id, 'type', e.type, 'category', app.event_category(e.type), 'created_at', e.created_at,
      'actor_type', e.actor_type,
      'actor_org', case when e.actor_org_id is null then null else jsonb_build_object('id', e.actor_org_id,
        'name', (select name from public.organizations where id = e.actor_org_id)) end,
      'actor_name', case when e.actor_org_id = any (app.current_org_ids()) or app.is_operator()
        then (select coalesce(p.full_name, 'user') from public.profiles p where p.user_id = e.actor_user_id and p.deleted_at is null) end,
      'payload', e.payload) order by e.seq desc)
    from (select * from public.events ev where ev.machine_id = p_machine_id
            and (p_before_seq is null or ev.seq < p_before_seq)
            and app.can_read_event(ev.machine_id, ev.org_id, ev.type, ev.created_at)
          order by ev.seq desc limit least(greatest(p_limit, 1), 1000)) e), '[]'::jsonb);
end $$;

-- Org activity ("Team: vem sålde vad", SPEC §7.2): events where the org acted or is concerned.
create or replace function public.list_org_events(p_org_id uuid, p_types text[] default null, p_limit int default 100, p_before_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'type', e.type, 'created_at', e.created_at,
      'machine_id', e.machine_id, 'reg_number', (select reg_number from public.machines where id = e.machine_id),
      'actor_name', (select full_name from public.profiles where user_id = e.actor_user_id and deleted_at is null),
      'actor_type', e.actor_type, 'payload', e.payload) order by e.seq desc)
    from (select * from public.events ev where (ev.actor_org_id = actor or ev.org_id = actor)
            and (p_types is null or ev.type = any (p_types)) and (p_before_seq is null or ev.seq < p_before_seq)
          order by ev.seq desc limit least(greatest(p_limit, 1), 500)) e), '[]'::jsonb);
end $$;

-- Operator: event explorer and chain verification (SPEC §9.2 admin).
create or replace function public.admin_list_events(p_machine_id uuid default null, p_org_id uuid default null, p_type text default null,
  p_limit int default 100, p_before_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.seq desc) from (
    select * from public.events ev
    where (p_machine_id is null or ev.machine_id = p_machine_id) and (p_org_id is null or ev.org_id = p_org_id or ev.actor_org_id = p_org_id)
      and (p_type is null or ev.type like p_type || '%') and (p_before_seq is null or ev.seq < p_before_seq)
    order by ev.seq desc limit least(greatest(p_limit, 1), 1000)) e), '[]'::jsonb);
end $$;

create or replace function public.admin_verify_chain(p_from_seq bigint default null, p_to_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return app.verify_chain(p_from_seq, p_to_seq);
end $$;

-- Anchoring (Edge Function anchor-events, service role): compute, then mark published with the external reference.
create or replace function public.anchor_compute(p_day date default (now() at time zone 'Europe/Stockholm')::date - 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.event_anchors; v jsonb;
begin
  v := app.verify_chain((select coalesce(max(last_seq), 0) + 1 from public.event_anchors where day < p_day), null);
  if not (v ->> 'ok')::boolean then
    perform app.notify_operators('audit.chain_broken', v, '/admin/events', 'critical', 'support');
    perform app.raise('CHAIN_BROKEN', v);
  end if;
  a := app.compute_anchor(p_day);
  return to_jsonb(a);
end $$;

create or replace function public.anchor_mark_published(p_day date, p_external_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.event_anchors;
begin
  update public.event_anchors set published_at = now(), external_ref = p_external_ref where day = p_day and published_at is null
  returning * into a;
  if a.day is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('audit.anchor_published', null, null, null,
    jsonb_build_object('day', p_day, 'root_hash', a.root_hash, 'last_seq', a.last_seq, 'external_ref', p_external_ref));
  return to_jsonb(a);
end $$;

grant execute on function public.get_machine_history(uuid, uuid, int, bigint), public.list_org_events(uuid, text[], int, bigint),
  public.admin_list_events(uuid, uuid, text, int, bigint), public.admin_verify_chain(bigint, bigint) to authenticated;
grant execute on function public.anchor_compute(date), public.anchor_mark_published(date, text) to service_role;
