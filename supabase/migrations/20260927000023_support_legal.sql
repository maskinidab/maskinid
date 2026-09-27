-- Step 22 (interpreted from CLAUDE.md, ADR 0003 / 0019): tips, public stolen list, support tickets, legal documents
-- with acceptance, account security log and read-only "view as organisation" for operator support.

-- =====================================================================================================================
-- Tips (anyone): "I have seen this machine" / "this listing looks wrong". Matched to a machine when possible;
-- a tip about a stolen machine reaches the owner and the flagging organisation. Contact details are optional and
-- only visible to the operator.
-- =====================================================================================================================
create table public.tips (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('seen_machine', 'suspicious_listing', 'suspicious_sale', 'other')),
  reg_or_serial text check (length(reg_or_serial) <= 64),
  machine_id   uuid references public.machines (id),
  message      text not null check (length(trim(message)) between 5 and 2000),
  location     jsonb,
  listing_url  text check (listing_url is null or listing_url ~ '^https?://' and length(listing_url) <= 500),
  contact      text check (length(contact) <= 200),
  ip_hash      text,
  status       text not null default 'new' check (status in ('new', 'forwarded', 'closed')),
  reviewed_by  uuid,
  review_note  text,
  created_at   timestamptz not null default now()
);
alter table public.tips enable row level security;
revoke all on public.tips from anon, authenticated;

create or replace function public.submit_tip(p_kind text, p_reg_or_serial text, p_message text, p_location jsonb default null,
  p_listing_url text default null, p_contact text default null, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tp public.tips; m public.machines; n text := app.normalize_identifier(p_reg_or_serial);
begin
  if p_ip_hash is not null and not app.rate_limit_hit('tip:' || p_ip_hash, 5, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  if n is not null then
    select * into m from public.machines x where x.status <> 'draft' and (x.reg_number = n or exists (select 1 from public.machine_identifiers i
      where i.machine_id = x.id and i.normalized_value = n)) limit 1;
  end if;
  insert into public.tips (kind, reg_or_serial, machine_id, message, location, listing_url, contact, ip_hash)
  values (coalesce(p_kind, 'other'), left(nullif(trim(p_reg_or_serial), ''), 64), m.id, trim(p_message),
    case when jsonb_typeof(p_location) = 'object' then jsonb_build_object('city', left(p_location ->> 'city', 80),
      'lat', round((p_location ->> 'lat')::numeric, 2), 'lng', round((p_location ->> 'lng')::numeric, 2)) end,
    nullif(trim(p_listing_url), ''), nullif(trim(p_contact), ''), p_ip_hash) returning * into tp;
  if m.id is not null then
    perform app.log_event('tip.received', m.id, m.owner_org_id, null, jsonb_build_object('tip_id', tp.id, 'kind', tp.kind));
    if m.status = 'stolen' then
      -- The owner and whoever flagged the machine hear about it at once; contact details stay with the operator.
      perform app.notify_org(x, 'tip.stolen_machine', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id,
        'city', tp.location ->> 'city', 'message', left(tp.message, 300)), '/machines/' || m.id, 'critical')
      from (select distinct unnest(array_remove(array[m.owner_org_id] || array(select f.raised_by_org_id from public.flags f
        where f.machine_id = m.id and f.status = 'active' and f.type = 'stolen'), null)) x) o;
    end if;
  end if;
  perform app.notify_operators('tip.received', jsonb_build_object('tip_id', tp.id, 'kind', tp.kind, 'reg_number', m.reg_number), '/admin/tips',
    case when m.status = 'stolen' then 'warning' else 'info' end::public.notification_severity, 'support');
  return jsonb_build_object('ok', true, 'matched', m.id is not null);
exception when check_violation or invalid_text_representation then
  perform app.raise('VALIDATION', '{"field":"tip"}');
end $$;

create or replace function public.admin_list_tips(p_status text default 'new')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  perform app.audit('tips.list', null, null, jsonb_build_object('status', p_status));
  return coalesce((select jsonb_agg(to_jsonb(tp) - 'ip_hash' || jsonb_build_object('machine', (select jsonb_build_object('id', m.id, 'reg_number', m.reg_number,
      'make', m.make, 'model', m.model, 'status', m.status) from public.machines m where m.id = tp.machine_id)) order by tp.created_at desc)
    from public.tips tp where p_status is null or tp.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_review_tip(p_tip_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); tp public.tips; m public.machines;
begin
  update public.tips set status = p_status, reviewed_by = auth.uid(), review_note = nullif(trim(p_note), '') where id = p_tip_id returning * into tp;
  if tp.id is null then perform app.raise('NOT_FOUND'); end if;
  -- Forwarding goes to the authorities that flagged the machine (and the owner); never to the public.
  if p_status = 'forwarded' and tp.machine_id is not null then
    select * into m from public.machines where id = tp.machine_id;
    perform app.notify_org(f.raised_by_org_id, 'tip.forwarded', jsonb_build_object('reg_number', m.reg_number, 'machine_id', m.id,
      'message', left(tp.message, 500), 'contact', tp.contact), '/machines/' || m.id, 'warning')
    from public.flags f where f.machine_id = m.id and f.status = 'active' and app.has_org_type(f.raised_by_org_id, 'authority');
  end if;
  perform app.audit('tips.review', 'tip', tp.id::text, jsonb_build_object('status', p_status));
  return to_jsonb(tp) - 'ip_hash';
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"status"}');
end $$;

-- =====================================================================================================================
-- Public stolen list: only flags whose owner or the police chose to publish. Shows the machine, not the owner.
-- =====================================================================================================================
alter table public.flags add column publish_public boolean not null default false;

create or replace function public.set_flag_public(p_org_id uuid, p_flag_id uuid, p_public boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); f public.flags; m public.machines;
begin
  select * into f from public.flags where id = p_flag_id for update;
  if f.id is null or f.status <> 'active' or f.type <> 'stolen' then perform app.raise('NOT_FOUND'); end if;
  select * into m from public.machines where id = f.machine_id;
  if actor is distinct from f.raised_by_org_id and actor is distinct from m.owner_org_id and not app.has_org_type(actor, 'authority') then
    perform app.raise('FORBIDDEN');
  end if;
  update public.flags set publish_public = coalesce(p_public, false) where id = f.id returning * into f;
  perform app.log_event(case when f.publish_public then 'flag.published' else 'flag.unpublished' end, m.id, m.owner_org_id, actor, jsonb_build_object('flag_id', f.id));
  return jsonb_build_object('ok', true, 'publish_public', f.publish_public);
end $$;

create or replace function public.public_stolen_list(p_category public.machine_category default null, p_county text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(x order by x ->> 'stolen_at' desc) from (
    select jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model, 'year', m.year, 'category', m.category,
      'color', m.color, 'stolen_at', f.raised_at, 'place', coalesce(app.county_for_city(nullif(split_part(f.location_text, ',', 1), '')), null),
      'label', exists (select 1 from public.labels l where l.machine_id = m.id and l.status = 'bound')) x
    from public.flags f join public.machines m on m.id = f.machine_id
    where f.type = 'stolen' and f.status = 'active' and f.publish_public and m.status = 'stolen'
      and (p_category is null or m.category = p_category)
      and (p_county is null or app.county_for_city(nullif(split_part(f.location_text, ',', 1), '')) = p_county)
    order by f.raised_at desc limit 500) s), '[]'::jsonb);
