-- Market surveillance demo (SPEC §8, §16 p.16): a stolen machine shows up in a partner-feed listing, and Nordmaskin
-- has three advertised machines that are not yet registered (candidates). Sources stay disabled after seeding.
do $$
declare run jsonb;
begin
  update public.market_sources set enabled = true where key = 'partner-feed';
  run := public.start_market_run('partner-feed');
  perform public.ingest_observations((run ->> 'run_id')::uuid, jsonb_build_array(
    jsonb_build_object('external_id', 'PF-10421', 'url', 'https://partner.example/annons/10421', 'category', 'hjullastare', 'make', 'Caterpillar',
      'model', '950 GC', 'year', 2018, 'hours', 2710, 'price_amount', 610000, 'price_vat_included', false, 'location', 'Norrköping',
      'seller_type', 'business', 'seller_name', 'Maskinförmedling Öst AB', 'seller_org_number', '556702-0010', 'serial', 'CAT0950GC78397',
      'raw', jsonb_build_object('title', 'CAT 950 GC hjullastare', 'condition', 'used')),
    jsonb_build_object('external_id', 'PF-20001', 'url', 'https://partner.example/annons/20001', 'category', 'bandgrävare', 'make', 'Hitachi',
      'model', 'ZX135US-6', 'year', 2020, 'hours', 4120, 'location', 'Uppsala', 'seller_type', 'business', 'seller_name', 'Nordmaskin AB',
      'seller_org_number', '556701-1001', 'serial', 'HCMDBG50A00201345'),
    jsonb_build_object('external_id', 'PF-20002', 'url', 'https://partner.example/annons/20002', 'category', 'hjullastare', 'make', 'Liebherr',
      'model', 'L 526', 'year', 2017, 'hours', 8830, 'location', 'Uppsala', 'seller_type', 'business', 'seller_name', 'Nordmaskin AB',
      'seller_org_number', '556701-1001', 'serial', 'LBH05262017X4411'),
    jsonb_build_object('external_id', 'PF-20003', 'url', 'https://partner.example/annons/20003', 'category', 'dumper', 'make', 'Volvo',
      'model', 'A30G', 'year', 2019, 'hours', 9105, 'location', 'Enköping', 'seller_type', 'business', 'seller_name', 'Nordmaskin AB',
      'seller_org_number', '556701-1001', 'serial', 'VCE0A30GC00345678'),
    jsonb_build_object('external_id', 'PF-30001', 'url', 'https://partner.example/annons/30001', 'category', 'minigrävare', 'make', 'Kubota',
      'model', 'KX019-4', 'year', 2015, 'hours', 3100, 'location', 'Borås', 'seller_type', 'private', 'seller_name', 'Privat Säljare')
  ), true);
  -- 145 further listings across makes, sellers and towns (150 in total, SPEC §17). Two of them share a serial number
  -- with different sellers (duplicate_serial_in_market); private sellers carry no identity.
  perform public.ingest_observations((run ->> 'run_id')::uuid, (
    select jsonb_agg(jsonb_build_object(
      'external_id', 'PF-' || (40000 + g),
      'url', 'https://partner.example/annons/' || (40000 + g),
      'category', (array['bandgrävare', 'hjullastare', 'dumper', 'minigrävare', 'traktor', 'teleskoplastare', 'skotare', 'vält'])[1 + g % 8],
      'make', (array['Volvo', 'Caterpillar', 'Komatsu', 'Hitachi', 'Liebherr', 'JCB', 'Kubota', 'John Deere', 'Ponsse', 'Manitou', 'Bell', 'Valtra'])[1 + g % 12],
      'model', (array['EC220E', '320', 'PC210', 'ZX210', 'R 926', '3CX', 'KX080-4', '1270G', 'Ergo', 'MT1840', 'B30E', 'T235'])[1 + g % 12],
      'year', 2008 + g % 17,
      'hours', 800 + (g * 373) % 14000,
      'price_amount', 150000 + (g * 7919) % 1850000,
      'price_vat_included', g % 3 = 0,
      'location', (array['Uppsala', 'Västerås', 'Örebro', 'Jönköping', 'Luleå', 'Sundsvall', 'Karlstad', 'Växjö', 'Gävle', 'Kalmar'])[1 + g % 10],
      'seller_type', case when g % 4 = 0 then 'private' else 'business' end,
      'seller_name', case when g % 4 = 0 then null else (array['Maskinbörsen Syd AB', 'Begagnade Maskiner i Norr AB', 'Entreprenadhandel Mitt AB', 'Lantmaskiner Väst AB'])[1 + g % 4] end,
      'seller_org_number', case when g % 4 = 0 then null else (array['556702-0028', '556702-0036', '556702-0044', '556702-0051'])[1 + g % 4] end,
      'serial', case when g in (5, 6) then 'VCEEC220E00991122' when g % 3 = 0 then 'SEED' || lpad(g::text, 8, '0') end,
      'raw', jsonb_build_object('title', 'Begagnad maskin ' || g)))
    from generate_series(1, 145) g), false);
  perform public.finish_market_run((run ->> 'run_id')::uuid, 'ok');
  update public.market_sources set enabled = false where key = 'partner-feed';
end $$;
