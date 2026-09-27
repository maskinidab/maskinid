-- Step 16: market surveillance (SPEC §8, §4.7). Listings are ingested by apps/ingest (service role), matched on serial
-- number, and turned into alerts. Legal guard rails (§8.6) are enforced here, not only in the worker: private sellers
-- are never stored with identifying data, raw payloads are stripped of personal fields, restricted sources are refused.

create table public.market_sources (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique check (key ~ '^[a-z0-9-]{2,40}$'),
  name            text not null,
  base_url        text,
  connector       text not null,
  enabled         boolean not null default false,
  schedule_cron   text,
  config          jsonb not null default '{}'::jsonb,  -- connector settings: search paths, sitemap/feed URLs (no secrets)
  tos_status      public.market_tos_status not null default 'unknown',
  robots_ok       boolean,
  last_run_at     timestamptz,
  last_run_status text,
  notes           text,
  created_at      timestamptz not null default now()
);

create table public.market_runs (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.market_sources (id),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'error')),
  fetched     int not null default 0,
  new_count   int not null default 0,
  matched     int not null default 0,
  alerts      int not null default 0,
  error       text
);
create index market_runs_source_idx on public.market_runs (source_id, started_at desc);

create table public.market_observations (
  id                  uuid primary key default gen_random_uuid(),
  source_id           uuid not null references public.market_sources (id),
  listing_external_id text not null,
  listing_url         text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  active              boolean not null default true,
  category            public.machine_category,
  make                text,
  model               text,
  year                int,
  hours               int,
  price_amount        numeric,  -- the listing's asking price; never stored in the register itself (SPEC §8.1)
  price_currency      text,
  price_vat_included  boolean,
  location_text       text,
  seller_type         public.seller_type not null default 'unknown',
  seller_name         text,
  seller_org_number   text,
  serial_candidate    text,
  normalized_serial   text,
  serial_source       public.serial_source,
  serial_confidence   numeric,
  images              jsonb not null default '[]'::jsonb,
  raw                 jsonb not null default '{}'::jsonb,
  content_hash        text,
  ocr_attempted_at    timestamptz,
  matched_machine_id  uuid references public.machines (id),
  match_confidence    numeric,
  created_at          timestamptz not null default now(),
  unique (source_id, listing_external_id),
  -- §8.1/§8.6: seller identity only for businesses.
  check (seller_type = 'business' or (seller_name is null and seller_org_number is null))
);
create index market_obs_serial_idx on public.market_observations (normalized_serial) where normalized_serial is not null;
create index market_obs_machine_idx on public.market_observations (matched_machine_id) where matched_machine_id is not null;
create index market_obs_seller_idx on public.market_observations (seller_org_number) where seller_org_number is not null;

create table public.market_alerts (
  id                  uuid primary key default gen_random_uuid(),
  type                public.market_alert_type not null,
  machine_id          uuid references public.machines (id),
  observation_ids     uuid[] not null default '{}',
  details             jsonb not null default '{}'::jsonb,
  status              public.market_alert_status not null default 'open',
  reviewed_by_user_id uuid,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);
create unique index market_alerts_one_open on public.market_alerts (type, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(details ->> 'serial', '')) where status = 'open';

alter table public.market_sources enable row level security;
alter table public.market_runs enable row level security;
alter table public.market_observations enable row level security;
alter table public.market_alerts enable row level security;
revoke all on public.market_sources, public.market_runs, public.market_observations, public.market_alerts from anon, authenticated;
grant select on public.market_sources, public.market_runs, public.market_observations, public.market_alerts to authenticated;
create policy market_sources_read on public.market_sources for select to authenticated using (app.is_operator());
create policy market_runs_read on public.market_runs for select to authenticated using (app.is_operator());
-- §11.2: owner sees observations of own machines, financier of machines it finances, insurer of insured machines.
create policy market_obs_read on public.market_observations for select to authenticated using (
  app.is_operator() or (matched_machine_id is not null and app.machine_relations(matched_machine_id) && array['owner', 'user', 'holder', 'insurer', 'authority']));
create policy market_alerts_read on public.market_alerts for select to authenticated using (
  app.is_operator() or (machine_id is not null and app.machine_relations(machine_id) && array['owner', 'holder', 'insurer', 'authority']));

