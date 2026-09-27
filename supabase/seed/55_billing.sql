-- Step 23 demo data: Demo Bank Finans on the lender plan and Nordmaskin on the dealer plan (mock provider), last
-- month's usage, and last month's invoices – the bank's paid, Nordmaskin's open (pay it with "Betala (demo)").
do $$
declare bank uuid := seed.org('demo-bank-finans'); nord uuid := seed.org('nordmaskin-ab'); berg uuid := seed.org('bergs-schakt-entreprenad-ab');
  prev date := (app.billing_period() - interval '1 month')::date;
begin
  perform public.billing_apply_subscription(bank, 'financier', 'active', 'mock', 'cus_mock_bank', 'sub_mock_bank', null);
  perform public.billing_apply_subscription(nord, 'dealer', 'active', 'mock', 'cus_mock_nord', 'sub_mock_nord', null);
  update public.subscriptions set started_at = prev - interval '2 months', billing_email = case when org_id = bank then 'faktura@bank.demo.se' else 'faktura@nordmaskin.demo.se' end,
    invoice_reference = case when org_id = bank then 'Kreditavd. 4410' end
  where org_id in (bank, nord);
  -- Last month: the bank checked 540 machines (40 above the plan), Nordmaskin 63 (13 above) and called the API.
  insert into public.usage_records (org_id, metric, quantity, period, ref, occurred_at)
  select bank, 'check', 1, prev, 'seed-bank-check-' || g, prev + (g % 28) * interval '1 day' from generate_series(1, 540) g
  union all select nord, 'check', 1, prev, 'seed-nord-check-' || g, prev + (g % 28) * interval '1 day' from generate_series(1, 63) g
  union all select nord, 'api_call', 7400, prev, 'seed-nord-api', prev + interval '10 days'
  union all select berg, 'label_qr', 50, prev, 'seed-berg-labels', prev + interval '3 days';
  perform public.close_billing_period(prev);
  update public.invoices set status = 'paid', paid_at = issued_at + interval '6 days' where org_id = bank and period = prev;
end $$;
