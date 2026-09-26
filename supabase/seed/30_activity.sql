-- Everyday activity for the demo (SPEC §17): projects, rentals, hours, service, inspections, checks by the bank and
-- public scans in different towns. Runs after the machines; uses the same seed helpers.
create or replace function seed.mid(p_slot int) returns uuid language sql as $$ select machine_id from seed.machine_ids where slot = p_slot $$;

do $$
declare
  berg uuid := seed.org('bergs-schakt-entreprenad-ab'); kommun uuid := seed.org('kommunfastigheter-vast');
  nord uuid := seed.org('nordmaskin-ab'); bank uuid := seed.org('demo-bank-finans'); kontroll uuid := seed.org('maskinkontroll-sverige-ab');
  p1 uuid; p2 uuid; r record; i int; h int; code text;
  cities text[] := array['Uppsala', 'Västerås', 'Stockholm', 'Enköping', 'Göteborg', 'Malmö', 'Örebro', 'Umeå', 'Sala', 'Eskilstuna'];
  lat numeric[] := array[59.858, 59.611, 59.329, 59.636, 57.708, 55.605, 59.275, 63.826, 59.921, 59.371];
  lng numeric[] := array[17.639, 16.545, 18.068, 17.078, 11.974, 13.003, 15.213, 20.263, 16.606, 16.510];