-- ---------- Guard rails ----------
-- Removes anything that looks like personal data from a raw listing payload (keys, recursively).
create or replace function app.strip_personal(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; out jsonb;
begin
  if p is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p) = 'object' then
    out := '{}'::jsonb;
    for k, v in select * from jsonb_each(p) loop
      if lower(k) ~ '(phone|telefon|mobil|email|e-post|mail|contact|kontakt|seller|saljare|säljare|person|name|namn|address|adress|ssn|personnummer)' then continue; end if;
      out := out || jsonb_build_object(k, app.strip_personal(v));
    end loop;
    return out;
  elsif jsonb_typeof(p) = 'array' then
    return coalesce((select jsonb_agg(app.strip_personal(e)) from jsonb_array_elements(p) e), '[]'::jsonb);
  end if;
  return p;
end $$;

-- ---------- Runs ----------
create or replace function public.start_market_run(p_source_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.market_sources; r public.market_runs;
begin
  select * into s from public.market_sources where key = p_source_key;
  if s.id is null then perform app.raise('NOT_FOUND'); end if;
  -- Kill switch and terms: restricted sources never run (§8.6), disabled sources are skipped.
  if not s.enabled or s.tos_status = 'restricted' then perform app.raise('SOURCE_DISABLED', jsonb_build_object('tos_status', s.tos_status)); end if;
  insert into public.market_runs (source_id) values (s.id) returning * into r;
  return jsonb_build_object('run_id', r.id, 'source_id', s.id, 'connector', s.connector, 'base_url', s.base_url, 'config', s.config, 'since', (select max(finished_at) from public.market_runs where source_id = s.id and status = 'ok'));
end $$;

create or replace function public.finish_market_run(p_run_id uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.market_runs;
begin
  update public.market_runs set finished_at = now(), status = case when p_status = 'ok' then 'ok' else 'error' end, error = left(p_error, 1000)
  where id = p_run_id returning * into r;
  update public.market_sources set last_run_at = now(), last_run_status = r.status where id = r.source_id;
end $$;

-- ---------- Ingest ----------
-- p_observations: [{ external_id, url, category, make, model, year, hours, price_amount, price_currency, price_vat_included,
--   location, seller_type, seller_name, seller_org_number, serial, serial_source, serial_confidence, images, raw }]
-- p_complete: the batch is the source's full active set ⇒ listings not in it become inactive.
create or replace function public.ingest_observations(p_run_id uuid, p_observations jsonb, p_complete boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.market_runs; o jsonb; ob public.market_observations; seen uuid[] := '{}'; n_new int := 0; n_match int := 0; n_alerts int := 0;
  business boolean; h text; was_new boolean;
begin
  select * into r from public.market_runs where id = p_run_id and status = 'running';
  if r.id is null then perform app.raise('NOT_FOUND', '{"what":"run"}'); end if;
  if jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations) > 5000 then perform app.raise('VALIDATION', '{"field":"observations","max":5000}'); end if;
  for o in select * from jsonb_array_elements(p_observations) loop
    if nullif(trim(o ->> 'external_id'), '') is null then continue; end if;
    -- A sole trader's org number is a personal number (hard rule 6): such sellers are stored as private.
    business := o ->> 'seller_type' = 'business' and not coalesce(app.is_sole_trader_number(o ->> 'seller_org_number'), false);
    was_new := not exists (select 1 from public.market_observations where source_id = r.source_id and listing_external_id = left(trim(o ->> 'external_id'), 200));
    h := app.sha256_hex(concat_ws('|', o ->> 'make', o ->> 'model', o ->> 'year', o ->> 'hours', o ->> 'price_amount', o ->> 'serial', o ->> 'location'));
    insert into public.market_observations as mo (source_id, listing_external_id, listing_url, category, make, model, year, hours, price_amount,
      price_currency, price_vat_included, location_text, seller_type, seller_name, seller_org_number, serial_candidate, normalized_serial,
      serial_source, serial_confidence, images, raw, content_hash)
    values (r.source_id, left(trim(o ->> 'external_id'), 200), left(o ->> 'url', 500), app.category_from_text(o ->> 'category'),
      left(nullif(trim(o ->> 'make'), ''), 100), left(nullif(trim(o ->> 'model'), ''), 100),
      case when o ->> 'year' ~ '^\d{4}$' then (o ->> 'year')::int end, case when o ->> 'hours' ~ '^\d{1,7}$' then (o ->> 'hours')::int end,
      case when o ->> 'price_amount' ~ '^\d+(\.\d+)?$' then (o ->> 'price_amount')::numeric end, left(coalesce(o ->> 'price_currency', 'SEK'), 3),
      (o ->> 'price_vat_included')::boolean, left(o ->> 'location', 100),
      case when o ->> 'seller_type' = 'business' and not business then 'private' else coalesce(nullif(o ->> 'seller_type', ''), 'unknown') end::public.seller_type,
      case when business then left(nullif(trim(o ->> 'seller_name'), ''), 200) end,
      case when business then app.normalize_org_number(o ->> 'seller_org_number') end,
      left(nullif(trim(o ->> 'serial'), ''), 64), app.normalize_identifier(nullif(trim(o ->> 'serial'), '')),
      nullif(o ->> 'serial_source', '')::public.serial_source,
      coalesce((o ->> 'serial_confidence')::numeric, case when o ->> 'serial' is not null then 1 end),
      coalesce((select jsonb_agg(left(e #>> '{}', 500)) from jsonb_array_elements(case when jsonb_typeof(o -> 'images') = 'array' then o -> 'images' else '[]'::jsonb end) e), '[]'::jsonb),
      app.strip_personal(coalesce(o -> 'raw', '{}'::jsonb)), h)
    on conflict (source_id, listing_external_id) do update set last_seen_at = now(), active = true, listing_url = excluded.listing_url,
      hours = excluded.hours, price_amount = excluded.price_amount, price_vat_included = excluded.price_vat_included,
      location_text = excluded.location_text, seller_type = excluded.seller_type, seller_name = excluded.seller_name,
      seller_org_number = excluded.seller_org_number,
      serial_candidate = coalesce(excluded.serial_candidate, mo.serial_candidate), normalized_serial = coalesce(excluded.normalized_serial, mo.normalized_serial),
      serial_source = coalesce(excluded.serial_source, mo.serial_source), serial_confidence = coalesce(excluded.serial_confidence, mo.serial_confidence),
      images = excluded.images, raw = excluded.raw, content_hash = excluded.content_hash
    returning mo.* into ob;
    if was_new then n_new := n_new + 1; end if;
    seen := seen || ob.id;
    n_alerts := n_alerts + app.process_observation(ob.id);
    if (select matched_machine_id is not null from public.market_observations where id = ob.id) then n_match := n_match + 1; end if;
  end loop;
  if p_complete then
    update public.market_observations set active = false where source_id = r.source_id and active and not (id = any (seen));
  end if;
  update public.market_runs set fetched = fetched + jsonb_array_length(p_observations), new_count = new_count + n_new, matched = matched + n_match,
    alerts = alerts + n_alerts where id = r.id;
  return jsonb_build_object('ok', true, 'fetched', jsonb_array_length(p_observations), 'new', n_new, 'matched', n_match, 'alerts', n_alerts);
end $$;

-- Serial read from listing images by ocr-listing-images (§8.3). Below 0.85 the serial is shown as "possible" only.
create or replace function public.record_listing_serial(p_observation_id uuid, p_serial text, p_confidence numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.market_observations set serial_candidate = left(trim(p_serial), 64), normalized_serial = app.normalize_identifier(p_serial),
    serial_source = 'image_ocr', serial_confidence = p_confidence
  where id = p_observation_id and (serial_confidence is null or serial_confidence < p_confidence);
  if not found then return jsonb_build_object('ok', true, 'updated', false); end if;
  n := app.process_observation(p_observation_id);
  return jsonb_build_object('ok', true, 'updated', true, 'alerts', n);
end $$;

-- Claims listings whose images should be read for a serial (§8.3): no serial yet, has images, never attempted.
create or replace function public.claim_ocr_candidates(p_run_id uuid, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare src uuid; res jsonb;
begin
  select source_id into src from public.market_runs where id = p_run_id and status = 'running';
  if src is null then perform app.raise('NOT_FOUND', '{"what":"run"}'); end if;
  with c as (
    select id from public.market_observations
    where source_id = src and active and normalized_serial is null and ocr_attempted_at is null and jsonb_array_length(images) > 0
    order by first_seen_at desc limit least(greatest(coalesce(p_limit, 20), 0), 100) for update skip locked
  ), u as (
    update public.market_observations o set ocr_attempted_at = now() from c where o.id = c.id returning o.id, o.images
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'images', images)), '[]'::jsonb) into res from u;
  return res;
end $$;

-- ---------- Matching and signals (§8.4) ----------
create or replace function app.raise_market_alert(p_type public.market_alert_type, p_machine uuid, p_obs uuid[], p_details jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare a public.market_alerts; m public.machines; fin public.encumbrances; sev public.notification_severity; recipients uuid[] := '{}'; o uuid; ev public.events;
begin
  insert into public.market_alerts (type, machine_id, observation_ids, details) values (p_type, p_machine, p_obs, coalesce(p_details, '{}'))
  on conflict do nothing returning * into a;
  if a.id is null then
    update public.market_alerts set observation_ids = (select array_agg(distinct x) from unnest(observation_ids || p_obs) x)
    where type = p_type and machine_id is not distinct from p_machine and status = 'open' and coalesce(details ->> 'serial', '') = coalesce(p_details ->> 'serial', '');
    return false;
  end if;
  sev := case when p_type = 'stolen_machine_listed' then 'critical' when p_type = 'price_anomaly' then 'info' else 'warning' end;
  if p_machine is not null then
    select * into m from public.machines where id = p_machine;
    fin := app.active_financing(m.id);
    recipients := case p_type
      when 'stolen_machine_listed' then array_remove(array[m.owner_org_id, fin.holder_org_id], null)
        || coalesce((select array_agg(distinct ip.insurer_org_id) from public.insurance_policies ip where ip.machine_id = m.id and ip.status = 'active' and ip.insurer_org_id is not null), '{}')
        || coalesce((select array_agg(distinct f.raised_by_org_id) from public.flags f where f.machine_id = m.id and f.status = 'active' and f.type = 'stolen'), '{}')
      when 'listed_with_active_financing' then array_remove(array[fin.holder_org_id], null)
      when 'seller_not_owner' then array_remove(array[m.owner_org_id, fin.holder_org_id], null)
      when 'listed_after_transfer' then array_remove(array[m.owner_org_id], null)
      else '{}'::uuid[] end;
    ev := app.log_event('market.alert', m.id, m.owner_org_id, null, jsonb_build_object('alert_id', a.id, 'type', p_type));
    for o in select distinct x from unnest(recipients) x loop
      perform app.notify_org(o, 'market.' || p_type, jsonb_build_object('machine_id', m.id, 'reg_number', m.reg_number, 'alert_id', a.id,
        'listing_url', p_details ->> 'listing_url', 'source', p_details ->> 'source'), '/machines/' || m.id, sev);
      perform app.enqueue_webhook(o, 'market.alert', m.id, jsonb_build_object('type', p_type, 'alert_id', a.id, 'listing_url', p_details ->> 'listing_url'), ev.id);
    end loop;
  end if;
  perform app.notify_operators('market.' || p_type, jsonb_build_object('alert_id', a.id, 'reg_number', m.reg_number), '/admin/market', sev);
  return true;
end $$;

create or replace function app.process_observation(p_observation_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare ob public.market_observations; m public.machines; fin public.encumbrances; n int := 0; src text; det jsonb; others uuid[];
  owner_nr text; median numeric; t public.transfers;
begin
  select * into ob from public.market_observations where id = p_observation_id;
  select name into src from public.market_sources where id = ob.source_id;
  det := jsonb_build_object('listing_url', ob.listing_url, 'source', src, 'serial', ob.normalized_serial, 'price', ob.price_amount);
  -- Match only on a reliable serial (listing text / feed, or image OCR ≥ 0.85).
  if ob.normalized_serial is not null and length(ob.normalized_serial) >= 5 and coalesce(ob.serial_confidence, 0) >= 0.85 then
    select mm.* into m from public.machine_identifiers x join public.machines mm on mm.id = x.machine_id
      where x.normalized_value = ob.normalized_serial and x.type in ('pin', 'serial', 'vin') and mm.status <> 'draft'
      order by x.unique_active desc limit 1;
    if m.id is not null and ob.matched_machine_id is distinct from m.id then
      update public.market_observations set matched_machine_id = m.id, match_confidence = ob.serial_confidence where id = ob.id;
      perform app.log_event('market.listed', m.id, m.owner_org_id, null, jsonb_build_object('observation_id', ob.id, 'source', src, 'listing_url', ob.listing_url));
    end if;
  end if;
  if ob.active and m.id is not null then
    fin := app.active_financing(m.id);
    if m.status = 'stolen' and app.raise_market_alert('stolen_machine_listed', m.id, array[ob.id], det) then n := n + 1; end if;
    if fin.id is not null and app.raise_market_alert('listed_with_active_financing', m.id, array[ob.id], det) then n := n + 1; end if;
    if ob.seller_type = 'business' and ob.seller_org_number is not null then
      select org_number into owner_nr from public.organizations where id = m.owner_org_id;
      if ob.seller_org_number is distinct from owner_nr
         and ob.seller_org_number is distinct from (select org_number from public.organizations where id = m.user_org_id)
         and not exists (select 1 from public.transfers tr join public.organizations o2 on o2.id = tr.to_org_id where tr.machine_id = m.id
                         and tr.status in ('awaiting_buyer', 'awaiting_financier') and o2.org_number = ob.seller_org_number) then
        -- The seller used to own it and the machine has since been sold ⇒ listed_after_transfer; otherwise seller_not_owner.
        select tr.* into t from public.transfers tr join public.organizations o3 on o3.id = tr.from_org_id
          where tr.machine_id = m.id and tr.status = 'completed' and o3.org_number = ob.seller_org_number order by tr.completed_at desc limit 1;
        if t.id is not null and ob.first_seen_at < t.completed_at then
          if app.raise_market_alert('listed_after_transfer', m.id, array[ob.id], det || jsonb_build_object('transfer_id', t.id)) then n := n + 1; end if;
        elsif app.raise_market_alert('seller_not_owner', m.id, array[ob.id], det || jsonb_build_object('seller', ob.seller_name)) then n := n + 1; end if;
      end if;
    end if;
  end if;
  -- Same serial in ≥ 2 active listings from different sellers/sources.
  if ob.active and ob.normalized_serial is not null and coalesce(ob.serial_confidence, 0) >= 0.85 then
    select array_agg(id) into others from public.market_observations
      where normalized_serial = ob.normalized_serial and active and coalesce(serial_confidence, 0) >= 0.85
        and (source_id <> ob.source_id or coalesce(seller_org_number, seller_name, 'x') <> coalesce(ob.seller_org_number, ob.seller_name, 'x') or id = ob.id);
    if cardinality(others) >= 2 and app.raise_market_alert('duplicate_serial_in_market', m.id, others, det) then n := n + 1; end if;
  end if;
  -- Price anomaly: < 50 % of the model median (≥ 5 comparable listings); low priority, operator only.
  if ob.active and ob.price_amount is not null and ob.make is not null and ob.model is not null then
    select percentile_cont(0.5) within group (order by price_amount) into median from public.market_observations
      where make ilike ob.make and model ilike ob.model and price_amount is not null and id <> ob.id and last_seen_at > now() - interval '12 months'
      having count(*) >= 5;
    if median is not null and ob.price_amount < median * 0.5
       and app.raise_market_alert('price_anomaly', m.id, array[ob.id], det || jsonb_build_object('median', median)) then n := n + 1; end if;
  end if;
  return n;
end $$;

-- A stolen flag starts matching against the market (SPEC §6.8): re-process active observations with that serial.
create or replace function app.market_on_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ob record;
begin
  if new.type = 'flag.raised' and new.payload ->> 'type' = 'stolen' and new.machine_id is not null then
    for ob in select o.id from public.market_observations o join public.machine_identifiers x on x.normalized_value = o.normalized_serial
              where x.machine_id = new.machine_id and o.active loop
      perform app.process_observation(ob.id);
    end loop;
  end if;
  return null;
end $$;
create trigger events_market_on_flag after insert on public.events for each row execute function app.market_on_flag();

-- Active listings for a machine (used in checks and the machine view). Never presented as "owner" (§8.6).
create or replace function app.market_listings_for(p_machine_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('source', s.name, 'url', o.listing_url, 'seen_at', o.last_seen_at, 'first_seen_at', o.first_seen_at,
      'seller', case when o.seller_type = 'business' then o.seller_name end, 'location', o.location_text) order by o.last_seen_at desc), '[]'::jsonb)
  from public.market_observations o join public.market_sources s on s.id = o.source_id
  where o.matched_machine_id = p_machine_id and o.active
$$;

-- Machine page (§8.6): "senast sedd till salu hos …" for parties with full access and the insurer – never as owner.
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
    'market_listings', case when app.has_full_access(p_rel) or p_rel && array['insurer'] then nullif(app.market_listings_for(m.id), '[]'::jsonb) end
  )) || app.machine_view_insurance(m, p_rel)
$$;

-- ---------- Candidates: "Vi hittade 14 maskiner som ni annonserat" (§8.4) ----------
create or replace function public.list_market_candidates(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id, 'readonly', false); nr text;
begin
  select org_number into nr from public.organizations where id = actor;
  if nr is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'make', o.make, 'model', o.model, 'year', o.year, 'hours', o.hours,
      'category', o.category, 'serial', o.serial_candidate, 'url', o.listing_url, 'source', s.name, 'last_seen_at', o.last_seen_at) order by o.last_seen_at desc)
    from public.market_observations o join public.market_sources s on s.id = o.source_id
    where o.seller_org_number = nr and o.matched_machine_id is null and o.make is not null and o.model is not null and o.year is not null
      and o.normalized_serial is not null and coalesce(o.serial_confidence, 0) >= 0.85
      and not exists (select 1 from public.machines d where d.status = 'draft' and d.registered_by_org_id = actor and d.draft_data ->> 'market_observation_id' = o.id::text)), '[]'::jsonb);
end $$;

create or replace function public.create_drafts_from_candidates(p_org_id uuid, p_observation_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.require_actor(p_org_id); nr text; o public.market_observations; n int := 0;
begin
  if not app.can_register(actor) then perform app.raise('FORBIDDEN'); end if;
  select org_number into nr from public.organizations where id = actor;
  for o in select * from public.market_observations where id = any (p_observation_ids) and seller_org_number = nr and matched_machine_id is null loop
    perform public.save_machine_draft(actor, jsonb_build_object('step', 2, 'id_type', 'serial', 'serial', o.serial_candidate, 'make', o.make, 'model', o.model,
      'year', coalesce(o.year::text, ''), 'category', coalesce(o.category::text, ''), 'hour_meter', coalesce(o.hours::text, ''),
      'market_observation_id', o.id, 'ocr_fields', '[]'::jsonb), null);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'drafts', n);
end $$;

-- ---------- Operator ----------
create or replace function public.list_market_sources()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'active_listings', (select count(*) from public.market_observations o where o.source_id = s.id and o.active),
      'matched', (select count(*) from public.market_observations o where o.source_id = s.id and o.matched_machine_id is not null),
      'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from (select * from public.market_runs r where r.source_id = s.id order by started_at desc limit 10) r), '[]'::jsonb))
      order by s.name) from public.market_sources s), '[]'::jsonb);
