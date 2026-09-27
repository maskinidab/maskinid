-- Step 23 (interpreted, SPEC §20.9 missing – ADR 0020): plans, price list, usage metering, monthly invoices and
-- Stripe (test mode) behind the Payments adapter. Registration is always free.
--
-- CLAUDE.md rule 5 ("inga belopp i registret") concerns register data about machines: purchase prices, loan amounts,
-- outstanding debt. The amounts here are our own list prices and invoices to customers; they live in billing tables
-- only, never in machines/events/receipts, and no billing amount is ever written to the event chain.
-- All amounts are integers in öre, excluding VAT; VAT is computed per invoice and shown separately.

-- ---------- Price list and plans ----------
create table public.price_items (
  key            text primary key check (key in ('check', 'api_call', 'register_extract', 'label_qr', 'label_nfc')),
  unit_price_ore int not null check (unit_price_ore between 0 and 100000000),
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

create table public.plans (
  key             text primary key check (key ~ '^[a-z_]{2,30}$'),
  sort            int not null default 0,
  org_types       public.org_type[] not null,
  monthly_fee_ore int not null default 0 check (monthly_fee_ore >= 0),
  included        jsonb not null default '{}'::jsonb,   -- { metric: quantity per month }
  unit_prices     jsonb not null default '{}'::jsonb,   -- { metric: öre } overrides price_items
  is_public       boolean not null default true,        -- shown on /pricing
  contact_sales   boolean not null default false,
  active          boolean not null default true
);

create table public.subscriptions (
  org_id                   uuid primary key references public.organizations (id),
  plan_key                 text not null references public.plans (key),
  status                   text not null default 'active' check (status in ('active', 'past_due', 'canceled')),
  started_at               timestamptz not null default now(),
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  provider                 text check (provider in ('stripe', 'mock')),
  provider_customer_id     text,
  provider_subscription_id text,
  billing_email            text check (billing_email is null or billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invoice_reference        text check (length(invoice_reference) <= 60),
  updated_at               timestamptz not null default now()
);

create table public.usage_records (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations (id),
  metric      text not null check (metric in ('check', 'api_call', 'register_extract', 'label_qr', 'label_nfc')),
  quantity    int not null check (quantity > 0),
  period      date not null,
  ref         text not null,
  occurred_at timestamptz not null default now(),
  unique (metric, ref)
);
create index usage_records_org_period_idx on public.usage_records (org_id, period);

create sequence public.invoice_number_seq;
create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id),
  number              text not null unique,
  period              date not null,
  plan_key            text,
  lines               jsonb not null,
  subtotal_ore        bigint not null,
  vat_rate            numeric(4, 3) not null,
  vat_ore             bigint not null,
  total_ore           bigint not null,
  currency            text not null default 'SEK',
  status              text not null default 'open' check (status in ('open', 'paid', 'void')),
  issued_at           timestamptz not null default now(),
  due_date            date not null,
  paid_at             timestamptz,
  provider            text check (provider in ('stripe', 'mock', 'manual')),
  provider_invoice_id text unique,
  provider_url        text,
  buyer               jsonb not null,
  unique (org_id, period)
);

