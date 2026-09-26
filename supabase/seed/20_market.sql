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
  perform public.finish_market_run((run ->> 'run_id')::uuid, 'ok');
  update public.market_sources set enabled = false where key = 'partner-feed';
end $$;