end $$;

create or replace function public.set_market_source(p_source_id uuid, p_enabled boolean, p_tos_status public.market_tos_status default null, p_notes text default null,
  p_config jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('superadmin'); s public.market_sources;
begin
  -- Connector settings are public URLs and paths only; credentials belong in the worker's environment.
  if p_config is not null and (jsonb_typeof(p_config) <> 'object' or p_config::text ~* '(secret|token|password|apikey|api_key)') then
    perform app.raise('VALIDATION', '{"field":"config"}');
  end if;
  update public.market_sources set config = coalesce(p_config, config), enabled = coalesce(p_enabled, enabled) and coalesce(p_tos_status, tos_status) <> 'restricted',
    tos_status = coalesce(p_tos_status, tos_status), notes = coalesce(p_notes, notes)
  where id = p_source_id returning * into s;
  if s.id is null then perform app.raise('NOT_FOUND'); end if;
  perform app.log_event('market.source_changed', null, app.operator_org_id(), app.operator_org_id(), jsonb_build_object('source', s.key, 'enabled', s.enabled, 'tos_status', s.tos_status));
  return to_jsonb(s);
end $$;

create or replace function public.list_market_alerts(p_status public.market_alert_status default 'open', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator('support');
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('reg_number', m.reg_number, 'make', m.make, 'model', m.model,
      'observations', (select jsonb_agg(jsonb_build_object('id', o.id, 'url', o.listing_url, 'source', s.name, 'seller', o.seller_name, 'price', o.price_amount, 'active', o.active))
        from public.market_observations o join public.market_sources s on s.id = o.source_id where o.id = any (a.observation_ids))) order by a.created_at desc)
    from (select * from public.market_alerts where p_status is null or status = p_status order by created_at desc limit least(greatest(p_limit, 1), 1000)) a
    left join public.machines m on m.id = a.machine_id), '[]'::jsonb);