create table public.billing_events (
  provider          text not null,
  provider_event_id text not null,
  type              text not null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

alter table public.price_items enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_records enable row level security;
alter table public.invoices enable row level security;
alter table public.billing_events enable row level security;
-- Default deny: no policies. Everything goes through the RPCs below.

insert into public.price_items (key, unit_price_ore) values
  ('check', 4900), ('api_call', 50), ('register_extract', 9900), ('label_qr', 2000), ('label_nfc', 4500);

insert into public.plans (key, sort, org_types, monthly_fee_ore, included, unit_prices, is_public, contact_sales) values
  ('free', 10, array['owner', 'dealer', 'client', 'manufacturer']::public.org_type[], 0, '{"check": 3}', '{}', true, false),
  ('dealer', 20, array['dealer']::public.org_type[], 99000, '{"check": 50, "api_call": 5000}', '{"check": 2900, "api_call": 20}', true, false),
  ('financier', 30, array['financier']::public.org_type[], 490000, '{"check": 500, "api_call": 20000}', '{"check": 1500, "api_call": 20}', true, false),
  ('insurer', 40, array['insurer']::public.org_type[], 290000, '{"check": 300, "api_call": 20000}', '{"check": 1500, "api_call": 20}', true, false),
  ('marketplace', 50, array['marketplace']::public.org_type[], 290000, '{"api_call": 100000}', '{"api_call": 5}', true, false),
  ('enterprise', 60, array['dealer', 'financier', 'insurer', 'marketplace']::public.org_type[], 0, '{}', '{}', true, true),
  -- Authorities, inspection bodies and the register keeper are not billed.
  ('public_sector', 90, array['authority', 'inspector', 'operator']::public.org_type[], 0, '{}',
   '{"check": 0, "api_call": 0, "register_extract": 0, "label_qr": 0, "label_nfc": 0}', false, false);

insert into public.app_config (key, value, description) values
  ('BILLING_VAT_RATE', '0.25', 'VAT rate applied to invoices (moms)'),
  ('BILLING_PAYMENT_DAYS', '30', 'Days until an invoice is due')
on conflict (key) do nothing;

-- ---------- Helpers ----------
create or replace function app.billing_period(p_at timestamptz default now())
returns date language sql stable set search_path = '' as $$
  select date_trunc('month', p_at at time zone 'Europe/Stockholm')::date
$$;

-- The plan an org is on: its subscription, else public_sector for authorities/inspectors/operator, else free.
create or replace function app.org_plan(p_org uuid)
returns public.plans language sql stable security definer set search_path = '' as $$
  select p.* from public.plans p where p.key = coalesce(
    (select s.plan_key from public.subscriptions s where s.org_id = p_org and s.status <> 'canceled'),
    case when (select o.types && array['authority', 'inspector', 'operator']::public.org_type[] from public.organizations o where o.id = p_org)
         then 'public_sector' else 'free' end)
$$;

create or replace function app.unit_price(p public.plans, p_metric text)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((p.unit_prices ->> p_metric)::int, (select unit_price_ore from public.price_items where key = p_metric), 0)
$$;

create or replace function app.plan_json(p public.plans)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('key', p.key, 'org_types', p.org_types, 'monthly_fee_ore', p.monthly_fee_ore, 'included', p.included,
    'unit_prices', (select jsonb_object_agg(i.key, app.unit_price(p, i.key)) from public.price_items i),
    'contact_sales', p.contact_sales, 'is_public', p.is_public)
$$;

create or replace function app.payments_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.flag('FEATURE_PAYMENTS') or app.is_demo_mode()
$$;

create or replace function app.record_usage(p_org uuid, p_metric text, p_quantity int, p_ref text, p_at timestamptz default now())
returns void language sql security definer set search_path = '' as $$
  insert into public.usage_records (org_id, metric, quantity, period, ref, occurred_at)
  select p_org, p_metric, p_quantity, app.billing_period(p_at), p_ref, p_at
  where p_org is not null and p_quantity > 0
  on conflict (metric, ref) do nothing
$$;

-- Usage per metric for a period: used, included, billable, unit price, amount (öre, excl. VAT).
create or replace function app.usage_summary(p_org uuid, p_period date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with p as (select * from app.org_plan(p_org)),
  u as (select i.key metric, coalesce((select sum(quantity) from public.usage_records r
          where r.org_id = p_org and r.period = p_period and r.metric = i.key), 0)::int used
        from public.price_items i)
  select coalesce(jsonb_agg(jsonb_build_object('metric', u.metric, 'used', u.used,
      'included', coalesce((p.included ->> u.metric)::int, 0),
      'billable', greatest(u.used - coalesce((p.included ->> u.metric)::int, 0), 0),
      'unit_price_ore', app.unit_price(p, u.metric),
      'amount_ore', greatest(u.used - coalesce((p.included ->> u.metric)::int, 0), 0)::bigint * app.unit_price(p, u.metric))
    order by u.metric), '[]'::jsonb)
  from u cross join p
$$;

-- ---------- Metering (triggers on the tables where billable things already happen) ----------
create or replace function app.meter_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.record_usage(new.performed_by_org_id, 'check', 1, 'check:' || new.id, new.created_at);
  return new;
end $$;
create trigger check_receipts_meter after insert on public.check_receipts for each row execute function app.meter_check();

create or replace function app.meter_api() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Server errors and rate-limited calls are not billed.
  if new.status_code < 500 and new.status_code <> 429 then
    perform app.record_usage(new.org_id, 'api_call', 1, 'api:' || new.id, new.created_at);
  end if;
  return new;
end $$;
create trigger api_requests_meter after insert on public.api_requests for each row execute function app.meter_api();

create or replace function app.meter_snapshot() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'register_extract' then
    perform app.record_usage(new.org_id, 'register_extract', 1, 'extract:' || new.id, new.created_at);
  end if;
  return new;
end $$;
create trigger report_snapshots_meter after insert on public.report_snapshots for each row execute function app.meter_snapshot();

create or replace function app.meter_labels() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only customer orders are billed; batches the operator prints on its own initiative are not.
  if new.ordered_by_org_id is not null then
    perform app.record_usage(new.ordered_by_org_id, case when new.medium = 'nfc' then 'label_nfc' else 'label_qr' end,
      new.quantity, 'labels:' || new.id, new.created_at);
  end if;
  return new;
end $$;
create trigger label_batches_meter after insert on public.label_batches for each row execute function app.meter_labels();

-- ---------- Public: plans and prices (/pricing) ----------
create or replace function public.list_plans()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(app.plan_json(p) order by p.sort) from public.plans p where p.is_public and p.active), '[]'::jsonb),
    'price_items', (select jsonb_object_agg(key, unit_price_ore) from public.price_items),
    'vat_rate', app.config_text('BILLING_VAT_RATE', '0.25')::numeric,
    'currency', 'SEK')
