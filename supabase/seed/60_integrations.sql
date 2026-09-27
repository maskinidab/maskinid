-- Step 25 demo data: Bergs has demo telematics that reported hours and positions for three machines; the stolen flags
-- have been sent to the theft register (mock) and one external report without a match waits for review.
do $$
declare berg uuid := seed.org('bergs-schakt-entreprenad-ab'); c jsonb; q jsonb;
begin
  perform seed.act('berg@demo.se');
  c := public.create_telematics_connection(berg, 'mock', 'Demotelematik', null, null);
  perform public.telematics_ingest((c ->> 'id')::uuid, (
    select jsonb_agg(jsonb_build_object('external_id', 'MOCK-' || i.value, 'serial', i.value, 'hours', coalesce(m.hour_meter, 0) + 6 + n,
      'lat', 59.3293 + n * 0.21, 'lon', 18.0686 - n * 0.35, 'position_at', now() - (n || ' hours')::interval))
    from (select m2.*, row_number() over (order by m2.reg_number) n from public.machines m2
          where m2.owner_org_id = berg and m2.status = 'active' order by m2.reg_number limit 3) m
    join lateral (select value from public.machine_identifiers where machine_id = m.id and type = 'serial' limit 1) i on true));
  for q in select * from jsonb_array_elements(public.claim_theft_sync(50)) loop
    perform public.record_theft_sync_result((q ->> 'id')::uuid, true, 'LT-DEMO-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'), null);
  end loop;
  perform public.ingest_external_theft_reports('larmtjanst', jsonb_build_array(jsonb_build_object('serial', 'HIT0L420S19045', 'make', 'Hitachi',
    'model', 'ZX210', 'status', 'stolen', 'reportedAt', now() - interval '3 days', 'externalRef', 'LT-2026-118204')));
end $$;