end $$;

create or replace function public.review_market_alert(p_alert_id uuid, p_status public.market_alert_status, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid := app.require_operator('verifier'); a public.market_alerts;
begin
  if p_status = 'open' then perform app.raise('VALIDATION', '{"field":"status"}'); end if;
  update public.market_alerts set status = p_status, reviewed_by_user_id = auth.uid(), reviewed_at = now(),
    details = details || jsonb_strip_nulls(jsonb_build_object('review_note', left(p_note, 1000)))
  where id = p_alert_id returning * into a;
  if a.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_status = 'escalated' and a.machine_id is not null then
    insert into public.conflicts (type, machine_id, involved_org_ids, details)
    values ('market_anomaly', a.machine_id, array_remove(array[(select owner_org_id from public.machines where id = a.machine_id)], null),
      jsonb_build_object('market_alert_id', a.id, 'type', a.type));
  end if;
  perform app.log_event('market.alert_reviewed', a.machine_id, null, app.operator_org_id(), jsonb_build_object('alert_id', a.id, 'status', p_status));
  return to_jsonb(a);
end $$;

-- Retention (§8.5): inactive observations older than 24 months lose seller fields and raw data.
create or replace function app.anonymize_old_observations()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.market_observations set seller_name = null, seller_org_number = null, seller_type = 'unknown', raw = '{}'::jsonb, images = '[]'::jsonb
  where not active and last_seen_at < now() - interval '24 months' and (seller_name is not null or raw <> '{}'::jsonb);
  get diagnostics n = row_count;
  return n;
end $$;

-- Starter sources (disabled until terms are reviewed, §8.2 / §8.6).
insert into public.market_sources (key, name, base_url, connector, tos_status, notes) values
  ('mascus', 'Mascus', 'https://www.mascus.se', 'mascus', 'unknown', 'Scraping-adapter; kräver granskning av villkor innan aktivering.'),
  ('blocket', 'Blocket', 'https://www.blocket.se', 'blocket', 'unknown', 'Scraping-adapter; kräver granskning av villkor innan aktivering.'),
  ('dealer-sitemap', 'Handlarwebbplatser (generisk)', null, 'generic-dealer', 'unknown', 'Sitemap + JSON-LD Product per handlare.'),
  ('partner-feed', 'Partnerflöde (JSON)', null, 'partner-feed', 'partner_feed', 'Officiellt flöde enligt avtal.')
on conflict (key) do nothing;

revoke execute on function public.start_market_run(text), public.finish_market_run(uuid, text, text), public.ingest_observations(uuid, jsonb, boolean),
  public.record_listing_serial(uuid, text, numeric), public.claim_ocr_candidates(uuid, int) from public, anon, authenticated;
grant execute on function public.start_market_run(text), public.finish_market_run(uuid, text, text), public.ingest_observations(uuid, jsonb, boolean),
  public.record_listing_serial(uuid, text, numeric), public.claim_ocr_candidates(uuid, int) to service_role;
grant execute on function public.list_market_candidates(uuid), public.create_drafts_from_candidates(uuid, uuid[]), public.list_market_sources(),
  public.set_market_source(uuid, boolean, public.market_tos_status, text, jsonb), public.list_market_alerts(public.market_alert_status, int),
  public.review_market_alert(uuid, public.market_alert_status, text) to authenticated;
select app.grant_api_access();
