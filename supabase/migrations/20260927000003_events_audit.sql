-- =====================================================================
-- 0006 events & audit (SPEC §4.5, §11.4) – created before the domain
-- tables because every RPC writes events (CLAUDE.md rule 3).
--
-- events is APPEND-ONLY and hash-chained:
--   * seq and prev_hash are assigned inside a BEFORE INSERT trigger while
--     holding a transaction-scoped advisory lock, so seq order equals chain
--     order even with concurrent writers;
--   * hash = sha256(prev_hash|seq|id|type|machine_id|org_id|actor_type|
--     actor_user_id|actor_org_id|payload|created_at) – see ADR 0006 for why
--     more columns than SPEC's minimum are covered;
--   * UPDATE, DELETE and TRUNCATE raise, for every role (incl. service_role).
-- event_anchors holds a daily Merkle root published on /security and in a
-- public GitHub repository (Edge Function anchor-events).
-- =====================================================================

create sequence public.events_seq;

create table public.events (
  seq            bigint primary key,
  id             uuid not null unique default gen_random_uuid(),
  machine_id     uuid,
  org_id         uuid,
  type           text not null check (type ~ '^[a-z][a-z0-9_.]*$'),
  actor_user_id  uuid,
  actor_org_id   uuid,
  actor_type     public.actor_type not null default 'user',
  payload        jsonb not null default '{}'::jsonb,
  prev_hash      text,
  hash           text not null,
  created_at     timestamptz not null default now()
);
create index events_machine_idx on public.events (machine_id, seq desc);
create index events_org_idx on public.events (org_id, seq desc);
create index events_type_idx on public.events (type, seq desc);
create index events_created_idx on public.events (created_at);
create index events_actor_org_idx on public.events (actor_org_id);

alter table public.events enable row level security;

create or replace function app.event_hash(e public.events)
returns text language sql immutable set search_path = '' as $$
  select app.sha256_hex(
    coalesce(e.prev_hash, '') || '|' || e.seq::text || '|' || e.id::text || '|' || e.type || '|' ||
    coalesce(e.machine_id::text, '') || '|' || coalesce(e.org_id::text, '') || '|' || e.actor_type::text || '|' ||
    coalesce(e.actor_user_id::text, '') || '|' || coalesce(e.actor_org_id::text, '') || '|' ||
    e.payload::text || '|' || app.iso_ts(e.created_at))
$$;

create or replace function app.events_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare last public.events;
begin
  perform pg_advisory_xact_lock(7427001); -- serialise the chain
  select * into last from public.events order by seq desc limit 1;
  new.seq := nextval('public.events_seq');
  new.prev_hash := last.hash;
  if new.created_at is null then new.created_at := now(); end if;
  new.hash := app.event_hash(new);
  return new;
end $$;

create trigger events_chain before insert on public.events
  for each row execute function app.events_before_insert();

create or replace function app.events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'EVENTS_APPEND_ONLY' using errcode = 'PT403',
    detail = 'The events table is append-only. Corrections are new correction events (SPEC §11.4).';
end $$;

create trigger events_no_update before update on public.events
  for each row execute function app.events_immutable();
create trigger events_no_delete before delete on public.events
  for each row execute function app.events_immutable();
create trigger events_no_truncate before truncate on public.events
  for each statement execute function app.events_immutable();

revoke all on public.events from public, anon, authenticated, service_role;
grant select on public.events to authenticated, service_role;
grant insert on public.events to service_role;
revoke all on sequence public.events_seq from public, anon, authenticated;

-- ---------- Actor context ----------
-- auth.uid()/auth.role() read the PostgREST JWT claims. Edge Function api-v1 calls RPCs with the service role
-- and identifies the API key with the header x-maskinid-api-key-id (validated again in app.require_actor).
create or replace function app.jwt_role()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

create or replace function app.request_header(p_name text)
returns text language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> lower(p_name)
$$;

create or replace function app.current_api_key_id()
returns uuid language plpgsql stable set search_path = '' as $$
declare v text;
begin
  if app.jwt_role() <> 'service_role' then return null; end if;
  v := coalesce(app.request_header('x-maskinid-api-key-id'), nullif(current_setting('app.api_key_id', true), ''));
  if v is null then return null; end if;
  return v::uuid;
exception when invalid_text_representation then return null;
end $$;

create or replace function app.current_actor_type()
returns public.actor_type language sql stable set search_path = '' as $$
  select case when app.current_api_key_id() is not null then 'api'::public.actor_type
              when auth.uid() is not null then 'user'::public.actor_type
              else 'system'::public.actor_type end
$$;

-- Writes one event. Every register-changing RPC calls this in the same transaction.
create or replace function app.log_event(
  p_type text, p_machine_id uuid, p_org_id uuid, p_actor_org_id uuid, p_payload jsonb default '{}'::jsonb)
returns public.events language plpgsql security definer set search_path = '' as $$
declare e public.events; payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if app.current_api_key_id() is not null then
    payload := payload || jsonb_build_object('api_key_id', app.current_api_key_id());
  end if;
  insert into public.events (machine_id, org_id, type, actor_user_id, actor_org_id, actor_type, payload)
  values (p_machine_id, p_org_id, p_type, auth.uid(), p_actor_org_id, app.current_actor_type(), payload)
  returning * into e;
  return e;
end $$;