end $$;

-- =====================================================================================================================
-- Support tickets
-- =====================================================================================================================
create table public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  number      bigint generated always as identity,
  org_id      uuid references public.organizations (id),
  user_id     uuid,
  email       text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  category    text not null check (category in ('account', 'machine', 'transfer', 'financing', 'labels', 'api', 'billing', 'privacy', 'other')),
  subject     text not null check (length(trim(subject)) between 3 and 200),
  machine_reg text check (length(machine_reg) <= 20),
  status      text not null default 'open' check (status in ('open', 'waiting_customer', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (user_id is not null or email is not null)
);
create table public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  from_operator boolean not null default false,
  author_user_id uuid,
  body        text not null check (length(trim(body)) between 1 and 5000),
  created_at  timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets, public.support_messages from anon, authenticated;

create or replace function app.ticket_json(t public.support_tickets, p_messages boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(t) || jsonb_build_object('org', app.org_brief(t.org_id), 'user_name', (select full_name from public.profiles where user_id = t.user_id),
    'messages', case when p_messages then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'from_operator', m.from_operator, 'body', m.body,
      'created_at', m.created_at, 'author', case when m.from_operator then 'MaskinID support' else (select full_name from public.profiles where user_id = m.author_user_id) end)
      order by m.created_at) from public.support_messages m where m.ticket_id = t.id), '[]'::jsonb) end,
    'last_message_at', (select max(created_at) from public.support_messages where ticket_id = t.id))
$$;

