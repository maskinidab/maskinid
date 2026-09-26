-- Step 20 demo data: attachments, operators with certificates, daily checks (one with a critical fault) and fuel for
-- Bergs Schakt, so the fleet pages and the climate report have something to show.
do $$
declare berg uuid := seed.org('bergs-schakt-entreprenad-ab'); a uuid; o1 uuid; o2 uuid; tpl jsonb; r record; i int; fuel text;
begin
  perform seed.act('berg@demo.se');
  a := (public.save_attachment(berg, '{"type":"tiltrotator","make":"Rototilt","model":"R6","serial":"RT6-20417","year":2021,"weight_kg":620}') ->> 'id')::uuid;
  perform public.mount_attachment(berg, a, seed.mid(2));
  perform public.save_attachment(berg, '{"type":"hammer","make":"Epiroc","model":"MB 1700","serial":"EPMB17-8832","year":2019,"weight_kg":1750}');
  a := (public.save_attachment(berg, '{"type":"bucket","make":"Hultdins","model":"Planeringsskopa 1800","year":2022,"weight_kg":410}') ->> 'id')::uuid;
  perform public.mount_attachment(berg, a, seed.mid(3));
  perform public.save_attachment(berg, '{"type":"fork","make":"Stigab","model":"Pallgafflar 2,5 t","year":2020}');
  o1 := (public.save_operator(berg, '{"name":"Anders Lind","employee_ref":"B-104"}') ->> 'id')::uuid;
  o2 := (public.save_operator(berg, '{"name":"Maria Ek","employee_ref":"B-117"}') ->> 'id')::uuid;
  perform public.add_operator_certificate(berg, o1, jsonb_build_object('type', 'machine_operator_licence', 'issued_at', current_date - 2000, 'valid_until', current_date + 900));
  perform public.add_operator_certificate(berg, o1, jsonb_build_object('type', 'road_safety', 'label', 'Säkerhet på väg, steg 1.1', 'valid_until', current_date + 25));
  perform public.add_operator_certificate(berg, o2, jsonb_build_object('type', 'machine_operator_licence', 'issued_at', current_date - 800));
  perform public.add_operator_certificate(berg, o2, jsonb_build_object('type', 'crane', 'valid_until', current_date - 10));
  perform public.assign_operator(berg, seed.mid(2), o1);
  perform public.assign_operator(berg, seed.mid(7), o2);
  -- Daily checks: clean ones on the excavators, and a leaking hose that takes the Kubota out of service.
  select to_jsonb(t) into tpl from public.checklist_templates t where t.org_id is null and cardinality(t.categories) = 0;
  for i in 1..3 loop
    perform public.submit_daily_check(berg, seed.mid(2), (tpl ->> 'id')::uuid,
      (select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'ok', true)) from jsonb_array_elements(tpl -> 'items') x), null, o1, null);
  end loop;
  perform public.submit_daily_check(berg, seed.mid(3), (tpl ->> 'id')::uuid,
    (select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'ok', x ->> 'id' <> 'leaks', 'note', case when x ->> 'id' = 'leaks' then 'Läckage vid bomcylinder' end))
     from jsonb_array_elements(tpl -> 'items') x), null, o2, 'Ringt verkstaden');
  -- Fuel: weekly refuelling, part HVO100, over the last 60 days.
  for r in select mp.slot from seed.machine_plan mp join public.machines m on m.id = seed.mid(mp.slot)
           where mp.plan = 'berg' and m.status = 'active' and m.fuel_type is distinct from 'electric' order by mp.slot loop
    for i in 0..7 loop
      fuel := case when (r.slot + i) % 3 = 0 then 'diesel' else 'hvo100' end;
      insert into public.fuel_entries (machine_id, org_id, entry_date, fuel, quantity, unit, project_id, created_by)
      values (seed.mid(r.slot), berg, current_date - 7 * i - r.slot % 5, fuel, 120 + (r.slot * 37 + i * 13) % 260, 'l',
        (select project_id from public.machine_assignments where machine_id = seed.mid(r.slot) and to_date is null limit 1), seed.act('berg@demo.se'));
    end loop;
  end loop;
end $$;
