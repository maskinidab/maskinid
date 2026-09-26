-- Deterministic test fixtures: one user per role (CLAUDE.md rule 8). Loaded after migrations + seed by
-- supabase/scripts/local-db.mjs. IDs mirror supabase/tests/fixtures.ts. Never loaded into staging/prod.
do $$
declare
  r record;
begin
  for r in select * from (values
    ('f1000000-0000-4000-8000-000000000001'::uuid, 'owner_a@test.local',      'Olle Owner A',     true),
    ('f1000000-0000-4000-8000-000000000002'::uuid, 'owner_b@test.local',      'Ottilia Owner B',  true),
    ('f1000000-0000-4000-8000-000000000003'::uuid, 'dealer@test.local',       'Doris Dealer',     true),
    ('f1000000-0000-4000-8000-000000000004'::uuid, 'financier_a@test.local',  'Fia Financier A',  true),
    ('f1000000-0000-4000-8000-000000000005'::uuid, 'financier_b@test.local',  'Filip Financier B', true),
    ('f1000000-0000-4000-8000-000000000006'::uuid, 'insurer@test.local',      'Ingrid Insurer',   true),
    ('f1000000-0000-4000-8000-000000000007'::uuid, 'authority@test.local',    'Arne Authority',   true),
    ('f1000000-0000-4000-8000-000000000008'::uuid, 'inspector@test.local',    'Inez Inspector',   true),
    ('f1000000-0000-4000-8000-000000000009'::uuid, 'operator@test.local',     'Oskar Operator',   true),
    ('f1000000-0000-4000-8000-000000000010'::uuid, 'verifier@test.local',     'Vera Verifier',    true),
    ('f1000000-0000-4000-8000-000000000011'::uuid, 'support@test.local',      'Sune Support',     true),
    ('f1000000-0000-4000-8000-000000000012'::uuid, 'unverified@test.local',   'Ulla Unverified',  false),
    ('f1000000-0000-4000-8000-000000000013'::uuid, 'client@test.local',       'Klara Client',     true),
    ('f1000000-0000-4000-8000-000000000014'::uuid, 'manufacturer@test.local', 'Mats Manufacturer', true),
    ('f1000000-0000-4000-8000-000000000015'::uuid, 'marketplace@test.local',  'Maja Marketplace', true),
    ('f1000000-0000-4000-8000-000000000016'::uuid, 'owner_a_ro@test.local',   'Rolf Readonly',    true),
    ('f1000000-0000-4000-8000-000000000017'::uuid, 'newcomer@acme-test.se',   'Nina Newcomer',    true)
  ) as t(id, email, name, verified) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
            extensions.crypt('test-password', extensions.gen_salt('bf', 4)), now(), jsonb_build_object('full_name', r.name))
    on conflict (id) do nothing;
    update public.profiles set full_name = r.name,
      identity_verified_at = case when r.verified then now() end,
      identity_provider = case when r.verified then 'mock' end,
      personal_number_hash = case when r.verified then app.sha256_hex('fixture:' || r.id) end
    where user_id = r.id;
  end loop;

  for r in select * from (values
    ('f2000000-0000-4000-8000-000000000001'::uuid, 'test-owner-a',      'Test Owner A AB',      '559900-0001', array['owner']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000002'::uuid, 'test-owner-b',      'Test Owner B AB',      '559900-0002', array['owner']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000003'::uuid, 'test-dealer',       'Test Dealer AB',       '559900-0003', array['dealer', 'owner']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000004'::uuid, 'test-financier-a',  'Test Finans A AB',     '559900-0004', array['financier']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000005'::uuid, 'test-financier-b',  'Test Finans B AB',     '559900-0005', array['financier']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000006'::uuid, 'test-insurer',      'Test Försäkring AB',   '559900-0006', array['insurer']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000007'::uuid, 'test-authority',    'Testpolisen',          '202100-0007', array['authority']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000008'::uuid, 'test-inspector',    'Test Kontroll AB',     '559900-0008', array['inspector']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000009'::uuid, 'test-operator',     'Test Operatör AB',     '559900-0009', array['operator']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000013'::uuid, 'test-client',       'Test Beställare',      '212000-0013', array['client']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000014'::uuid, 'test-manufacturer', 'Test Tillverkare AB',  '559900-0014', array['manufacturer']::public.org_type[]),
    ('f2000000-0000-4000-8000-000000000015'::uuid, 'test-marketplace',  'Test Marknadsplats AB','559900-0015', array['marketplace']::public.org_type[])
  ) as t(id, slug, name, orgnr, types) loop
    insert into public.organizations (id, slug, types, name, org_number, org_number_hash, status, approved_at, lookup_source, city, dpa_accepted_at, dpa_version)
    values (r.id, r.slug, r.types, r.name, r.orgnr, app.org_number_hash(r.orgnr), 'approved', now(), 'mock', 'Teststad', now(), 'test')
    on conflict (id) do nothing;
  end loop;

  insert into public.memberships (org_id, user_id, role, status, accepted_at) values
    ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000004', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000005', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000006', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000007', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000008', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000009', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000010', 'member', 'active', now()),
    ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000011', 'readonly', 'active', now()),
    ('f2000000-0000-4000-8000-000000000013', 'f1000000-0000-4000-8000-000000000013', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000014', 'f1000000-0000-4000-8000-000000000014', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000015', 'f1000000-0000-4000-8000-000000000015', 'admin', 'active', now()),
    ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000016', 'readonly', 'active', now()),
    ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000012', 'member', 'active', now())
  on conflict (org_id, user_id) do nothing;

  insert into public.operator_roles (user_id, role) values
    ('f1000000-0000-4000-8000-000000000009', 'superadmin'),
    ('f1000000-0000-4000-8000-000000000010', 'verifier'),
    ('f1000000-0000-4000-8000-000000000011', 'support')
  on conflict (user_id) do nothing;
end $$;