create or replace function public.create_support_ticket(p_org_id uuid, p_category text, p_subject text, p_body text, p_machine_reg text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); t public.support_tickets;
begin
  if not app.rate_limit_hit('support:' || auth.uid(), 10, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  insert into public.support_tickets (org_id, user_id, email, category, subject, machine_reg)
  values (actor, auth.uid(), (select email from public.profiles where user_id = auth.uid()), coalesce(p_category, 'other'), trim(p_subject),
    app.normalize_reg_number(p_machine_reg)) returning * into t;
  insert into public.support_messages (ticket_id, author_user_id, body) values (t.id, auth.uid(), trim(p_body));
  perform app.notify_operators('support.ticket', jsonb_build_object('ticket_id', t.id, 'number', t.number, 'subject', t.subject), '/admin/support-tickets', 'info', 'support');
  return app.ticket_json(t, true);
exception when check_violation or not_null_violation then
  perform app.raise('VALIDATION', '{"field":"ticket"}');
end $$;

-- Contact form without an account (Edge Function "support", service role, rate limited per IP).
create or replace function public.submit_public_support(p_email text, p_category text, p_subject text, p_body text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  if p_ip_hash is not null and not app.rate_limit_hit('support-public:' || p_ip_hash, 5, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  insert into public.support_tickets (email, category, subject) values (lower(trim(p_email)), coalesce(p_category, 'other'), trim(p_subject)) returning * into t;
  insert into public.support_messages (ticket_id, body) values (t.id, trim(p_body));
  perform app.notify_operators('support.ticket', jsonb_build_object('ticket_id', t.id, 'number', t.number, 'subject', t.subject), '/admin/support-tickets', 'info', 'support');
  return jsonb_build_object('ok', true, 'number', t.number);
exception when check_violation or not_null_violation then
  perform app.raise('VALIDATION', '{"field":"ticket"}');
end $$;

create or replace function public.list_my_tickets(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false);
begin
  return coalesce((select jsonb_agg(app.ticket_json(t, false) order by t.updated_at desc)
    from public.support_tickets t where t.org_id = actor and (t.user_id = auth.uid() or app.is_member_of(actor, 'admin'))), '[]'::jsonb);
end $$;

create or replace function public.get_ticket(p_org_id uuid, p_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid; t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket_id;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  if app.is_operator('support') then
    perform app.audit('support.ticket_view', 'support_ticket', t.id::text);
  else
    actor := app.require_actor(p_org_id, 'readonly', false);
    if t.org_id is distinct from actor or not (t.user_id = auth.uid() or app.is_member_of(actor, 'admin')) then perform app.raise('NOT_FOUND'); end if;
  end if;
  return app.ticket_json(t, true);
end $$;

create or replace function public.add_ticket_message(p_org_id uuid, p_ticket_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets; op boolean := app.is_operator('support'); actor uuid;
begin
  select * into t from public.support_tickets where id = p_ticket_id for update;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  if not op then
    actor := app.require_actor(p_org_id, 'readonly', false);
    if t.org_id is distinct from actor or not (t.user_id = auth.uid() or app.is_member_of(actor, 'admin')) then perform app.raise('NOT_FOUND'); end if;
  end if;
  insert into public.support_messages (ticket_id, from_operator, author_user_id, body) values (t.id, op and actor is null, auth.uid(), trim(p_body));
  update public.support_tickets set updated_at = now(), status = case when op and actor is null then 'waiting_customer' else 'open' end
  where id = t.id returning * into t;
  if op and actor is null then
    if t.user_id is not null then
      perform app.notify_user(t.user_id, t.org_id, 'support.reply', jsonb_build_object('ticket_id', t.id, 'number', t.number, 'subject', t.subject),
        '/support?ticket=' || t.id, 'info');
    elsif t.email is not null then
      insert into public.email_outbox (to_email, template, data) values (t.email, 'support_reply', jsonb_build_object('number', t.number, 'subject', t.subject,
        'body', left(trim(p_body), 4000)));
    end if;
    perform app.audit('support.reply', 'support_ticket', t.id::text);
  else
    perform app.notify_operators('support.customer_reply', jsonb_build_object('ticket_id', t.id, 'number', t.number), '/admin/support-tickets', 'info', 'support');
  end if;
  return app.ticket_json(t, true);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"body"}');
end $$;

create or replace function public.admin_list_tickets(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return coalesce((select jsonb_agg(app.ticket_json(t, false) order by (t.status = 'open') desc, t.updated_at desc)
    from public.support_tickets t where p_status is null or t.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.set_ticket_status(p_org_id uuid, p_ticket_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets; actor uuid;
begin
  if not app.is_operator('support') then
    actor := app.require_actor(p_org_id, 'readonly', false);
    -- Customers may only close their own ticket.
    if p_status <> 'closed' then perform app.raise('FORBIDDEN'); end if;
  end if;
  update public.support_tickets set status = p_status, updated_at = now()
  where id = p_ticket_id and (actor is null or (org_id = actor and (user_id = auth.uid() or app.is_member_of(actor, 'admin')))) returning * into t;
  if t.id is null then perform app.raise('NOT_FOUND'); end if;
  return app.ticket_json(t, false);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"status"}');
end $$;

-- =====================================================================================================================
-- Legal documents with versioned acceptance
-- =====================================================================================================================
create table public.legal_documents (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null check (key in ('terms', 'privacy', 'dpa', 'cookies')),
  version             int not null,
  locale              text not null check (locale in ('sv', 'en')),
  title               text not null,
  body                text not null,
  requires_acceptance boolean not null default false,
  published_at        timestamptz not null default now(),
  published_by        uuid,
  unique (key, version, locale)
);
create table public.legal_acceptances (
  user_id     uuid not null,
  key         text not null,
  version     int not null,
  org_id      uuid references public.organizations (id),
  accepted_at timestamptz not null default now(),
  primary key (user_id, key, version)
);
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_documents, public.legal_acceptances from anon, authenticated;
grant select on public.legal_documents to anon, authenticated;
create policy legal_documents_read on public.legal_documents for select to anon, authenticated using (true);
grant select on public.legal_acceptances to authenticated;
create policy legal_acceptances_read on public.legal_acceptances for select to authenticated using (user_id = auth.uid());

create or replace function app.legal_latest(p_key text)
returns int language sql stable security definer set search_path = '' as $$ select max(version) from public.legal_documents where key = p_key $$;

create or replace function public.list_legal_documents(p_locale text default 'sv')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'version', d.version, 'title', d.title, 'published_at', d.published_at,
    'requires_acceptance', d.requires_acceptance) order by d.key), '[]'::jsonb)
  from public.legal_documents d
  where d.version = app.legal_latest(d.key) and d.locale = (case when p_locale = 'en' and exists (select 1 from public.legal_documents x
    where x.key = d.key and x.version = d.version and x.locale = 'en') then 'en' else 'sv' end)
$$;

create or replace function public.get_legal_document(p_key text, p_locale text default 'sv', p_version int default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(d) - 'published_by' || jsonb_build_object('latest', app.legal_latest(p_key),
    'versions', (select jsonb_agg(distinct v.version) from public.legal_documents v where v.key = p_key))
  from public.legal_documents d
  where d.key = p_key and d.version = coalesce(p_version, app.legal_latest(p_key))
  order by (d.locale = p_locale) desc limit 1
$$;

create or replace function app.legal_pending(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'version', d.version)), '[]'::jsonb)
  from (select distinct key, version from public.legal_documents where requires_acceptance and version = app.legal_latest(key)) d
  where not exists (select 1 from public.legal_acceptances a where a.user_id = p_user and a.key = d.key and a.version = d.version)
$$;

create or replace function public.accept_legal_documents(p_items jsonb, p_org_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i jsonb;
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.legal_documents where key = i ->> 'key' and version = (i ->> 'version')::int) then perform app.raise('NOT_FOUND'); end if;
    insert into public.legal_acceptances (user_id, key, version, org_id) values (auth.uid(), i ->> 'key', (i ->> 'version')::int,
      case when p_org_id is not null and app.is_member_of(p_org_id) then p_org_id end) on conflict do nothing;
  end loop;
  return jsonb_build_object('ok', true, 'pending', app.legal_pending(auth.uid()));
end $$;

create or replace function public.admin_publish_legal(p_key text, p_title_sv text, p_body_sv text, p_title_en text, p_body_en text, p_requires_acceptance boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin'); v int := coalesce(app.legal_latest(p_key), 0) + 1;
begin
  if nullif(trim(p_body_sv), '') is null or nullif(trim(p_title_sv), '') is null then perform app.raise('VALIDATION', '{"field":"body_sv"}'); end if;
  insert into public.legal_documents (key, version, locale, title, body, requires_acceptance, published_by)
  values (p_key, v, 'sv', trim(p_title_sv), p_body_sv, coalesce(p_requires_acceptance, false), auth.uid());
  if nullif(trim(p_body_en), '') is not null then
    insert into public.legal_documents (key, version, locale, title, body, requires_acceptance, published_by)
    values (p_key, v, 'en', coalesce(nullif(trim(p_title_en), ''), trim(p_title_sv)), p_body_en, coalesce(p_requires_acceptance, false), auth.uid());
  end if;
  perform app.log_event('legal.published', null, op, op, jsonb_build_object('key', p_key, 'version', v, 'requires_acceptance', p_requires_acceptance));
  perform app.audit('legal.published', 'legal_document', p_key, jsonb_build_object('version', v));
  return jsonb_build_object('ok', true, 'version', v);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"key"}');
end $$;

insert into public.legal_documents (key, version, locale, title, body, requires_acceptance) values
('terms', 1, 'sv', 'Användarvillkor', $t$MaskinID ("tjänsten") tillhandahålls av MaskinID Sverige AB. Villkoren gäller för dig som använder tjänsten för en organisations räkning.

1. Tjänsten. MaskinID är ett privat register för tunga arbetsmaskiner. Registret visar vem som är registrerad ägare, om det finns registrerad finansiering och maskinens historik. Registret är inte ett officiellt register och registreringen innebär inte bevis om äganderätt i civilrättslig mening.

2. Konto och identitet. Du loggar in med e-post och bekräftar din identitet med BankID innan du gör ändringar. Du ansvarar för att uppgifter du lämnar är riktiga och att du har rätt att företräda organisationen.

3. Rättsliga åtgärder. Ägarbyten, förbehåll, flaggor och avregistrering signeras med BankID och loggas i en händelsekedja som inte kan ändras i efterhand. Rättelser görs genom nya händelser.

4. Uppgifter om andra. Du får bara registrera uppgifter som du har rätt att lämna. Missbruk, till exempel falska stöldanmälningar eller felaktiga förbehåll, leder till avstängning och kan polisanmälas.

5. Tillgänglighet. Vi strävar efter hög tillgänglighet men garanterar inte att tjänsten alltid är tillgänglig. Planerat underhåll meddelas i förväg.

6. Ansvar. MaskinID ansvarar inte för affärsbeslut som fattas utifrån registrets uppgifter. Kontrollera alltid aktuell status och underlag.

7. Ändringar. Vid väsentliga ändringar av villkoren ber vi dig godkänna den nya versionen innan du fortsätter använda tjänsten.

8. Tillämplig lag. Svensk lag gäller. Tvister avgörs av allmän domstol.$t$, true),
('terms', 1, 'en', 'Terms of use', $t$MaskinID ("the service") is provided by MaskinID Sverige AB. These terms apply to you when you use the service on behalf of an organisation.

1. The service. MaskinID is a private register for heavy machinery. It shows the registered owner, whether financing is registered and the machine's history. It is not an official register, and registration is not proof of title in a civil-law sense.

2. Account and identity. You sign in with e-mail and confirm your identity with BankID before making changes. You are responsible for the accuracy of what you submit and for being authorised to represent the organisation.

3. Legal actions. Transfers, encumbrances, flags and deregistration are signed with BankID and logged in an event chain that cannot be altered. Corrections are made as new events.

4. Information about others. Only register information you are entitled to submit. Misuse, such as false theft reports or incorrect encumbrances, leads to suspension and may be reported to the police.

5. Availability. We aim for high availability but do not guarantee uninterrupted service. Planned maintenance is announced in advance.

6. Liability. MaskinID is not liable for business decisions made on the basis of register data. Always check the current status and documents.

7. Changes. For material changes we ask you to accept the new version before you continue using the service.

8. Governing law. Swedish law applies. Disputes are settled by Swedish courts.$t$, true),
('privacy', 1, 'sv', 'Integritetspolicy', $t$MaskinID Sverige AB är personuppgiftsansvarig för uppgifter om användare och om personer som lämnar tips. För maskindata som organisationer registrerar är MaskinID personuppgiftsbiträde enligt biträdesavtalet.

Vilka uppgifter vi behandlar: namn, e-post och telefon för användare; en kontrollsumma av personnummer från BankID (aldrig personnumret i klartext); inloggnings- och säkerhetshändelser; uppgifter i tips och supportärenden.

Enskild firma: organisationsnumret är ett personnummer och lagras krypterat. Det visas maskerat för alla utom registerhållarens superadministratörer och myndigheter.

Varför: för att tillhandahålla registret, förebygga bedrägeri och stöld (berättigat intresse), uppfylla avtal och rättsliga skyldigheter.

Marknadsbevakning: vi sparar aldrig uppgifter om privatpersoner som säljer maskiner i annonser, bara maskinen och annonsen.

Lagring: användaruppgifter så länge kontot finns plus 24 månader; händelsekedjan sparas utan tidsgräns men innehåller inga personnummer.

Dina rättigheter: tillgång, rättelse, radering (där registret inte kräver att uppgiften finns kvar), begränsning och invändning. Kontakta support@maskinid.se. Du kan klaga hos Integritetsskyddsmyndigheten (IMY).$t$, true),
('privacy', 1, 'en', 'Privacy policy', $t$MaskinID Sverige AB is the controller for data about users and about people who submit tips. For machine data registered by organisations, MaskinID is a processor under the data processing agreement.

What we process: name, e-mail and phone for users; a checksum of the personal identity number from BankID (never the number in clear text); sign-in and security events; information in tips and support tickets.

Sole traders: the organisation number is a personal identity number and is stored encrypted. It is shown masked to everyone except the register keeper's superadmins and authorities.

Why: to provide the register, prevent fraud and theft (legitimate interest), and fulfil contracts and legal obligations.

Market surveillance: we never store data about private individuals selling machines in listings, only the machine and the listing.

Retention: user data while the account exists plus 24 months; the event chain is kept indefinitely but contains no personal identity numbers.

Your rights: access, rectification, erasure (where the register does not require the data to remain), restriction and objection. Contact support@maskinid.se. You may complain to the Swedish Authority for Privacy Protection (IMY).$t$, true),
('dpa', 1, 'sv', 'Personuppgiftsbiträdesavtal', $t$Detta avtal gäller mellan organisationen (personuppgiftsansvarig) och MaskinID Sverige AB (personuppgiftsbiträde) för personuppgifter i uppgifter som organisationen registrerar, till exempel kontaktpersoner, förare och dokument.

MaskinID behandlar uppgifterna enbart för att tillhandahålla tjänsten och enligt organisationens instruktioner, vidtar lämpliga tekniska och organisatoriska säkerhetsåtgärder (kryptering, åtkomstkontroll per organisation, loggning), anlitar underbiträden endast inom EU/EES eller med godtagbara skyddsåtgärder och meddelar organisationen om personuppgiftsincidenter utan onödigt dröjsmål.

Vid avtalets upphörande raderas eller återlämnas uppgifterna, med undantag för händelsekedjan som registret måste bevara.$t$, true),
('dpa', 1, 'en', 'Data processing agreement', $t$This agreement applies between the organisation (controller) and MaskinID Sverige AB (processor) for personal data in information the organisation registers, such as contact persons, operators and documents.

MaskinID processes the data only to provide the service and on the organisation's instructions, takes appropriate technical and organisational security measures (encryption, per-organisation access control, logging), uses sub-processors only within the EU/EEA or with adequate safeguards, and notifies the organisation of personal data breaches without undue delay.

When the agreement ends, the data is deleted or returned, except for the event chain the register must keep.$t$, true),
('cookies', 1, 'sv', 'Kakor', $t$MaskinID använder bara nödvändiga kakor och lokal lagring för inloggning, språkval och tema. Vi använder inga spårnings- eller annonskakor.$t$, false),
('cookies', 1, 'en', 'Cookies', $t$MaskinID only uses necessary cookies and local storage for sign-in, language and theme. We use no tracking or advertising cookies.$t$, false);

-- =====================================================================================================================
-- Account security log
-- =====================================================================================================================
create table public.security_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  type        text not null check (type in ('sign_in', 'sign_out', 'sign_out_everywhere', 'mfa_enrolled', 'mfa_removed', 'identity_verified',
                'legal_accepted', 'view_as_started')),
  ua_family   text check (length(ua_family) <= 60),
  ip_hash     text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index security_events_user_idx on public.security_events (user_id, created_at desc);
alter table public.security_events enable row level security;
revoke all on public.security_events from anon, authenticated;

create or replace function public.record_security_event(p_type text, p_ua_family text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  if p_type not in ('sign_in', 'sign_out', 'sign_out_everywhere', 'mfa_enrolled', 'mfa_removed') then perform app.raise('VALIDATION', '{"field":"type"}'); end if;
  if not app.rate_limit_hit('secev:' || auth.uid(), 60, interval '1 hour') then perform app.raise('RATE_LIMITED'); end if;
  insert into public.security_events (user_id, type, ua_family, ip_hash)
  values (auth.uid(), p_type, left(p_ua_family, 60), app.sha256_hex(coalesce(split_part(app.request_header('x-forwarded-for'), ',', 1), '')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_security_events(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.raise('NOT_AUTHENTICATED'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'ua_family', e.ua_family, 'created_at', e.created_at,
      'details', e.details) order by e.id desc)
    from (select * from public.security_events where user_id = auth.uid() order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) e), '[]'::jsonb);
end $$;

-- =====================================================================================================================
-- "Visa som organisation": an operator (support+) sees the app as an organisation, read-only, for 30 minutes, with a
-- reason. The organisation's admins are told; everything is in the operator audit log. Writes never pass: only
-- require_actor(..., 'readonly') calls accept a view-as session.
-- =====================================================================================================================
create table public.view_as_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  org_id      uuid not null references public.organizations (id),
  reason      text not null check (length(trim(reason)) between 5 and 300),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 minutes',
  ended_at    timestamptz
);
alter table public.view_as_sessions enable row level security;
revoke all on public.view_as_sessions from anon, authenticated;

create or replace function app.viewing_as(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.view_as_sessions s where s.user_id = auth.uid() and s.org_id = p_org_id and s.ended_at is null
    and s.expires_at > now()) and app.is_operator('support')
$$;

create or replace function app.is_member_of(p_org_id uuid, p_min_role public.member_role default 'readonly')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
      and app.role_rank(m.role) >= app.role_rank(p_min_role))
    or (p_min_role = 'readonly' and app.viewing_as(p_org_id))
$$;

create or replace function public.admin_start_view_as(p_org_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('support'); s public.view_as_sessions; o public.organizations;
begin
  select * into o from public.organizations where id = p_org_id and 'operator' <> all (types);
  if o.id is null then perform app.raise('NOT_FOUND'); end if;
  update public.view_as_sessions set ended_at = now() where user_id = auth.uid() and ended_at is null;
  insert into public.view_as_sessions (user_id, org_id, reason) values (auth.uid(), o.id, trim(p_reason)) returning * into s;
  insert into public.security_events (user_id, type, details) values (auth.uid(), 'view_as_started', jsonb_build_object('org_id', o.id));
  perform app.audit('view_as.started', 'organization', o.id::text, jsonb_build_object('reason', s.reason));
  perform app.notify_org(o.id, 'support.viewed_as', jsonb_build_object('reason', s.reason, 'at', app.iso_ts(now())), '/settings', 'info', 'admin');
  return jsonb_build_object('ok', true, 'slug', o.slug, 'expires_at', s.expires_at);
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"reason"}');
end $$;

create or replace function public.end_view_as()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.view_as_sessions set ended_at = now() where user_id = auth.uid() and ended_at is null;
  perform app.audit('view_as.ended') where app.is_operator('support');
  return jsonb_build_object('ok', true);
end $$;

-- Context: pending legal documents and the view-as organisation as a read-only pseudo membership.
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.profiles; va public.view_as_sessions;
begin
  if uid is null then return null; end if;
  select * into p from public.profiles where user_id = uid;
  select * into va from public.view_as_sessions where user_id = uid and ended_at is null and expires_at > now() order by started_at desc limit 1;
  return jsonb_build_object(
    'user_id', uid,
    'email', p.email,
    'full_name', p.full_name,
    'phone', p.phone,
    'locale', coalesce(p.locale, 'sv'),
    'identity_verified_at', p.identity_verified_at,
    'identity_provider', p.identity_provider,
    'last_active_org_id', p.last_active_org_id,
    'operator_role', (select role from public.operator_roles where user_id = uid),
    'memberships', coalesce((
      select jsonb_agg(x order by x -> 'org' ->> 'name') from (
        select jsonb_build_object('membership_id', m.id, 'role', m.role, 'org', app.org_brief(o.id),
          'effective_types', (select coalesce(jsonb_agg(t), '[]') from unnest(enum_range(null::public.org_type)) t where app.has_org_type(o.id, t)),
          'min_trusted_level', coalesce((o.settings ->> 'min_trusted_level')::int, 0)) x
        from public.memberships m join public.organizations o on o.id = m.org_id
        where m.user_id = uid and m.status = 'active'
        union all
        select jsonb_build_object('membership_id', null, 'role', 'readonly', 'org', app.org_brief(o.id), 'view_as', true, 'view_as_expires_at', va.expires_at,
          'effective_types', (select coalesce(jsonb_agg(t), '[]') from unnest(enum_range(null::public.org_type)) t where app.has_org_type(o.id, t)),
          'min_trusted_level', coalesce((o.settings ->> 'min_trusted_level')::int, 0))
        from public.organizations o where o.id = va.org_id and app.is_operator('support')) s), '[]'::jsonb),
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object('membership_id', m.id, 'org', app.org_brief(m.org_id), 'role', m.role))
      from public.memberships m where m.status = 'invited' and lower(m.invite_email) = p.email
        and (m.invite_expires_at is null or m.invite_expires_at > now())), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.notifications where user_id = uid and read_at is null),
    'legal_pending', app.legal_pending(uid),
    'demo_mode', app.is_demo_mode()
  );
