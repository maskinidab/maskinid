-- Step 21 demo data: Bergs consigns a forklift to Nordmaskin and has departments; Skogsmaskiner Norr is a subsidiary
-- of Nordmaskin (group view).
do $$
declare berg uuid := seed.org('bergs-schakt-entreprenad-ab'); nord uuid := seed.org('nordmaskin-ab'); norr uuid := seed.org('skogsmaskiner-norr-ab');
  sig uuid; d jsonb; vt date := current_date + 90; dep1 uuid; dep2 uuid; l jsonb;
begin
  perform seed.act('berg@demo.se');
  sig := seed.sign(berg, 'grant_mandate', berg, jsonb_build_object('agent_org_id', nord, 'machine_id', seed.mid(11)::text, 'scopes', 'sell, view', 'valid_to', vt::text));
  d := public.grant_mandate(berg, nord, 'consignment', seed.mid(11), array['sell', 'view'], vt, 'Säljs i kommission, lägsta pris enligt avtal', sig);
  dep1 := (public.save_department(berg, 'Anläggning', 'ANL') ->> 'id')::uuid;
  dep2 := (public.save_department(berg, 'Mark & schakt', 'MS') ->> 'id')::uuid;
  perform public.set_machine_department(berg, seed.mid(i), case when i % 2 = 0 then dep1 else dep2 end)
  from generate_series(1, 12) i join public.machines m on m.id = seed.mid(i) where m.status = 'active';
  perform seed.act('nordmaskin@demo.se');
  perform public.respond_mandate(nord, (d ->> 'id')::uuid, true);
  perform seed.act('norr@demo.se');
  l := public.request_group_link(norr, nord);
  perform seed.act('nordmaskin@demo.se');
  perform public.decide_group_link(nord, (l ->> 'id')::uuid, true);
end $$;
