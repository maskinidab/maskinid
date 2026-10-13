-- =====================================================================================================================
-- Two reported defects, both of which showed up as "ingen behörighet" (ADR 0030).
--
-- 1. "Handlaren får då upp att det finns ett lösenbesked som väntar, men när man klickar på det står det att man
--    inte har behörighet att se det."
--
--    The lender uploads the payoff statement, so `documents.org_id` is the bank, and app.attach_payoff_document
--    forces visibility = 'owner_and_financier'. app.can_read_document then admits the uploading org, the operator,
--    an authority, the owner/user relations and 'holder' — but a dealer at trade-in has at best 'transfer_party',
--    which app.machine_relations only grants while the transfer is 'awaiting_buyer'/'awaiting_financier'. At the
--    point the dealer asks for a payoff the transfer is still 'draft', so the dealer has no relation at all and
--    authorize_document_download raises NOT_FOUND.
--
--    The intent was always the opposite: payoff.quote_hint says "Handlaren ser beloppet i dokumentet" and ADR 0025
--    says both parties can open the PDF. Fixed by binding the document to the payoff request rather than to a
--    machine relation: the two parties to a payoff may read that payoff's two documents, and nothing else.
--
-- 2. "Samt en bekräftelse när banken släpper kredit/leasingspärr, just nu kommer det bara upp 'ingen behörighet'."
--
--    release_encumbrance and settle_payoff set status = 'released'. app.machine_relations grants 'holder' only for
--    status in ('pending','active'), so the lender loses every relation to the machine in the same transaction that
--    it releases the block — and the page it is standing on becomes unreadable.
--
--    Fixed with a 'former_holder' relation for 90 days after the release, built the way 'previous_owner' already
--    is. It is deliberately NOT part of app.has_full_access: the bank should be able to see that it released the
--    block and its own history of that financing, not keep reading the owner's machine.
-- =====================================================================================================================

-- ---------- 1. The parties to a payoff can open its documents ----------
create or replace function app.can_read_document(d public.documents)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare rel text[];
begin
  if d.id is null or d.status not in ('clean', 'scanning') then return false; end if;
  if d.org_id = any (app.current_org_ids()) or app.is_operator() or app.acts_as('authority') then return true; end if;
  -- A payoff conversation has exactly two parties and exactly two documents: the lender's payoff statement and
  -- the requester's proof of settlement. Both parties may read both, whatever their relation to the machine is —
  -- a dealer asking for a payoff at trade-in has none (the transfer is still a draft).
  if exists (select 1 from public.payoff_requests p
             where (p.quote_document_id = d.id or p.settlement_document_id = d.id)
               and (p.requested_by_org_id = any (app.current_org_ids()) or p.holder_org_id = any (app.current_org_ids())))
  then
    return true;
  end if;
  if d.machine_id is null then return false; end if;
  if d.visibility = 'public' then return true; end if;
  rel := app.machine_relations(d.machine_id);
  if rel && array['owner', 'user'] then
    -- Documents follow the machine to the new owner unless the uploader kept them private (visibility owner and not
    -- chosen to follow at transfer).
    return d.visibility <> 'owner' or d.org_id = any (app.current_org_ids())
      or exists (select 1 from public.transfers t where t.machine_id = d.machine_id and t.status = 'completed'
                 and d.id = any (t.document_ids) and t.to_org_id = any (app.current_org_ids()))
      or not exists (select 1 from public.transfers t where t.machine_id = d.machine_id and t.status = 'completed' and t.completed_at > d.created_at);
  end if;
  if 'holder' = any (rel) and d.visibility in ('owner_and_financier', 'verifiers') then return true; end if;
  -- A lender that has just released a financing keeps reading the documents of that financing for the grace
  -- window, so a release does not take the evidence away from the party that produced it.
  if 'former_holder' = any (rel) and d.visibility in ('owner_and_financier', 'verifiers') then return true; end if;
  if 'inspector_assigned' = any (rel) and d.visibility = 'verifiers' then return true; end if;
  return false;
end $$;