$$;

-- ---------- Customer: billing overview (org admins) ----------
create or replace function app.invoice_json(i public.invoices, p_lines boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'number', i.number, 'period', i.period, 'plan_key', i.plan_key, 'subtotal_ore', i.subtotal_ore,
    'vat_rate', i.vat_rate, 'vat_ore', i.vat_ore, 'total_ore', i.total_ore, 'currency', i.currency, 'status', i.status,
    'issued_at', i.issued_at, 'due_date', i.due_date, 'paid_at', i.paid_at, 'provider', i.provider, 'provider_url', i.provider_url,
    'overdue', i.status = 'open' and i.due_date < current_date)
    || case when p_lines then jsonb_build_object('lines', i.lines, 'buyer', i.buyer) else '{}'::jsonb end
$$;

create or replace function public.get_billing(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin', false); p public.plans := app.org_plan(actor); s public.subscriptions;
  per date := app.billing_period(); usage jsonb := app.usage_summary(actor, per); sub bigint; vat numeric := app.config_text('BILLING_VAT_RATE', '0.25')::numeric;
begin
  select * into s from public.subscriptions where org_id = actor;
  sub := p.monthly_fee_ore + coalesce((select sum((x ->> 'amount_ore')::bigint) from jsonb_array_elements(usage) x), 0);
  return jsonb_build_object(
    'plan', app.plan_json(p),
    'subscription', case when s.org_id is not null then jsonb_build_object('status', s.status, 'started_at', s.started_at,
      'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end, 'provider', s.provider,
      'has_payment_method', s.provider_customer_id is not null) end,
    'billing_email', coalesce(s.billing_email, (select email from public.profiles where user_id = auth.uid())),
    'invoice_reference', s.invoice_reference,
    'period', per, 'usage', usage,
    'estimate', jsonb_build_object('subtotal_ore', sub, 'vat_ore', round(sub * vat)::bigint, 'total_ore', sub + round(sub * vat)::bigint, 'vat_rate', vat),
    'available_plans', coalesce((select jsonb_agg(app.plan_json(x) order by x.sort) from public.plans x
      where x.is_public and x.active and x.org_types && (select types from public.organizations where id = actor)), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(app.invoice_json(i, false) order by i.period desc) from public.invoices i where i.org_id = actor), '[]'::jsonb),
    'payments_enabled', app.payments_enabled(),
    'demo', app.is_demo_mode());
