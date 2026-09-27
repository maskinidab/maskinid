-- Step 22 demo data: the stolen machines are on the public stolen list, a tip about one of them, one answered support
-- ticket, and every demo user has accepted the current legal documents (so the demo is not interrupted; publish a new
-- version under /admin/legal to see the acceptance gate).
do $$
declare berg uuid := seed.org('bergs-schakt-entreprenad-ab'); op uuid; tk jsonb; f record;
begin
  for f in select fl.id, fl.raised_by_org_id, u.email from public.flags fl
      join public.memberships ms on ms.org_id = fl.raised_by_org_id and ms.role = 'admin' and ms.status = 'active'
      join auth.users u on u.id = ms.user_id
    where fl.type = 'stolen' and fl.status = 'active' and fl.machine_id in (seed.mid(4), seed.mid(18)) loop
    perform seed.act(f.email);
    perform public.set_flag_public(f.raised_by_org_id, f.id, true);
  end loop;

  perform public.submit_tip('seen_machine', (select reg_number from public.machines where id = seed.mid(4)),
    'Gul hjullastare utan dekaler står på en grusplan vid avfarten mot Kållered sedan i måndags.', '{"city": "Mölndal"}', null, null, null);

  perform seed.act('berg@demo.se');
  tk := public.create_support_ticket(berg, 'labels', 'Byta skadat QR-märke',
    'Märket på vår grävare har skadats vid rivning. Hur byter vi det utan att maskinen tappar sin historik?',
    (select reg_number from public.machines where id = seed.mid(1)));
  perform seed.act('admin@demo.se');
  op := (select org_id from public.memberships where user_id = auth.uid() limit 1);
  perform public.add_ticket_message(op, (tk ->> 'id')::uuid,
    'Hej. Återkalla det skadade märket under Märken på maskinsidan och koppla ett nytt. Historiken sitter på maskinen, inte på märket, så inget går förlorat.');

  insert into public.legal_acceptances (user_id, key, version)
  select u.id, d.key, d.version from auth.users u
    cross join (select distinct on (key) key, version from public.legal_documents where requires_acceptance order by key, version desc) d
  on conflict do nothing;
end $$;