-- An upload is 'scanning' until the virus scan clears it, and authorize_document_download requires 'clean'. A
-- dealer clicking "Öppna lösenbesked" seconds after the bank uploaded would otherwise get NOT_FOUND — the same
-- message as the permission bug above, which is exactly the confusion to avoid. Its own code instead.
create or replace function public.authorize_document_download(p_document_id uuid, p_share_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.documents; s public.share_links;
begin
  select * into d from public.documents where id = p_document_id and archived_at is null;
  if d.id is null then perform app.raise('NOT_FOUND'); end if;
  if p_share_token is not null then
    select * into s from public.share_links where token_hash = app.sha256_hex(p_share_token) and revoked_at is null and expires_at > now();
    if s.id is null or s.machine_id is distinct from d.machine_id or d.visibility not in ('verifiers', 'public') or d.status <> 'clean' then
      perform app.raise('NOT_FOUND');
    end if;
  elsif not app.can_read_document(d) then
    perform app.raise('NOT_FOUND');
  elsif d.status <> 'clean' then
    -- May read it, but it is not ready yet: say so instead of "does not exist or you are not allowed".
    perform app.raise('DOCUMENT_NOT_READY', jsonb_build_object('status', d.status));
  end if;
  if d.machine_id is not null then
    perform app.after_lookup((select x from unnest(app.current_org_ids()) x limit 1), array[d.machine_id], case when p_share_token is null then 'web' else 'share_link' end);
  end if;
  return jsonb_build_object('bucket', 'documents', 'path', d.storage_path, 'filename', d.filename, 'mime', d.mime, 'expires_in', 300);
end $$;

-- ---------- 2. A lender keeps reading what it just released ----------
create or replace function app.machine_relations(p_machine_id uuid, p_org_ids uuid[] default null)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare m public.machines; orgs uuid[] := coalesce(p_org_ids, app.current_org_ids()); rel text[] := '{}';
begin
  select * into m from public.machines where id = p_machine_id;
  if m.id is null then return rel; end if;
  if app.is_operator() then rel := array_append(rel, 'operator'); end if;
  if exists (select 1 from unnest(orgs) o where app.has_org_type(o, 'authority')) then rel := array_append(rel, 'authority'); end if;
  if m.owner_org_id = any (orgs) then rel := array_append(rel, 'owner'); end if;
  if m.user_org_id = any (orgs) then rel := array_append(rel, 'user'); end if;
  -- The registering org (e.g. a dealer registering for a customer) keeps access only during the first ownership
  -- period; after a completed transfer it must not see the new owner's data (ADR 0010).
  if m.registered_by_org_id = any (orgs) and m.status <> 'draft'
     and not exists (select 1 from public.ownerships w where w.machine_id = m.id and w.acquired_via = 'transfer') then
    rel := array_append(rel, 'registered_by');
  end if;
  if m.status = 'draft' and m.registered_by_org_id = any (orgs) then rel := array_append(rel, 'draft_owner'); end if;
  if exists (select 1 from public.ownerships w where w.machine_id = m.id and w.to_date is not null and w.owner_org_id = any (orgs)
             and w.owner_org_id is distinct from m.owner_org_id) then
    rel := array_append(rel, 'previous_owner');
  end if;
  if exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status in ('pending', 'active') and e.holder_org_id = any (orgs)) then
    rel := array_append(rel, 'holder');
  end if;
  -- A lender that released a financing in the last 90 days. Enough to show it the confirmation and its own
  -- history of that financing; deliberately not in app.has_full_access, so it is not continued access to the
  -- owner's machine (mirrors 'previous_owner').
  if exists (select 1 from public.encumbrances e where e.machine_id = m.id and e.status = 'released'
             and e.holder_org_id = any (orgs) and e.released_at > now() - interval '90 days') then
    rel := array_append(rel, 'former_holder');
  end if;
  if exists (select 1 from public.transfers t where t.machine_id = m.id and t.status in ('awaiting_buyer', 'awaiting_financier')
             and t.to_org_id = any (orgs)) then
    rel := array_append(rel, 'transfer_party');
  end if;
  if exists (select 1 from public.check_receipts c where c.machine_id = m.id and c.performed_by_org_id = any (orgs)
             and c.created_at > now() - interval '24 hours') then
    rel := array_append(rel, 'checker');
  end if;
  rel := rel || app.machine_relations_more(m, orgs);
  return rel;
end $$;

-- The timeline for a former holder: its own financing categories, up to a day after the release. A day of slack
-- rather than the exact timestamp, because app.log_event('encumbrance.released') runs *after* released_at is set,
-- so the one event the confirmation exists to show is microseconds later. 'previous_owner' solves it the same way.
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
  if 'former_holder' = any (rel) and app.event_category(p_type) in ('encumbrance', 'transfer', 'flag') then
    return p_created_at < (select max(e.released_at) + interval '1 day' from public.encumbrances e
      where e.machine_id = p_machine_id and e.status = 'released' and e.holder_org_id = any (app.current_org_ids()));
  end if;
  if 'insurer' = any (rel) and app.event_category(p_type) = 'flag' then return true; end if;
  return false;
end $$;

