-- Step 13: dealer tools (SPEC §6.3, §7.2) – stock, sale flow with new sale ⇒ level 2, trade-in, leads from ad QR,
-- customers, sales list. Label ordering already exists (order_labels, step 3).

alter table public.transfers add column is_new_sale boolean not null default false;

-- ---------- Stock ----------
create or replace function public.set_stock_status(p_org_id uuid, p_machine_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines;
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  if p_status is not null and p_status not in ('stock', 'demo', 'trade_in') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.machines set stock_status = p_status where id = p_machine_id and owner_org_id = actor and status <> 'draft' returning * into m;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('machine.stock_status_changed', m.id, actor, actor, jsonb_build_object('stock_status', p_status));
  return jsonb_build_object('ok', true, 'stock_status', m.stock_status);
end $$;

-- ---------- Sale (SPEC §6.3 / §6.7) ----------
-- A dealer (or any owner) sells: this is a transfer the buyer accepts with BankID. A new sale (first sale of a machine
-- from a dealer's stock, invoice attached) makes the machine level 2 with method new_sale when the buyer accepts.
create or replace function public.sell_machine(p_org_id uuid, p_machine_id uuid, p_buyer jsonb, p_sale_date date default current_date,
  p_new_financing jsonb default null, p_document_ids uuid[] default '{}', p_new_sale boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); m public.machines; r jsonb;
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if coalesce(p_new_sale, false) then
    if not app.has_org_type(actor, 'dealer') or m.owner_org_id is distinct from actor then perform app.raise('FORBIDDEN'); end if;
    if m.first_sale_date is not null or exists (select 1 from public.ownerships where machine_id = m.id and acquired_via = 'transfer') then
      perform app.raise('VALIDATION', '{"field":"new_sale","reason":"already_sold_before"}');
    end if;
    if not exists (select 1 from public.documents d where d.id = any (coalesce(p_document_ids, '{}')) and d.machine_id = m.id and d.type = 'invoice'
                   and d.status in ('clean', 'scanning')) then
      perform app.raise('VALIDATION', '{"field":"document_ids","reason":"invoice_required"}');
    end if;
  end if;
  r := public.initiate_transfer(actor, m.id, coalesce(p_sale_date, current_date), nullif(p_buyer ->> 'org_id', '')::uuid,
    nullif(p_buyer ->> 'org_number', ''), nullif(p_buyer ->> 'email', ''), p_new_financing, coalesce(p_document_ids, '{}'), false);
  if coalesce(p_new_sale, false) then
    update public.transfers set is_new_sale = true where id = (r -> 'transfer' ->> 'id')::uuid;
    r := jsonb_set(r, '{transfer,is_new_sale}', 'true'::jsonb);
  end if;
  return r;
end $$;

-- After a completed transfer: a new sale verifies the machine (level 2, new_sale) and records the first sale.
create or replace function app.after_transfer_completed(p_transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.transfers; m public.machines;
begin
  select * into t from public.transfers where id = p_transfer_id;
  if t.is_new_sale then
    update public.machines set first_sale_date = t.effective_date, first_sale_dealer_org_id = t.from_org_id,
      origin = case when origin = 'retro' then 'new_sale' else origin end
    where id = t.machine_id returning * into m;
    if m.verification_level < 2 then
      perform app.apply_verification(m.id, 2, 'new_sale', t.from_org_id, jsonb_build_object('transfer_id', t.id, 'new_sale', true));
    end if;
  end if;
end $$;

create or replace function public.list_sales(p_org_id uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.transfer_json(t) || jsonb_build_object('make', m.make, 'model', m.model, 'is_new_sale', t.is_new_sale,
      'seller_user', (select full_name from public.profiles where user_id = t.initiated_by_user_id)) order by t.created_at desc)
    from (select * from public.transfers where from_org_id = actor and status in ('awaiting_buyer', 'awaiting_financier', 'completed')
          order by created_at desc limit least(greatest(p_limit, 1), 1000)) t join public.machines m on m.id = t.machine_id), '[]'::jsonb);
end $$;

-- Customers: organisations the dealer has sold to or registered machines for (SPEC §7.2 "byggs automatiskt").
create or replace function public.list_customers(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  return coalesce((select jsonb_agg(c order by c ->> 'last_at' desc nulls last) from (
    select app.org_brief(o.id) || jsonb_build_object('email', o.email, 'phone', o.phone,
      'machines_sold', (select count(*) from public.transfers t where t.from_org_id = actor and t.to_org_id = o.id and t.status = 'completed'),
      'machines_registered', (select count(*) from public.machines mm where mm.registered_by_org_id = actor and mm.owner_org_id = o.id and mm.status <> 'draft'),
      'last_at', greatest((select max(t.completed_at) from public.transfers t where t.from_org_id = actor and t.to_org_id = o.id and t.status = 'completed'),
                          (select max(mm.created_at) from public.machines mm where mm.registered_by_org_id = actor and mm.owner_org_id = o.id))) c
    from public.organizations o
    where o.id <> actor and (exists (select 1 from public.transfers t where t.from_org_id = actor and t.to_org_id = o.id and t.status = 'completed')
       or exists (select 1 from public.machines mm where mm.registered_by_org_id = actor and mm.owner_org_id = o.id and mm.status <> 'draft'))) x), '[]'::jsonb);
end $$;

-- ---------- Leads from ad QR / "Kontakta säljare" ----------
create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  dealer_org_id uuid not null references public.organizations (id),
  machine_id    uuid references public.machines (id),
  name          text not null check (length(name) between 1 and 200),
  contact       text not null check (length(contact) between 3 and 200),
  message       text check (message is null or length(message) <= 2000),
  source        text not null default 'ad_qr' check (source in ('ad_qr', 'contact_form', 'api')),
  status        text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  consent_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index leads_dealer_idx on public.leads (dealer_org_id, created_at desc);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
create policy leads_read on public.leads for select to authenticated using (dealer_org_id = any (app.current_org_ids()));

-- Public ad card: the machine card plus the selling dealer, only while it is in a dealer's stock.
create or replace function app.ad_machine(p_reg text)
returns public.machines language sql stable security definer set search_path = '' as $$
  select m.* from public.machines m
  where m.reg_number = app.normalize_reg_number(p_reg) and m.status = 'active' and m.stock_status in ('stock', 'demo', 'trade_in')
    and app.has_org_type(m.owner_org_id, 'dealer')
$$;

create or replace function public.public_ad_card(p_reg text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.machines := app.ad_machine(p_reg); o public.organizations;
begin
  if m.id is null then return jsonb_build_object('found', false); end if;
  select * into o from public.organizations where id = m.owner_org_id;
  return jsonb_build_object('found', true, 'card', app.public_card_json(m, null) || jsonb_build_object('hour_meter', m.hour_meter),
    'dealer', jsonb_build_object('name', o.name, 'city', o.city, 'phone', o.phone, 'email', o.email));
end $$;

-- Called by the Edge Function `lead` (service role, IP hash for rate limiting). Personal data only goes to the dealer.
create or replace function public.submit_lead(p_reg text, p_name text, p_contact text, p_message text, p_consent boolean, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.machines := app.ad_machine(p_reg); l public.leads;
begin
  if not app.rate_limit_hit('lead:' || coalesce(p_ip_hash, 'none'), 5, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  if m.id is null then perform app.raise('NOT_FOUND'); end if;
  if not coalesce(p_consent, false) then perform app.raise('VALIDATION', '{"field":"consent"}'); end if;
  if nullif(trim(p_name), '') is null then perform app.raise('VALIDATION', '{"field":"name"}'); end if;
  if coalesce(trim(p_contact), '') !~ '(^\S+@\S+\.\S+$)|(^[+0-9][0-9 ()-]{6,}$)' then perform app.raise('VALIDATION', '{"field":"contact"}'); end if;
  insert into public.leads (dealer_org_id, machine_id, name, contact, message, source, consent_at)
  values (m.owner_org_id, m.id, trim(p_name), trim(p_contact), nullif(trim(p_message), ''), 'ad_qr', now()) returning * into l;
  perform app.notify_org(m.owner_org_id, 'lead.created', jsonb_build_object('lead_id', l.id, 'reg_number', m.reg_number, 'make', m.make, 'model', m.model),
    '/leads', 'info');
  perform app.enqueue_webhook(m.owner_org_id, 'lead.created', m.id, jsonb_build_object('lead_id', l.id, 'name', l.name, 'contact', l.contact,
    'message', l.message));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.submit_lead(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_lead(text, text, text, text, boolean, text) to service_role;

create or replace function public.list_leads(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model) order by l.created_at desc)
    from public.leads l left join public.machines m on m.id = l.machine_id where l.dealer_org_id = actor), '[]'::jsonb);
end $$;

create or replace function public.update_lead(p_org_id uuid, p_lead_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); l public.leads;
begin
  if p_status not in ('new', 'contacted', 'won', 'lost') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.leads set status = p_status where id = p_lead_id and dealer_org_id = actor returning * into l;
  if l.id is null then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'lead', to_jsonb(l));
end $$;

-- Leads are personal data: removed after 24 months (SPEC §15 retention; run by the daily job).
create or replace function app.purge_old_leads()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.leads where created_at < now() - interval '24 months';
  get diagnostics n = row_count;
  return n;
end $$;

-- Trade-in view for the dealer before the owner has approved: yes/no financing and the holder (SPEC §2.6 "handlare vid
-- inbyte" sees the holder) plus a short history, found by label code or reg number.
create or replace function public.trade_in_lookup(p_org_id uuid, p_code text default null, p_reg text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'member', false); m public.machines; l public.labels; fin public.encumbrances; t public.transfers;
begin
  if not app.has_org_type(actor, 'dealer') then perform app.raise('FORBIDDEN'); end if;
  if p_code is not null then
    select * into l from public.labels where code = p_code;
    select * into m from public.machines where id = l.machine_id;
  else
    select * into m from public.machines where reg_number = app.normalize_reg_number(p_reg);
  end if;
  if m.id is null or m.status = 'draft' then perform app.raise('NOT_FOUND'); end if;
  fin := app.active_financing(m.id);
  select * into t from public.transfers where machine_id = m.id and status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1;
  perform app.after_lookup(actor, array[m.id], 'scan');
  return jsonb_build_object('machine', app.machine_view(m.id, actor),
    'financing', jsonb_build_object('has_active', fin.id is not null, 'type', fin.type,
      'holder', case when fin.id is not null then (select name from public.organizations where id = fin.holder_org_id) end),
    'history', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'created_at', e.created_at) order by e.seq desc)
      from (select * from public.events where machine_id = m.id and type in ('machine.registered', 'ownership.transferred', 'machine.verified',
            'encumbrance.registered', 'encumbrance.released', 'flag.raised', 'flag.cleared', 'inspection.recorded') order by seq desc limit 20) e), '[]'::jsonb),
    'open_transfer', app.transfer_json(t),
    'is_owner', m.owner_org_id = actor);
end $$;

grant execute on function
  public.set_stock_status(uuid, uuid, text), public.sell_machine(uuid, uuid, jsonb, date, jsonb, uuid[], boolean),
  public.list_sales(uuid, int), public.list_customers(uuid), public.list_leads(uuid), public.update_lead(uuid, uuid, text),
  public.trade_in_lookup(uuid, text, text)
  to authenticated;
grant execute on function public.public_ad_card(text) to anon, authenticated;
