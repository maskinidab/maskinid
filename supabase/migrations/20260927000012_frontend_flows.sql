-- Step 10 fixes found while building the frontend flows.

-- perform_check with type "any" did not match registration numbers.
create or replace function app.check_one(p_actor uuid, p_query jsonb, p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q text; typ text; mid uuid; m public.machines; fin public.encumbrances; res jsonb; rn text; r public.check_receipts; see_holder boolean;
begin
  typ := coalesce(p_query ->> 'type', case when p_query ? 'reg' then 'reg' when p_query ? 'pin' then 'pin' when p_query ? 'vin' then 'vin'
                                           when p_query ? 'road_reg' then 'road_reg' else 'serial' end);
  q := app.normalize_identifier(coalesce(p_query ->> 'value', p_query ->> typ));
  if q is null then perform app.raise('VALIDATION', '{"field":"query"}'); end if;
  -- "any" also matches a MaskinID registration number (the UI's default search type).
  if typ = 'any' and app.is_valid_reg_number(q) and exists (select 1 from public.machines where reg_number = q and status <> 'draft') then
    typ := 'reg';
  end if;
  if typ = 'reg' then
    if not app.is_valid_reg_number(q) then perform app.raise('VALIDATION', '{"field":"reg","reason":"check_character"}'); end if;
    select id into mid from public.machines where reg_number = q and status <> 'draft';
  else
    select x.machine_id into mid from public.machine_identifiers x join public.machines mm on mm.id = x.machine_id
      where x.normalized_value = q and (typ = 'any' or x.type::text = typ) and mm.status <> 'draft'
      order by x.unique_active desc limit 1;
  end if;
  see_holder := app.has_org_type(p_actor, 'financier') or app.has_org_type(p_actor, 'authority') or app.is_operator();
  if mid is null then
    res := jsonb_build_object('found', false);
  else
    select * into m from public.machines where id = mid;
    fin := app.active_financing(m.id);
    res := jsonb_build_object('found', true, 'machine_id', m.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year,
      'status', m.status, 'verification_level', m.verification_level,
      'owner_org_name', case when see_holder or app.has_org_type(p_actor, 'dealer') or app.has_org_type(p_actor, 'insurer') then (select name from public.organizations where id = m.owner_org_id) end,
      'owner_org_number', case when see_holder then app.org_number_display(m.owner_org_id) end,
      'has_active_financing', fin.id is not null,
      'financing', case when fin.id is not null and see_holder then jsonb_build_object('type', fin.type, 'start_date', fin.start_date,
        'holder', (select name from public.organizations where id = fin.holder_org_id)) end,
      'flags', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'raised_at', raised_at)) from public.flags where machine_id = m.id and status = 'active'), '[]'::jsonb),
      'last_transfer_date', (select max(effective_date) from public.transfers where machine_id = m.id and status = 'completed'),
      'market_listings', app.market_listings_for(m.id));
  end if;
  rn := app.receipt_number();
  insert into public.check_receipts (receipt_number, machine_id, query, purpose, performed_by_org_id, performed_by_user_id, api_key_id, result, result_hash)
  values (rn, mid, jsonb_build_object('type', typ, 'value', q), left(p_purpose, 200), p_actor, auth.uid(), app.current_api_key_id(),
          res || jsonb_build_object('performed_by', (select name from public.organizations where id = p_actor), 'performed_at', app.iso_ts(now())),
          app.sha256_hex(rn || '|' || res::text))
  returning * into r;
  if mid is not null then
    perform app.log_event('machine.checked', mid, m.owner_org_id, p_actor, jsonb_build_object('receipt_number', rn, 'has_active_financing', fin.id is not null));
    perform app.after_lookup(p_actor, array[mid], 'check');
  end if;
  return jsonb_build_object('receipt_number', r.receipt_number, 'id', r.id, 'created_at', r.created_at, 'result', r.result, 'result_hash', r.result_hash);
end $$;


-- Anyone holding a check receipt can confirm it is genuine (SPEC §6.6 step 3: receipt with number and PDF).
-- Requires both the receipt number and the SHA-256 printed on it, so nothing is revealed to someone who only guesses
-- a number. Returns only what is already printed on the receipt.
create or replace function public.verify_check_receipt(p_receipt_number text, p_result_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.check_receipts;
begin
  -- Per user, or per client address for anonymous callers (hashed; the address itself is never stored).
  if not app.rate_limit_hit('receipt_verify:' || coalesce(auth.uid()::text,
       app.sha256_hex(coalesce(split_part(app.request_header('x-forwarded-for'), ',', 1), 'anon'))), 60, interval '1 hour') then
    perform app.raise('RATE_LIMITED');
  end if;
  select * into r from public.check_receipts
    where receipt_number = upper(trim(p_receipt_number)) and result_hash = lower(trim(p_result_hash));
  if r.id is null then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', true, 'receipt_number', r.receipt_number, 'created_at', r.created_at,
    'performed_by', r.result ->> 'performed_by', 'reg_number', r.result ->> 'reg_number', 'found', (r.result ->> 'found')::boolean,
    'has_active_financing', (r.result ->> 'has_active_financing')::boolean);
end $$;
grant execute on function public.verify_check_receipt(text, text) to anon, authenticated;

-- Rate limiting for Edge Functions that call paid external services (company lookup). Service role only.
create or replace function public.rate_limit_check(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  return app.rate_limit_hit(p_key, p_limit, make_interval(secs => p_window_seconds));
end $$;
revoke execute on function public.rate_limit_check(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_check(text, int, int) to service_role;