-- A former holder also needs its own encumbrance rows in the machine view: MachinePage only renders the financing
-- tab when `encumbrances` is present, so without this the grace relation buys a page the bank cannot use.
create or replace function app.machine_view_extras(m public.machines, p_rel text[], p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owner_like boolean := p_rel && array['owner', 'user'];
  sees_yes_no boolean := owner_like or p_rel && array['operator', 'authority', 'holder', 'former_holder', 'transfer_party', 'checker']
    or (p_org_id is not null and (app.has_org_type(p_org_id, 'dealer') or app.has_org_type(p_org_id, 'financier')
      or app.has_org_type(p_org_id, 'insurer') or app.has_org_type(p_org_id, 'inspector') or app.has_org_type(p_org_id, 'marketplace')));
  -- Who holds it: owner (own), dealer at trade-in (transfer_party), every financier, authority, operator (SPEC §2.6).
  sees_holder boolean := owner_like or p_rel && array['operator', 'authority', 'transfer_party', 'holder']
    or (p_org_id is not null and app.has_org_type(p_org_id, 'financier'));
  sees_flag_details boolean := owner_like or p_rel && array['operator', 'authority', 'holder', 'insurer'];
  af public.encumbrances := app.active_financing(m.id);
  pf public.encumbrances := app.pending_financing(m.id);
  x jsonb := '{}'::jsonb;
begin
  if sees_yes_no then
    x := x || jsonb_build_object('financing', jsonb_build_object(
      'has_active', af.id is not null,
      -- A financing reported to the bank but not yet confirmed. Surfaced so the dealer sees "Belåning anmäld"
      -- immediately instead of "Ej belånad" (the reported defect); deliberately NOT part of has_active.
      'has_pending', pf.id is not null,
      -- The terms ride on their own object and only for the owner of the machine and the lender holding that
      -- very financing (ADR 0029). Note that encumbrance_json's second argument is already true for operators
      -- and authorities, which is exactly why the terms are not part of it.
      'pending', case when pf.id is not null and sees_holder then app.encumbrance_json(pf, owner_like or pf.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and pf.holder_org_id = p_org_id) then app.encumbrance_terms_json(pf) else '{}'::jsonb end end,
      'active', case when af.id is not null and sees_holder then app.encumbrance_json(af, owner_like or af.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and af.holder_org_id = p_org_id) then app.encumbrance_terms_json(af) else '{}'::jsonb end end,
      'min_trusted_level', case when p_org_id is null then 0 else coalesce((select (settings ->> 'min_trusted_level')::int from public.organizations where id = p_org_id), 0) end));
  end if;
  if owner_like or p_rel && array['operator', 'authority', 'holder', 'former_holder'] then
    x := x || jsonb_build_object('encumbrances', coalesce((select jsonb_agg(app.encumbrance_json(e,
        owner_like or e.holder_org_id = p_org_id or 'operator' = any (p_rel) or 'authority' = any (p_rel))
        || case when owner_like or (p_org_id is not null and e.holder_org_id = p_org_id) then app.encumbrance_terms_json(e) else '{}'::jsonb end
        order by e.created_at desc)
      from public.encumbrances e where e.machine_id = m.id
        -- A former holder sees its own rows only, never the owner's other financings.
        and (owner_like or 'operator' = any (p_rel) or 'authority' = any (p_rel) or e.holder_org_id = p_org_id)), '[]'::jsonb));
  end if;
  x := x || jsonb_build_object('flags', coalesce((select jsonb_agg(case when sees_flag_details then jsonb_build_object('id', f.id, 'type', f.type,
        'status', f.status, 'reference', f.reference,
        'description', case when f.type in ('blocked', 'under_investigation', 'seized') and not (owner_like or p_rel && array['operator', 'authority']) then null else f.description end,
        'raised_at', f.raised_at, 'raised_by', (select name from public.organizations where id = f.raised_by_org_id),
        'can_clear', f.raised_by_org_id = p_org_id or p_rel && array['operator', 'authority'],
        'occurred_at', f.occurred_at, 'location_text', f.location_text, 'cleared_at', f.cleared_at)
      else jsonb_build_object('type', f.type, 'status', f.status, 'raised_at', f.raised_at) end order by f.raised_at desc)
    from public.flags f where f.machine_id = m.id and (f.status = 'active' or sees_flag_details)), '[]'::jsonb));
  x := x || jsonb_build_object('last_transfer_date', (select max(effective_date) from public.transfers where machine_id = m.id and status = 'completed'));
  if owner_like or p_rel && array['operator', 'authority', 'transfer_party', 'holder'] then
    x := x || jsonb_build_object('open_transfer', (select app.transfer_json(t) from public.transfers t
      where t.machine_id = m.id and t.status in ('draft', 'awaiting_buyer', 'awaiting_financier') limit 1));
  end if;
  return x || app.machine_view_extras_more(m, p_rel, p_org_id);
end $$;