begin
  -- Projects (Bergs: 2 projects, SPEC §17).
  perform seed.act('berg@demo.se');
  p1 := (public.save_project(berg, jsonb_build_object('name', 'Västerås resecentrum', 'reference', 'P-2026-014', 'site_address', 'Södra Ringvägen, Västerås',
    'starts_on', current_date - 60, 'ends_on', current_date + 240)) -> 'project' ->> 'id')::uuid;
  p2 := (public.save_project(berg, jsonb_build_object('name', 'E18 Hjulsta–Enköping, etapp 2', 'reference', 'TRV-5501', 'site_address', 'E18 trafikplats Litslena',
    'starts_on', current_date - 20, 'ends_on', current_date + 400)) -> 'project' ->> 'id')::uuid;
  perform public.assign_machine(berg, seed.mid(1), p1, current_date - 55);
  perform public.assign_machine(berg, seed.mid(2), p1, current_date - 50);
  perform public.assign_machine(berg, seed.mid(7), p1, current_date - 30);
  perform public.assign_machine(berg, seed.mid(3), p2, current_date - 18);
  perform public.assign_machine(berg, seed.mid(8), p2, current_date - 15);
  perform public.assign_machine(berg, seed.mid(12), p2, current_date - 12);

  -- Two rented machines (Nordmaskin's rental fleet, scenario 'rented').
  perform seed.act('nordmaskin@demo.se');
  perform public.create_rental(nord, seed.mid(27), berg, current_date - 10, current_date + 20, 'HYR-2026-118');
  perform public.create_rental(nord, seed.mid(28), kommun, current_date - 3, current_date + 60, 'HYR-2026-121');

  -- Hour meter readings and service for the owners' fleets.
  for r in select mp.slot, mp.hours, ow.email, ow.org_id from seed.machine_plan mp join seed.machine_ids mi on mi.slot = mp.slot
             cross join lateral seed.owner(split_part(mp.plan, '-', 1)) ow
           join public.machines m on m.id = mi.machine_id
           where m.status = 'active' and split_part(mp.plan, '-', 1) in ('berg', 'lena', 'kommun') order by mp.slot loop
    perform seed.act(r.email);
    h := r.hours + 40 + (r.slot * 7) % 90;
    -- Weekly readings over the last month.
    perform public.record_hours(r.org_id, seed.mid(r.slot), r.hours + 10, current_date - 28);
    perform public.record_hours(r.org_id, seed.mid(r.slot), r.hours + 25, current_date - 21);
    perform public.record_hours(r.org_id, seed.mid(r.slot), h, current_date - 14);
    perform public.record_hours(r.org_id, seed.mid(r.slot), h + 35 + r.slot % 20, current_date - 2);
    perform public.add_maintenance(r.org_id, seed.mid(r.slot), jsonb_build_object('type', 'service', 'performed_at', current_date - 20 - r.slot,
      'hours', r.hours, 'performed_by_text', case when r.slot % 2 = 0 then 'Swecon Västerås' else 'Egen verkstad' end,
      'next_due_hours', (r.hours / 500 + 1) * 500, 'next_title', 'Service ' || ((r.hours / 500 + 1) * 500) || ' h'));
    if r.slot % 3 = 0 then
      perform public.add_maintenance(r.org_id, seed.mid(r.slot), jsonb_build_object('type', 'repair', 'performed_at', current_date - 5,
        'hours', h, 'performed_by_text', 'Hydraulservice Mälardalen', 'notes', 'Bytt hydraulslang bom'));
    end if;
  end loop;

  -- Dealers report hours on their rental and demo fleets.
  for r in select mp.slot, mp.hours, ow.email, ow.org_id from seed.machine_plan mp join seed.machine_ids mi on mi.slot = mp.slot
             cross join lateral seed.owner(split_part(mp.plan, '-', 1)) ow
           join public.machines m on m.id = mi.machine_id
           where m.status = 'active' and split_part(mp.plan, '-', 1) in ('nordmaskin', 'syd', 'norr') order by mp.slot loop
    perform seed.act(r.email);
    perform public.record_hours(r.org_id, seed.mid(r.slot), r.hours + 12, current_date - 25);
    perform public.record_hours(r.org_id, seed.mid(r.slot), r.hours + 30, current_date - 9);
  end loop;

  -- Inspections of machines with lifting devices (the inspection body records directly, SPEC §20.3 / step 12).
  perform seed.act('kontroll@demo.se');
  for r in select m.id from public.machines m where m.status = 'active' and (m.has_lifting_device or m.category in ('crane_mobile', 'forklift', 'telehandler'))
           order by m.reg_number limit 6 loop
    perform public.record_inspection(kontroll, r.id, jsonb_build_object('type', 'periodic', 'performed_at', current_date - 40,
      'result', 'approved', 'valid_until', current_date + 325, 'certificate_no', 'MK-' || upper(substr(md5(r.id::text), 1, 6))));
  end loop;

  -- The bank checks machines before financing (receipts + events, SPEC §6.6).
  perform seed.act('bank@demo.se');
  for i in 1..16 loop
    perform public.perform_check(bank, jsonb_build_object('reg', (select reg_number from public.machines where id = seed.mid(i + 20))), 'Kreditprövning');
  end loop;

  -- Nordisk Maskinfinans checks the dealers' stock.
  perform seed.act('finans@demo.se');
  for i in 1..12 loop
    perform public.perform_check(seed.org('nordisk-maskinfinans'), jsonb_build_object('reg', (select reg_number from public.machines where id = seed.mid(i + 30))), 'Kreditprövning');
  end loop;

  -- Public scans in different towns (access log, SPEC §17); the stolen Cat 950 GC is scanned in Norrköping.
  for r in select l.code, row_number() over (order by l.code) n from public.labels l where l.status = 'bound' and l.role = 'primary' order by l.code limit 30 loop
    perform public.log_public_scan(r.code, null, md5('seed-ip-' || r.n), 'mobile',
      jsonb_build_object('city', cities[1 + r.n % 10], 'lat', lat[1 + r.n % 10], 'lng', lng[1 + r.n % 10]));
  end loop;
  select l.code into code from public.labels l where l.machine_id = seed.mid(4) and l.status = 'bound' limit 1;
  if code is not null then
    perform public.log_public_scan(code, null, md5('seed-ip-stolen'), 'mobile', '{"city":"Norrköping","lat":58.588,"lng":16.192}'::jsonb);
  end if;
end $$;
