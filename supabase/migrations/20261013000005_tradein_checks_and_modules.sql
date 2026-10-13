-- =====================================================================================================================
-- The dealer's view: an Inbytestest of its own, and the fleet modules it should not see (ADR 0031).
--
-- "För handlare tycker jag att vi kan ändra kategorin 'Daglig kontroll' till 'Inbytestest', alternativt skapa en
--  ny kategori som heter just 'Inbytestest'. Där ska handlaren kunna fylla i eller scanna serienumret på maskinen
--  och sedan få upp samma kontrollpunkter, texter och bockrutor som idag finns under 'Daglig kontroll'."
--
-- A dealer cannot use submit_daily_check for this: it goes through app.require_fleet_access, which requires the
-- caller to own or use the machine. A trade-in candidate is someone else's machine, which is the whole point.
-- Reusing the RPC would also mean a dealer's appraisal could take the owner's machine out of service and write in
-- the owner's hour meter.
--
-- "Uthyrning kan vi ta bort från handlarvyn, men funktionen ska fortfarande finnas kvar i systemet så att vi kan
--  aktivera den för de handlare som vill ha eller behöver den framöver. 'Bränsle och klimat' kan tas bort från
--  handlarvyn. 'Förare' kan också tas bort från handlarvyn."
--
-- Those four modules are gated on the `owner` org type, and Nordmaskin is both `dealer` and `owner` — which is why
-- a dealer sees them. The default is therefore derived from the org type rather than stored, so no backfill is
-- needed and a new dealer gets the right menu on day one.
-- =====================================================================================================================

-- ---------- Inbytestest ----------
-- Deliberately its own table, not a row in daily_checks: a dealer's appraisal of a machine it is considering
-- buying is not part of the owner's operating history, and the owner must not read the dealer's notes.
create table public.tradein_checks (
  id            uuid primary key default gen_random_uuid(),
  dealer_org_id uuid not null references public.organizations (id),
  -- Nullable: the point of an Inbytestest is to appraise a machine before any deal, and that machine is not
  -- necessarily in the register yet. serial_text keeps what the dealer scanned or typed either way.
  machine_id    uuid references public.machines (id),
  serial_text   text check (serial_text is null or length(serial_text) between 2 and 64),
  label_code    text check (label_code is null or length(label_code) between 2 and 32),
  user_id       uuid not null,
  template_id   uuid references public.checklist_templates (id),
  template_name text not null,
  items         jsonb not null,   -- template snapshot, so a later edit of the template cannot rewrite history
  answers       jsonb not null,   -- [{ id, ok, note }]
  hours         int check (hours is null or hours between 0 and 200000),
  result        text not null check (result in ('ok', 'remarks', 'failed')),
  note          text check (length(note) <= 2000),
  created_at    timestamptz not null default now(),
  check (machine_id is not null or nullif(trim(coalesce(serial_text, '')), '') is not null)
);
create index tradein_checks_dealer_idx on public.tradein_checks (dealer_org_id, created_at desc);
create index tradein_checks_machine_idx on public.tradein_checks (machine_id, created_at desc) where machine_id is not null;

alter table public.tradein_checks enable row level security;
revoke all on public.tradein_checks from anon, authenticated;
grant select on public.tradein_checks to authenticated;
-- The dealer that made the appraisal, and the operator. Deliberately NOT the daily_checks_read shape
-- (`or app.has_full_access(app.machine_relations(machine_id))`): copying that would hand the machine's owner the
-- dealer's valuation notes, which would make the feature unusable for the dealer.
create policy tradein_checks_read on public.tradein_checks for select to authenticated using (
  dealer_org_id = any (app.current_org_ids()) or app.is_operator());

comment on table public.tradein_checks is
  'A dealer''s pre-trade-in inspection of a machine it does not own. Readable by that dealer and the operator only (ADR 0031).';