end $$;

revoke execute on function public.submit_tip(text, text, text, jsonb, text, text, text), public.submit_public_support(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_tip(text, text, text, jsonb, text, text, text), public.submit_public_support(text, text, text, text, text) to service_role;
grant execute on function public.public_stolen_list(public.machine_category, text), public.list_legal_documents(text),
  public.get_legal_document(text, text, int) to anon, authenticated;
-- Machine view: expose the stolen-list toggle (redefines step 20's hook).
create or replace function app.machine_view_extras_more(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'inspection_valid_until', case when app.has_full_access(p_rel) or p_rel && array['insurer'] then app.inspection_valid_until(m.id)
                                   else app.public_inspection_valid_until(m.id) end,
    'inspection_required', m.has_lifting_device,
    'insured', case when p_rel && array['owner', 'user', 'insurer', 'authority', 'operator'] then
      exists (select 1 from public.insurance_policies ip where ip.machine_id = m.id and ip.status = 'active' and current_date between ip.valid_from and ip.valid_to) end,
    'assignment', case when p_rel && array['owner', 'user'] then (select jsonb_build_object('project_id', a.project_id, 'name', a.name, 'site_address', a.site_address, 'from', a.from_date)
      from public.machine_assignments a where a.machine_id = m.id and a.org_id = p_org_id and a.to_date is null limit 1) end,
    'rental', case when p_rel && array['owner', 'lessee'] then (select jsonb_build_object('id', r.id, 'status', r.status, 'from', r.from_date, 'to', r.to_date,
        'lessee', (select name from public.organizations where id = r.lessee_org_id), 'lessor', (select name from public.organizations where id = r.lessor_org_id))
      from public.rentals r where r.machine_id = m.id and r.status in ('planned', 'active', 'overdue') order by r.from_date limit 1) end,
    'market_listings', case when app.has_full_access(p_rel) or p_rel && array['insurer'] then nullif(app.market_listings_for(m.id), '[]'::jsonb) end,
    'operational', case when p_rel && array['owner', 'user', 'lessee', 'operator'] then jsonb_build_object('status', m.operational_status,
      'reason', m.operational_status_reason, 'at', m.operational_status_at) end,
    'attachments', case when p_rel && array['owner', 'user'] then (select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'make', a.make,
      'model', a.model, 'serial', a.serial, 'mounted_at', a.mounted_at)) from public.attachments a where a.machine_id = m.id and a.org_id = p_org_id) end,
    'operator', case when p_rel && array['owner', 'user'] then (select jsonb_build_object('id', o.id, 'name', o.name) from public.machine_operators mo
      join public.operators o on o.id = mo.operator_id where mo.machine_id = m.id and mo.org_id = p_org_id and mo.to_at is null limit 1) end
  )) || app.machine_view_insurance(m, p_rel)
    -- step 22: stolen-list publication, for those who may toggle it (set_flag_public)
    || coalesce((select jsonb_build_object('stolen_public', jsonb_build_object('flag_id', f.id, 'published', f.publish_public))
      from public.flags f where f.machine_id = m.id and f.type = 'stolen' and f.status = 'active'
        and (p_rel && array['owner', 'authority'] or f.raised_by_org_id = p_org_id) limit 1), '{}'::jsonb)
$$;

grant execute on function public.admin_list_tips(text), public.admin_review_tip(uuid, text, text), public.set_flag_public(uuid, uuid, boolean),
  public.create_support_ticket(uuid, text, text, text, text), public.list_my_tickets(uuid), public.get_ticket(uuid, uuid),
  public.add_ticket_message(uuid, uuid, text), public.admin_list_tickets(text), public.set_ticket_status(uuid, uuid, text),
  public.accept_legal_documents(jsonb, uuid), public.admin_publish_legal(text, text, text, text, text, boolean),
  public.record_security_event(text, text), public.list_security_events(int), public.admin_start_view_as(uuid, text), public.end_view_as()
  to authenticated;
select app.grant_api_access();