-- ---------- Verification ----------
-- Recomputes the chain between two seq numbers. Reports the first row whose hash or link is wrong.
create or replace function app.verify_chain(p_from_seq bigint default null, p_to_seq bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.events; prev text; checked bigint := 0; started boolean := false;
begin
  if p_from_seq is not null and p_from_seq > 1 then
    select hash into prev from public.events where seq < p_from_seq order by seq desc limit 1;
  end if;
  for e in select * from public.events
           where (p_from_seq is null or seq >= p_from_seq) and (p_to_seq is null or seq <= p_to_seq)
           order by seq loop
    if started or p_from_seq is not null then
      if e.prev_hash is distinct from prev then
        return jsonb_build_object('ok', false, 'checked', checked, 'bad_seq', e.seq, 'reason', 'broken_link');
      end if;
    end if;
    if app.event_hash(e) <> e.hash then
      return jsonb_build_object('ok', false, 'checked', checked, 'bad_seq', e.seq, 'reason', 'hash_mismatch');
    end if;
    prev := e.hash; started := true; checked := checked + 1;
  end loop;
  return jsonb_build_object('ok', true, 'checked', checked, 'last_hash', prev);
end $$;

-- Merkle root over an ordered list of leaf hashes (hex). Odd levels duplicate the last node.
create or replace function app.merkle_root(p_leaves text[])
returns text language plpgsql immutable set search_path = '' as $$
declare level text[] := p_leaves; nxt text[]; i int; n int;
begin
  if p_leaves is null or cardinality(p_leaves) = 0 then return app.sha256_hex(''); end if;
  while cardinality(level) > 1 loop
    nxt := '{}'; n := cardinality(level); i := 1;
    while i <= n loop
      nxt := nxt || app.sha256_hex(level[i] || coalesce(level[i + 1], level[i]));
      i := i + 2;
    end loop;
    level := nxt;
  end loop;
  return level[1];
end $$;

create table public.event_anchors (
  day           date primary key,
  first_seq     bigint,
  last_seq      bigint not null,
  event_count   int not null default 0,
  root_hash     text not null,
  chain_hash    text,           -- hash of the last event of the day (links the anchor to the chain)
  published_at  timestamptz,
  external_ref  text,           -- e.g. commit URL in the public anchors repository
  created_at    timestamptz not null default now()
);
alter table public.event_anchors enable row level security;
create policy event_anchors_public_read on public.event_anchors for select to anon, authenticated using (true);

-- Computes (or recomputes, if not yet published) the anchor for one day: all events with seq after the previous
-- anchor's last_seq and created before the end of that day (Europe/Stockholm).
create or replace function app.compute_anchor(p_day date)
returns public.event_anchors language plpgsql security definer set search_path = '' as $$
declare
  prev_last bigint;
  day_end timestamptz := ((p_day + 1)::timestamp at time zone 'Europe/Stockholm');
  leaves text[]; firsts bigint; lasts bigint; cnt int; last_hash text; a public.event_anchors;
begin
  select coalesce(max(last_seq), 0) into prev_last from public.event_anchors where day < p_day;
  select array_agg(hash order by seq), min(seq), max(seq), count(*)
    into leaves, firsts, lasts, cnt
    from public.events where seq > prev_last and created_at < day_end;
  if lasts is null then lasts := prev_last; end if;
  select hash into last_hash from public.events where seq = lasts;
  insert into public.event_anchors (day, first_seq, last_seq, event_count, root_hash, chain_hash)
  values (p_day, firsts, lasts, coalesce(cnt, 0), app.merkle_root(coalesce(leaves, '{}')), last_hash)
  on conflict (day) do update set first_seq = excluded.first_seq, last_seq = excluded.last_seq,
    event_count = excluded.event_count, root_hash = excluded.root_hash, chain_hash = excluded.chain_hash
    where public.event_anchors.published_at is null
  returning * into a;
  if a.day is null then select * into a from public.event_anchors where day = p_day; end if;
  return a;
end $$;

-- Verifies a stored anchor against the events (anyone can call it; only hashes are involved).
create or replace function public.verify_anchor(p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.event_anchors; leaves text[]; root text;
begin
  select * into a from public.event_anchors where day = p_day;
  if a.day is null then perform app.raise('NOT_FOUND'); end if;
  select array_agg(hash order by seq) into leaves from public.events
    where seq between coalesce(a.first_seq, a.last_seq + 1) and a.last_seq;
  root := app.merkle_root(coalesce(leaves, '{}'));
  return jsonb_build_object('day', a.day, 'ok', root = a.root_hash, 'stored_root', a.root_hash, 'computed_root', root,
    'event_count', a.event_count, 'first_seq', a.first_seq, 'last_seq', a.last_seq, 'external_ref', a.external_ref);
end $$;

create or replace function public.list_event_anchors(p_limit int default 30)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.day desc), '[]'::jsonb)
  from (select * from public.event_anchors order by day desc limit least(greatest(p_limit, 1), 366)) a
$$;

grant execute on function public.verify_anchor(date), public.list_event_anchors(int) to anon, authenticated;
grant execute on function app.verify_chain(bigint, bigint), app.compute_anchor(date) to service_role;
grant execute on function app.jwt_role(), app.request_header(text), app.current_api_key_id(), app.current_actor_type()
  to anon, authenticated, service_role;
