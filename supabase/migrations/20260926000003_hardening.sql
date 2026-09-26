-- =====================================================================
-- MaskinID – åtgärder från Supabase Advisors
--
-- - Fast search_path på de två funktioner som saknade det
-- - Index på alla främmande nycklar som saknade täckande index
-- =====================================================================

alter function public.identifier_key(text) set search_path = '';
alter function public.forbidden() set search_path = '';

create index if not exists blocks_machine_id_idx                       on public.blocks (machine_id);
create index if not exists blocks_reported_by_organization_id_idx      on public.blocks (reported_by_organization_id);
create index if not exists insurances_machine_id_idx                   on public.insurances (machine_id);
create index if not exists insurances_insurer_organization_id_idx      on public.insurances (insurer_organization_id);
create index if not exists machines_created_by_idx                     on public.machines (created_by);
create index if not exists ownerships_owner_organization_id_idx        on public.ownerships (owner_organization_id);
create index if not exists pledges_lender_organization_id_idx          on public.pledges (lender_organization_id);
create index if not exists register_events_actor_user_id_idx           on public.register_events (actor_user_id);
create index if not exists register_events_source_organization_id_idx  on public.register_events (source_organization_id);
create index if not exists register_extracts_machine_id_idx            on public.register_extracts (machine_id);
create index if not exists register_extracts_issued_by_user_id_idx     on public.register_extracts (issued_by_user_id);
create index if not exists register_extracts_issued_to_org_idx         on public.register_extracts (issued_to_organization_id);