end $$;

create or replace function public.get_invoice(p_org_id uuid, p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice_id;
  if i.id is null then perform app.raise('NOT_FOUND'); end if;
  if not app.is_operator('support') then
    if app.require_actor(p_org_id, 'admin', false) is distinct from i.org_id then perform app.raise('NOT_FOUND'); end if;
  end if;
  return app.invoice_json(i, true);
end $$;

create or replace function public.set_billing_details(p_org_id uuid, p_email text, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin', false);
begin
  insert into public.subscriptions (org_id, plan_key, billing_email, invoice_reference)
  values (actor, (app.org_plan(actor)).key, nullif(trim(p_email), ''), nullif(trim(p_reference), ''))
  on conflict (org_id) do update set billing_email = excluded.billing_email, invoice_reference = excluded.invoice_reference, updated_at = now();
  return jsonb_build_object('ok', true);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"billing_email"}');
end $$;

-- Plan checks shared by choose_plan and the checkout function: the plan must be public, active and fit the org's types.
create or replace function app.plan_for_org(p_org uuid, p_plan text)
returns public.plans language plpgsql stable security definer set search_path = '' as $$
declare p public.plans;
begin
  select * into p from public.plans where key = p_plan and active and is_public and not contact_sales
    and org_types && (select types from public.organizations where id = p_org);
  if p.key is null then perform app.raise('VALIDATION', '{"field":"plan"}'); end if;
  return p;
end $$;

-- Free plans switch at once. Plans with a monthly fee go through checkout (Edge Function "billing" ⇒ Stripe or mock).
create or replace function public.choose_plan(p_org_id uuid, p_plan_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); p public.plans := app.plan_for_org(actor, p_plan_key);
begin
  if p.monthly_fee_ore > 0 then perform app.raise('PAYMENT_REQUIRED'); end if;
  insert into public.subscriptions (org_id, plan_key, status) values (actor, p.key, 'active')
  on conflict (org_id) do update set plan_key = excluded.plan_key, status = 'active', cancel_at_period_end = false, updated_at = now();
  perform app.log_event('billing.plan_changed', null, actor, actor, jsonb_build_object('plan', p.key));
  return jsonb_build_object('ok', true, 'plan', p.key);
end $$;

-- Called by the billing function as the user before creating a checkout session.
create or replace function public.billing_checkout_context(p_org_id uuid, p_plan_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin'); p public.plans := app.plan_for_org(actor, p_plan_key); s public.subscriptions;
begin
  if not app.payments_enabled() then perform app.raise('PAYMENTS_DISABLED'); end if;
  select * into s from public.subscriptions where org_id = actor;
  return jsonb_build_object('org_id', actor, 'org_slug', (select slug from public.organizations where id = actor),
    'org_name', (select name from public.organizations where id = actor), 'plan', app.plan_json(p),
    'email', coalesce(s.billing_email, (select email from public.profiles where user_id = auth.uid())),
    'customer_id', s.provider_customer_id, 'subscription_id', s.provider_subscription_id);
end $$;

-- ---------- Service (Edge Functions): apply subscription, provider events, invoices ----------
create or replace function public.billing_apply_subscription(p_org_id uuid, p_plan_key text, p_status text, p_provider text,
  p_customer_id text, p_subscription_id text, p_period_end timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prev text;
begin
  if not exists (select 1 from public.plans where key = p_plan_key) then perform app.raise('VALIDATION', '{"field":"plan"}'); end if;
  select plan_key into prev from public.subscriptions where org_id = p_org_id;
  insert into public.subscriptions (org_id, plan_key, status, provider, provider_customer_id, provider_subscription_id, current_period_end)
  values (p_org_id, p_plan_key, p_status, p_provider, p_customer_id, p_subscription_id, p_period_end)
  on conflict (org_id) do update set plan_key = excluded.plan_key, status = excluded.status, provider = excluded.provider,
    provider_customer_id = coalesce(excluded.provider_customer_id, public.subscriptions.provider_customer_id),
    provider_subscription_id = coalesce(excluded.provider_subscription_id, public.subscriptions.provider_subscription_id),
    current_period_end = excluded.current_period_end, cancel_at_period_end = false, updated_at = now();
  if prev is distinct from p_plan_key then
    perform app.log_event('billing.plan_changed', null, p_org_id, null, jsonb_build_object('plan', p_plan_key));
    perform app.notify_org(p_org_id, 'billing.plan_changed', jsonb_build_object('plan', p_plan_key), '/settings?tab=billing', 'info', 'admin');
  end if;
  return jsonb_build_object('ok', true);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"subscription"}');
end $$;

-- Provider webhooks, idempotent per event id. Returns {duplicate:true} for an event already seen.
create or replace function public.billing_record_event(p_provider text, p_event_id text, p_type text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o jsonb := coalesce(p_payload -> 'data' -> 'object', p_payload); org uuid; i public.invoices; st text;
begin
  insert into public.billing_events (provider, provider_event_id, type, payload) values (p_provider, p_event_id, p_type, p_payload)
  on conflict do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if p_type = 'checkout.session.completed' then
    org := nullif(o -> 'metadata' ->> 'org_id', '')::uuid;
    if org is not null and o -> 'metadata' ->> 'plan' is not null then
      perform public.billing_apply_subscription(org, o -> 'metadata' ->> 'plan', 'active', p_provider, o ->> 'customer', o ->> 'subscription', null);
    end if;
  elsif p_type in ('customer.subscription.updated', 'customer.subscription.deleted') then
    st := case when p_type = 'customer.subscription.deleted' or o ->> 'status' in ('canceled', 'incomplete_expired') then 'canceled'
               when o ->> 'status' in ('past_due', 'unpaid') then 'past_due' else 'active' end;
    update public.subscriptions set status = st, cancel_at_period_end = coalesce((o ->> 'cancel_at_period_end')::boolean, false),
      current_period_end = case when o ? 'current_period_end' then to_timestamp((o ->> 'current_period_end')::bigint) else current_period_end end,
      updated_at = now()
    where provider_subscription_id = o ->> 'id' returning org_id into org;
    if org is not null and st <> 'active' then
      perform app.notify_org(org, 'billing.subscription_' || st, '{}'::jsonb, '/settings?tab=billing', 'warning', 'admin');
    end if;
  elsif p_type in ('invoice.paid', 'invoice.payment_failed', 'invoice.voided') then
    select * into i from public.invoices where provider_invoice_id = o ->> 'id' for update;
    if i.id is not null then
      if p_type = 'invoice.paid' then
        update public.invoices set status = 'paid', paid_at = now() where id = i.id;
      elsif p_type = 'invoice.voided' then
        update public.invoices set status = 'void' where id = i.id;
      else
        perform app.notify_org(i.org_id, 'billing.payment_failed', jsonb_build_object('number', i.number), '/settings?tab=billing', 'warning', 'admin');
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Monthly invoicing (cron, day 1): one invoice per org and period with fee + usage above what the plan includes.
-- Idempotent: an org already invoiced for the period is skipped. Orgs with nothing to pay get no invoice.
create or replace function public.close_billing_period(p_period date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare per date := coalesce(p_period, (app.billing_period() - interval '1 month')::date); r record; p public.plans; lines jsonb; sub bigint;
  vat numeric := app.config_text('BILLING_VAT_RATE', '0.25')::numeric; days int := app.config_text('BILLING_PAYMENT_DAYS', '30')::int;
  created int := 0; inv public.invoices; s public.subscriptions; o public.organizations; mail text;
begin
  if per >= app.billing_period() then perform app.raise('VALIDATION', '{"field":"period"}'); end if;
  for r in select x.org_id from (select org_id from public.usage_records where period = per
                                 union select org_id from public.subscriptions where status <> 'canceled' and started_at < (per + interval '1 month')) x
           where not exists (select 1 from public.invoices i where i.org_id = x.org_id and i.period = per) loop
    p := app.org_plan(r.org_id);
    select * into s from public.subscriptions where org_id = r.org_id;
    select * into o from public.organizations where id = r.org_id;
    mail := coalesce(s.billing_email, o.email, (select p2.email from public.memberships ms join public.profiles p2 on p2.user_id = ms.user_id
      where ms.org_id = r.org_id and ms.role = 'admin' and ms.status = 'active' order by ms.created_at limit 1));
    lines := '[]'::jsonb;
    if p.monthly_fee_ore > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('kind', 'plan', 'item', p.key, 'quantity', 1, 'unit_price_ore', p.monthly_fee_ore,
        'amount_ore', p.monthly_fee_ore));
    end if;
    lines := lines || coalesce((select jsonb_agg(jsonb_build_object('kind', 'usage', 'item', x ->> 'metric', 'used', (x ->> 'used')::int,
        'included', (x ->> 'included')::int, 'quantity', (x ->> 'billable')::int, 'unit_price_ore', (x ->> 'unit_price_ore')::int,
        'amount_ore', (x ->> 'amount_ore')::bigint))
      from jsonb_array_elements(app.usage_summary(r.org_id, per)) x where (x ->> 'amount_ore')::bigint > 0), '[]'::jsonb);
    sub := coalesce((select sum((l ->> 'amount_ore')::bigint) from jsonb_array_elements(lines) l), 0);
    continue when sub = 0;
    insert into public.invoices (org_id, number, period, plan_key, lines, subtotal_ore, vat_rate, vat_ore, total_ore, due_date, provider, buyer)
    values (r.org_id, 'INV-' || to_char(per, 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'), per, p.key, lines,
      sub, vat, round(sub * vat)::bigint, sub + round(sub * vat)::bigint, current_date + days,
      case when s.provider_customer_id is not null then s.provider else 'manual' end,
      jsonb_build_object('name', o.name, 'org_number', case when o.is_sole_trader then null else o.org_number end,
        'address', o.address, 'email', mail, 'reference', s.invoice_reference))
    returning * into inv;
    created := created + 1;
    perform app.notify_org(r.org_id, 'billing.invoice_issued', jsonb_build_object('number', inv.number, 'period', to_char(per, 'YYYY-MM'),
      'due_date', inv.due_date), '/settings?tab=billing', 'info', 'admin');
    if mail is not null then
      insert into public.email_outbox (to_email, template, data) values (mail, 'invoice',
        jsonb_build_object('number', inv.number, 'period', to_char(per, 'YYYY-MM'), 'due_date', inv.due_date, 'org_name', o.name,
          'total_ore', inv.total_ore, 'org_slug', o.slug));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'period', per, 'created', created);
end $$;

-- After the Edge Function has created the invoice at the provider.
create or replace function public.billing_set_invoice_provider(p_invoice_id uuid, p_provider_invoice_id text, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.invoices set provider_invoice_id = p_provider_invoice_id, provider_url = p_url where id = p_invoice_id;
  if not found then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Invoices waiting to be pushed to the provider (Edge Function billing-sync).
create or replace function public.billing_pending_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app.invoice_json(i, true) || jsonb_build_object('org_id', i.org_id,
      'customer_id', (select provider_customer_id from public.subscriptions s where s.org_id = i.org_id)) order by i.issued_at), '[]'::jsonb)
  from public.invoices i where i.status = 'open' and i.provider = 'stripe' and i.provider_invoice_id is null
$$;

-- Demo only: "pay" an invoice with the mock provider.
create or replace function public.billing_mock_pay(p_org_id uuid, p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'admin');
begin
  if not app.is_demo_mode() then perform app.raise('MOCK_PROVIDER_DISABLED'); end if;
  update public.invoices set status = 'paid', paid_at = now(), provider = coalesce(provider, 'mock')
  where id = p_invoice_id and org_id = actor and status = 'open';
  if not found then perform app.raise('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Operator ----------
create or replace function public.admin_billing_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare per date := app.billing_period();
begin
  perform app.require_operator('support');
  return jsonb_build_object(
    'period', per,
    'price_items', (select jsonb_agg(jsonb_build_object('key', key, 'unit_price_ore', unit_price_ore, 'updated_at', updated_at) order by key) from public.price_items),
    'plans', (select jsonb_agg(app.plan_json(p) || jsonb_build_object('active', p.active,
        'orgs', (select count(*) from public.subscriptions s where s.plan_key = p.key and s.status <> 'canceled')) order by p.sort) from public.plans p),
    'usage', (select coalesce(jsonb_object_agg(metric, n), '{}'::jsonb) from (select metric, sum(quantity)::int n from public.usage_records where period = per group by 1) x),
    'invoices', coalesce((select jsonb_agg(app.invoice_json(i, false) || jsonb_build_object('org', app.org_brief(i.org_id)) order by i.issued_at desc)
      from (select * from public.invoices order by issued_at desc limit 200) i), '[]'::jsonb),
    'open_total_ore', (select coalesce(sum(total_ore), 0) from public.invoices where status = 'open'),
    'payments_enabled', app.payments_enabled());
end $$;

create or replace function public.admin_set_price(p_key text, p_unit_price_ore int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare old int;
begin
  perform app.require_operator('superadmin');
  select unit_price_ore into old from public.price_items where key = p_key for update;
  if not found then perform app.raise('NOT_FOUND'); end if;
  update public.price_items set unit_price_ore = p_unit_price_ore, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform app.audit('billing.price_set', 'price_item', p_key, jsonb_build_object('from', old, 'to', p_unit_price_ore));
  return jsonb_build_object('ok', true);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"unit_price_ore"}');
end $$;

create or replace function public.admin_set_plan(p_key text, p_monthly_fee_ore int, p_included jsonb, p_unit_prices jsonb, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_operator('superadmin');
  if jsonb_typeof(coalesce(p_included, '{}')) <> 'object' or jsonb_typeof(coalesce(p_unit_prices, '{}')) <> 'object'
     or exists (select 1 from jsonb_each(coalesce(p_included, '{}') || coalesce(p_unit_prices, '{}')) e
                where e.key not in (select key from public.price_items) or jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0) then
    perform app.raise('VALIDATION', '{"field":"plan"}');
  end if;
  update public.plans set monthly_fee_ore = p_monthly_fee_ore, included = coalesce(p_included, '{}'), unit_prices = coalesce(p_unit_prices, '{}'),
    active = coalesce(p_active, active) where key = p_key;
  if not found then perform app.raise('NOT_FOUND'); end if;
  perform app.audit('billing.plan_set', 'plan', p_key, jsonb_build_object('monthly_fee_ore', p_monthly_fee_ore));
  return jsonb_build_object('ok', true);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"plan"}');
end $$;

create or replace function public.admin_close_billing_period(p_period date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform app.require_operator('superadmin');
  r := public.close_billing_period(p_period);
  perform app.audit('billing.period_closed', 'billing_period', (r ->> 'period'), r);
  return r;
end $$;

create or replace function public.admin_set_invoice_status(p_invoice_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_operator('superadmin');
  if p_status not in ('paid', 'void') then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.invoices set status = p_status, paid_at = case when p_status = 'paid' then now() end where id = p_invoice_id and status = 'open';
  if not found then perform app.raise('NOT_FOUND'); end if;
  perform app.audit('billing.invoice_' || p_status, 'invoice', p_invoice_id::text);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz),
  public.billing_record_event(text, text, text, jsonb), public.close_billing_period(date),
  public.billing_set_invoice_provider(uuid, text, text), public.billing_pending_invoices() from public, anon, authenticated;
grant execute on function public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz),
  public.billing_record_event(text, text, text, jsonb), public.close_billing_period(date),
  public.billing_set_invoice_provider(uuid, text, text), public.billing_pending_invoices() to service_role;
grant execute on function public.list_plans() to anon, authenticated;
grant execute on function public.get_billing(uuid), public.get_invoice(uuid, uuid), public.set_billing_details(uuid, text, text),
  public.choose_plan(uuid, text), public.billing_checkout_context(uuid, text), public.billing_mock_pay(uuid, uuid),
  public.admin_billing_overview(), public.admin_set_price(text, int), public.admin_set_plan(text, int, jsonb, jsonb, boolean),
  public.admin_close_billing_period(date), public.admin_set_invoice_status(uuid, text) to authenticated;
select app.grant_api_access();