create or replace function public.submit_tradein_check(p_org_id uuid, p_template_id uuid, p_answers jsonb,
  p_machine_id uuid default null, p_serial text default null, p_label_code text default null,
  p_hours int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member'); t public.checklist_templates; c public.tradein_checks;
  res text; failed jsonb; missing int; m public.machines; serial text := nullif(trim(coalesce(p_serial, '')), '');
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  -- No app.require_fleet_access: the machine belongs to someone else, which is the whole point of a trade-in test.
  if p_machine_id is not null then
    select * into m from public.machines where id = p_machine_id;
    if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
    serial := coalesce(serial, app.machine_primary_serial(m.id));
  elsif serial is null then
    perform app.raise('VALIDATION', '{"field":"serial"}');
  end if;
  select * into t from public.checklist_templates where id = p_template_id and active and (org_id is null or org_id = actor);
  if t.id is null then perform app.raise('NOT_FOUND', '{"what":"template"}'); end if;
  if jsonb_typeof(p_answers) <> 'array' then perform app.raise('VALIDATION', '{"field":"answers"}'); end if;
  -- Every item must be answered, exactly as submit_daily_check requires: a half-filled appraisal is worse than none.
  select count(*) into missing from jsonb_array_elements(t.items) i
  where not exists (select 1 from jsonb_array_elements(p_answers) a where a ->> 'id' = i ->> 'id' and jsonb_typeof(a -> 'ok') = 'boolean');
  if missing > 0 then perform app.raise('VALIDATION', jsonb_build_object('field', 'answers', 'missing', missing)); end if;
  select coalesce(jsonb_agg(i ->> 'id'), '[]'::jsonb) into failed from jsonb_array_elements(t.items) i
  where coalesce((i ->> 'critical')::boolean, false)
    and exists (select 1 from jsonb_array_elements(p_answers) a where a ->> 'id' = i ->> 'id' and not (a ->> 'ok')::boolean);
  res := case when jsonb_array_length(failed) > 0 then 'failed'
              when exists (select 1 from jsonb_array_elements(p_answers) a where not (a ->> 'ok')::boolean) then 'remarks' else 'ok' end;
  insert into public.tradein_checks (dealer_org_id, machine_id, serial_text, label_code, user_id, template_id, template_name,
    items, answers, hours, result, note)
  values (actor, p_machine_id, serial, nullif(trim(coalesce(p_label_code, '')), ''), auth.uid(), t.id, t.name, t.items,
    (select jsonb_agg(jsonb_build_object('id', a ->> 'id', 'ok', (a ->> 'ok')::boolean, 'note', left(a ->> 'note', 300))) from jsonb_array_elements(p_answers) a),
    p_hours, res, left(nullif(trim(p_note), ''), 2000))
  returning * into c;
  -- Deliberately NOT record_hours and NOT app.set_operational_status: a dealer appraising a machine it does not own
  -- must not write in the owner's hour meter or take the owner's machine out of service.
  --
  -- Logged with machine_id = null and org_id = the dealer. app.can_read_event returns true for the owner on every
  -- event that carries a machine_id, so logging this against the machine would show the owner "Nordmaskin
  -- inbytestestade din maskin" — and a dealer's appraisal is its own business until an offer is made. The null
  -- branch of can_read_event confines it to the dealer's own organisations, and rule 3 is still satisfied.
  perform app.log_event('dealer.tradein_check', null, actor, actor,
    jsonb_build_object('check_id', c.id, 'result', res, 'failed_items', failed, 'serial', serial,
      'machine_known', p_machine_id is not null));
  return jsonb_build_object('ok', true, 'id', c.id, 'result', res, 'failed_items', failed,
    'items', t.items, 'template_name', t.name);
end $$;

create or replace function public.list_tradein_checks(p_org_id uuid, p_machine_id uuid default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  return coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' || jsonb_build_object(
      'reg_number', (select m.reg_number from public.machines m where m.id = c.machine_id),
      'make', (select m.make from public.machines m where m.id = c.machine_id),
      'model', (select m.model from public.machines m where m.id = c.machine_id),
      'by', (select full_name from public.profiles where user_id = c.user_id))
      order by c.created_at desc)
    from (select * from public.tradein_checks d where d.dealer_org_id = actor
            and (p_machine_id is null or d.machine_id = p_machine_id)
          order by d.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) c), '[]'::jsonb);
end $$;

revoke all on function public.submit_tradein_check(uuid, uuid, jsonb, uuid, text, text, int, text),
  public.list_tradein_checks(uuid, uuid, int) from public;
grant execute on function public.submit_tradein_check(uuid, uuid, jsonb, uuid, text, text, int, text),
  public.list_tradein_checks(uuid, uuid, int) to authenticated, service_role;

-- ---------- Per-organisation modules ----------
-- organizations.settings -> 'modules', e.g. {"rentals": true}. No new table: the same shape as
-- financing_defaults and min_trusted_level.
--
-- The default is derived from the org type rather than stored, so nothing has to be backfilled and a dealer
-- created tomorrow gets the right menu. A stored key overrides it, one module at a time.
create or replace function app.module_default(p_org_id uuid, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  -- The four fleet modules the product owner took out of the dealer view. A dealer that also owns machines still
  -- does not want them there; an owner that is not a dealer keeps everything.
  select not (p_name in ('daily_check', 'rentals', 'climate', 'operators') and app.has_org_type(p_org_id, 'dealer'))
$$;

create or replace function app.org_module(p_org_id uuid, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (o.settings -> 'modules' ->> p_name)::boolean from public.organizations o where o.id = p_org_id),
    app.module_default(p_org_id, p_name))
$$;

-- Not OR-ed with app.is_demo_mode(): staging runs demo mode, and the dealer view has to look right there.
create or replace function app.require_module(p_org_id uuid, p_name text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.org_module(p_org_id, p_name) then
    perform app.raise('FEATURE_DISABLED', jsonb_build_object('module', p_name));
  end if;
end $$;

grant execute on function app.module_default(uuid, text), app.org_module(uuid, text), app.require_module(uuid, text)
  to authenticated, service_role;

-- The list of modules an organisation may toggle, so neither update_org nor the operator can invent a key.
create or replace function app.module_names()
returns text[] language sql immutable set search_path = '' as $$
  select array['daily_check', 'rentals', 'climate', 'operators', 'attachments']
$$;
grant execute on function app.module_names() to authenticated, service_role;
