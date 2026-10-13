-- =====================================================================================================================
-- FEATURE_PRICING – the price list is taken off the product until further notice (ADR 0033).
--
-- The product owner wants no price information visible for now. Everything stays in the code and in the database;
-- a superadmin turns it back on from the operator's flag page.
--
-- Deliberately NOT written as `app.flag('FEATURE_PRICING') or app.is_demo_mode()`, which is the pattern every other
-- feature guard uses (20260927000026:19,128 and 20260927000024:145). That pattern turns a feature *on* in demo mode,
-- and staging runs in demo mode – which is exactly where the prices must be gone.
-- =====================================================================================================================

insert into public.app_config (key, value, description) values
  ('FEATURE_PRICING', 'false', 'Public price list, the billing tab and the label order price preview')
on conflict (key) do nothing;

create or replace function app.pricing_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.flag('FEATURE_PRICING')
$$;
grant execute on function app.pricing_enabled() to anon, authenticated, service_role;

-- ---------- Public: plans and prices (/pricing) ----------
-- list_plans is anon-granted (20260927000024:528), so it must answer rather than raise: the callers index
-- price_items directly (LabelsPage.tsx:84-87). With pricing off it returns the shape with nothing in it, and
-- `pricing_enabled` tells the client to hide the surface instead of rendering "0 kr".
create or replace function public.list_plans()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pricing_enabled', app.pricing_enabled(),
    'plans', case when app.pricing_enabled()
      then coalesce((select jsonb_agg(app.plan_json(p) order by p.sort) from public.plans p where p.is_public and p.active), '[]'::jsonb)
      else '[]'::jsonb end,
    'price_items', case when app.pricing_enabled()
      then coalesce((select jsonb_object_agg(key, unit_price_ore) from public.price_items), '{}'::jsonb)
      else '{}'::jsonb end,
    'vat_rate', app.config_text('BILLING_VAT_RATE', '0.25')::numeric,
    'currency', 'SEK')
$$;
