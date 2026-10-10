-- Scanning a QR märke that is not yet on a machine should lead into registering that machine.
--
-- Two things stood in the way. First, public_machine_card answered 'unknown_label' both for a code that is
-- not ours and for a real label nobody has used yet, so the scan page could not tell them apart and showed
-- "finns inte i registret" for a brand new märke. Second, a bad or taken code was only discovered when
-- register_machine ran, i.e. after four filled-in steps, and LABEL_NOT_FOUND / LABEL_ASSIGNED_TO_OTHER_ORG
-- abort the whole registration.

-- 1. Tell an unused märke apart from a code that is not ours.
--
-- The disclosure is deliberate and small: an anonymous visitor learns that a code they already hold is a real
-- unused label. A code is 22 characters of base62 from app.generate_label_code (~131 bits), obtainable only by
-- holding the sticker, and log_public_scan rate-limits anonymous lookups per hashed IP. Everything else about
-- the function is unchanged, and log_public_scan passes any found:false body straight through.
create or replace function public.public_machine_card(p_code text default null, p_reg text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.labels; m public.machines; r text;
begin
  if p_code is not null then
    if p_code !~ '^[0-9A-Za-z]{22}$' then return jsonb_build_object('found', false, 'reason', 'invalid_code'); end if;
    select * into l from public.labels where code = p_code;
    if l.id is null then return jsonb_build_object('found', false, 'reason', 'unknown_label'); end if;
    -- A real märke waiting to be put on a machine. The scan page offers to register one.
    if l.machine_id is null then return jsonb_build_object('found', false, 'reason', 'unbound_label'); end if;
    select * into m from public.machines where id = l.machine_id;
  elsif p_reg is not null then
    r := app.normalize_reg_number(p_reg);
    if not app.is_valid_reg_number(r) then return jsonb_build_object('found', false, 'reason', 'invalid_reg_number'); end if;
    select * into m from public.machines where reg_number = r;
  else
    return jsonb_build_object('found', false, 'reason', 'missing');
  end if;
  if m.id is null or m.status = 'draft' then return jsonb_build_object('found', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('found', true, 'card', app.public_card_json(m, l));
end $$;

-- 2. Answer "can I use this märke?" before the user invests any typing.
--
-- Read-only, so a readonly member may ask. It never names the organisation a label belongs to, and only
-- returns machine_id when the machine is the caller's own - the registration number is already public via
-- /m/<code>, the internal id is not.
create or replace function public.check_label(p_org_id uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
-- `c`, not `code`: a variable named after the column would make `where code = code` compare the variable with
-- itself and match an arbitrary row.
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); l public.labels; m public.machines; c text := trim(p_code);
begin
  if c !~ '^[0-9A-Za-z]{22}$' then return jsonb_build_object('found', false, 'reason', 'invalid_code'); end if;
  select * into l from public.labels where code = c;
  if l.id is null then return jsonb_build_object('found', false, 'reason', 'unknown_label'); end if;
  if l.machine_id is not null then
    select * into m from public.machines where id = l.machine_id;
    return jsonb_build_object('found', true, 'bindable', false, 'reason', 'already_bound',
      'serial', right(l.code, 6), 'status', l.status, 'reg_number', m.reg_number,
      'is_mine', m.owner_org_id = actor)
      || case when m.owner_org_id = actor then jsonb_build_object('machine_id', m.id) else '{}'::jsonb end;
  end if;
  if l.status in ('revoked', 'lost') then
    return jsonb_build_object('found', true, 'bindable', false, 'reason', l.status::text, 'serial', right(l.code, 6), 'status', l.status);
  end if;
  -- Allocated to someone else. Say no without saying who: bind_label raises LABEL_ASSIGNED_TO_OTHER_ORG here.
  if l.assigned_org_id is not null and l.assigned_org_id <> actor and not app.is_operator('verifier') then
    return jsonb_build_object('found', true, 'bindable', false, 'reason', 'other_org', 'serial', right(l.code, 6), 'status', l.status);
  end if;
  return jsonb_build_object('found', true, 'bindable', true, 'serial', right(l.code, 6), 'status', l.status);
end $$;

revoke all on function public.check_label(uuid, text) from public;
grant execute on function public.check_label(uuid, text) to authenticated, service_role;
