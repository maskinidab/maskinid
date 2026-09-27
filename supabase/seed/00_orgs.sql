-- =====================================================================
-- Demo seed (SPEC §17). Loaded by `supabase db reset` (DEMO_MODE) and baked into the browser demo database.
-- All companies and people are fictitious. Password for every demo account: demo1234
--
-- Register data is created through the real RPCs acting as the demo users (request.jwt.claims), so events, hash
-- chain, notifications and conflicts are exactly what the product produces. Timestamps are then spread over the
-- last 30 days by seed.backdate() before the chain is re-hashed (only possible here: the seed runs as owner).
-- =====================================================================

create schema if not exists seed;

create or replace function seed.act(p_email text) returns uuid language plpgsql as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is null then raise exception 'seed: unknown user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2', 'email', p_email)::text, false);
  return uid;
end $$;

create or replace function seed.org(p_slug text) returns uuid language sql as $$ select id from public.organizations where slug = p_slug $$;

create or replace function seed.sign(p_org uuid, p_action text, p_subject uuid, p_params jsonb default '{}') returns uuid language plpgsql as $$
declare s jsonb;
begin
  s := public.start_signature(p_org, p_action, p_subject, p_params);
  perform public.complete_mock_signature((s ->> 'id')::uuid);
  return (s ->> 'id')::uuid;
end $$;

create or replace function seed.user(p_email text, p_name text, p_verified boolean default true) returns uuid language plpgsql as $$
declare uid uuid := extensions.gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
          extensions.crypt('demo1234', extensions.gen_salt('bf', 6)), now(), jsonb_build_object('full_name', p_name),
          '{"provider":"email","providers":["email"]}');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (extensions.gen_random_uuid(), uid, uid::text, 'email', jsonb_build_object('sub', uid::text, 'email', p_email), now(), now(), now());
  if p_verified then
    perform seed.act(p_email);
    perform public.verify_identity('mock');
  end if;
  return uid;
end $$;

-- Creates an org through create_org as its first user, then adds colleagues by invitation + acceptance.
create or replace function seed.company(p_org_number text, p_name text, p_city text, p_types public.org_type[], p_admin_email text,
  p_admin_name text, p_sole boolean default false, p_extra jsonb default '[]') returns uuid language plpgsql as $$
declare o jsonb; oid uuid; m jsonb; inv jsonb;
begin
  insert into app.mock_companies (org_number, name, city, address, is_sole_trader)
  values (p_org_number, p_name, p_city, jsonb_build_object('street', 'Demovägen 1', 'postal_code', '123 45', 'city', p_city), p_sole)
  on conflict (org_number) do nothing;
  perform seed.user(p_admin_email, p_admin_name);
  perform seed.act(p_admin_email);
  o := public.create_org(p_org_number, p_types, null, p_admin_email, '010-123 45 00', null, 'SE', null, '2026-09');
  oid := (o ->> 'id')::uuid;
  for m in select * from jsonb_array_elements(p_extra) loop
    perform seed.act(p_admin_email);
    inv := public.invite_member(oid, m ->> 'email', coalesce(m ->> 'role', 'member')::public.member_role);
    perform seed.user(m ->> 'email', m ->> 'name');
    perform seed.act(m ->> 'email');
    perform public.accept_invite(inv ->> 'token', null);
  end loop;
  return oid;
end $$;

-- ---------- Operator ----------
do $$
declare op uuid; a uuid; v uuid;
begin
  insert into app.mock_companies (org_number, name, city) values ('559412-0007', 'MaskinID Sverige AB', 'Stockholm') on conflict do nothing;
  a := seed.user('admin@demo.se', 'Alva Admin');
  v := seed.user('verifier@demo.se', 'Viktor Verifierare');
  perform seed.act('admin@demo.se');
  -- The operator org is created directly (create_org never grants the operator type).
  insert into public.organizations (slug, types, name, org_number, org_number_hash, status, approved_at, lookup_source, city, dpa_accepted_at, dpa_version, created_by)
  values ('maskinid', array['operator']::public.org_type[], 'MaskinID Sverige AB', '559412-0007', app.org_number_hash('559412-0007'), 'approved', now(), 'mock',
          'Stockholm', now(), '2026-09', a) returning id into op;
  insert into public.memberships (org_id, user_id, role, status, accepted_at) values (op, a, 'admin', 'active', now()), (op, v, 'member', 'active', now());
  insert into public.operator_roles (user_id, role) values (a, 'superadmin'), (v, 'verifier');
end $$;

-- ---------- Organisations (SPEC §17) ----------
do $$
begin
  perform seed.company('556701-1001', 'Nordmaskin AB', 'Uppsala', array['dealer', 'owner']::public.org_type[], 'nordmaskin@demo.se', 'Nils Nordin',
    false, '[{"email":"saljare@nordmaskin.demo.se","name":"Sara Säljare"},{"email":"verkstad@nordmaskin.demo.se","name":"Vilhelm Verkstad","role":"readonly"}]');
  perform seed.company('556701-1019', 'Entreprenadcenter Syd AB', 'Malmö', array['dealer', 'owner']::public.org_type[], 'syd@demo.se', 'Selma Syd');
  perform seed.company('556701-1027', 'Skogsmaskiner Norr AB', 'Umeå', array['dealer', 'owner']::public.org_type[], 'norr@demo.se', 'Nora Norr');
  perform seed.company('556701-2009', 'Bergs Schakt & Entreprenad AB', 'Västerås', array['owner']::public.org_type[], 'berg@demo.se', 'Bengt Berg',
    false, '[{"email":"platschef@berg.demo.se","name":"Petra Platschef"}]');
  perform seed.company('780512-1238', 'Lena Grävmaskin', 'Sala', array['owner']::public.org_type[], 'lena@demo.se', 'Lena Lind', true);
  perform seed.company('212000-2007', 'Kommunfastigheter Väst', 'Göteborg', array['owner', 'client']::public.org_type[], 'kommun@demo.se', 'Karin Kommun');
  perform seed.company('516401-3004', 'Demo Bank Finans', 'Stockholm', array['financier']::public.org_type[], 'bank@demo.se', 'Björn Bank');
  perform seed.company('516401-3012', 'Nordisk Maskinfinans', 'Stockholm', array['financier']::public.org_type[], 'finans@demo.se', 'Frida Finans');
  perform seed.company('516401-4002', 'Demo Försäkring', 'Stockholm', array['insurer']::public.org_type[], 'forsakring@demo.se', 'Fredrik Försäkring');
  perform seed.company('202100-0068', 'Polisen (demo)', 'Stockholm', array['authority']::public.org_type[], 'polisen@demo.se', 'Paula Polis');
  perform seed.company('202100-4730', 'Tullverket (demo)', 'Stockholm', array['authority']::public.org_type[], 'tull@demo.se', 'Tove Tull');
  perform seed.company('556701-5002', 'Maskinkontroll Sverige AB', 'Örebro', array['inspector']::public.org_type[], 'kontroll@demo.se', 'Kurt Kontroll');
  perform seed.company('556701-6000', 'Volvo Construction Equipment (demo)', 'Eskilstuna', array['manufacturer']::public.org_type[], 'tillverkare@demo.se', 'Tina Tillverkare');
  perform seed.company('556701-7008', 'Maskinmarknaden (demo)', 'Stockholm', array['marketplace']::public.org_type[], 'marknad@demo.se', 'Max Marknad');
  -- Pending approvals and partner types are approved by the operator (as in production).
  perform seed.act('admin@demo.se');
  perform public.approve_org(o.id) from public.organizations o where o.status = 'pending';
end $$;
