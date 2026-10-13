-- =====================================================================================================================
-- Financing terms on an encumbrance, for the owner and the lender only (ADR 0029).
--
-- The product owner asked to be able to fill in amortisation period, residual value and financing amount by hand,
-- and to tie the financing to the bank's own agreement number. ADR 0025 refused amounts outright and CLAUDE.md
-- rule 5 said the register stores none; that rule is now narrowed rather than dropped:
--
--   * `payoff_requests` stays amount-free. The payoff figure still lives only inside the lender's PDF.
--   * No purchase price and no outstanding debt anywhere.
--   * The terms of a financing (amount, down payment, residual, amortisation period, interest) are stored on the
--     encumbrance and readable by the machine's owner and by the lender holding it. Nobody else: not a dealer at
--     trade-in, not an authority, not an insurer, not the operator, not a share link, not a public card.
--
-- That last property is enforced by *not* hanging the terms on app.encumbrance_json's existing `p_full` flag,
-- which is already true for operators and authorities. Instead app.encumbrance_terms_json is a separate object
-- that each caller has to add deliberately, and supabase/tests/26_financing_terms.test.ts walks every
-- serialisation path to prove it is absent everywhere else.
--
-- The agreement number becomes mandatory. It is enforced in the RPCs, not as a column constraint: a CHECK (even
-- NOT VALID) is still evaluated on every UPDATE of an existing row, and release_encumbrance / settle_payoff /
-- accept_transfer all update rows that were created before the requirement existed. A constraint would make a
-- bank unable to release an old financing.
-- =====================================================================================================================

alter table public.encumbrances
  add column if not exists financing_amount    numeric(14, 2),
  add column if not exists down_payment        numeric(14, 2),
  add column if not exists residual_value      numeric(14, 2),
  add column if not exists amortization_months int,
  add column if not exists interest_rate       numeric(6, 3),
  add column if not exists monthly_cost        numeric(14, 2),
  add column if not exists total_credit_amount numeric(14, 2),
  add column if not exists terms_overridden    boolean not null default false;

alter table public.encumbrances
  add constraint encumbrances_terms_sane check (
    (financing_amount    is null or financing_amount    >= 0) and
    (down_payment        is null or down_payment        >= 0) and
    (residual_value      is null or residual_value      >= 0) and
    (monthly_cost        is null or monthly_cost        >= 0) and
    (total_credit_amount is null or total_credit_amount >= 0) and
    (amortization_months is null or amortization_months between 1 and 240) and
    (interest_rate       is null or interest_rate between 0 and 100) and
    (financing_amount is null or down_payment is null or down_payment <= financing_amount) and
    (residual_value is null or total_credit_amount is null or residual_value <= total_credit_amount));

comment on column public.encumbrances.financing_amount is 'Financed amount in kronor. Readable by the machine owner and the holder only (ADR 0029).';
comment on column public.encumbrances.down_payment is 'Kontantinsats in kronor. Owner and holder only (ADR 0029).';
comment on column public.encumbrances.residual_value is 'Restvärde / balloon in kronor. Owner and holder only (ADR 0029).';
comment on column public.encumbrances.amortization_months is 'Amorteringstid in months. Owner and holder only (ADR 0029).';
comment on column public.encumbrances.interest_rate is 'Nominal yearly interest rate in percent. Owner and holder only (ADR 0029).';
comment on column public.encumbrances.monthly_cost is 'Monthly payment: computed by app.annuity_monthly unless terms_overridden. Owner and holder only.';
comment on column public.encumbrances.total_credit_amount is 'financing_amount - down_payment. Owner and holder only.';
comment on column public.encumbrances.terms_overridden is 'The monthly cost was typed in rather than computed, so a later change to the formula must not rewrite it.';

-- ---------- The calculator, in SQL as well as in TypeScript ----------
-- register_encumbrance is reachable over api-v1 without a browser, so the server has to be able to compute the
-- monthly cost itself. packages/shared/src/financing.ts is the same formula; 26_financing_terms.test.ts checks the
-- two against each other over CALCULATOR_CASES, because two formulas that drift apart is what a lender disputes.
--
--   payment = (principal - residual * (1+r)^-n) * r / (1 - (1+r)^-n)
--
-- With no interest it degrades to straight-line amortisation of the part that is actually paid off.
create or replace function app.annuity_monthly(p_principal numeric, p_residual numeric, p_months int, p_rate numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare r numeric; d numeric; residual numeric := coalesce(p_residual, 0); rate numeric := coalesce(p_rate, 0);
begin
  if p_principal is null or p_months is null or p_months <= 0 or p_principal <= 0 then return null; end if;
  if residual < 0 or residual > p_principal then return null; end if;
  if rate <= 0 then return round((p_principal - residual) / p_months, 2); end if;
  r := rate / 100 / 12;
  d := power(1 + r, -p_months);
  return round(((p_principal - residual * d) * r) / (1 - d), 2);
end $$;

-- ---------- Agreement number is mandatory ----------
-- A separate function rather than a fourth parameter on app.validate_encumbrance_params: that one is immutable
-- and 3-argument, and a defaulted parameter would leave an ambiguous overload behind.
create or replace function app.require_contract_ref(p_contract_ref text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := nullif(trim(coalesce(p_contract_ref, '')), '');
begin
  -- The bank has to be able to tie the machine in the register to the right financing agreement on its own side,
  -- so this is the one field a financing cannot be registered without (Rikard's request).
  if v is null then perform app.raise('VALIDATION', '{"field":"contract_ref","reason":"required"}'); end if;
  if length(v) > 100 then perform app.raise('VALIDATION', '{"field":"contract_ref","reason":"too_long"}'); end if;
  return v;
end $$;

-- ---------- Terms in and out ----------
-- Normalises a { financing_amount, down_payment, residual_value, amortization_months, interest_rate,
-- monthly_cost } object, computing monthly_cost and total_credit_amount unless a monthly cost was given.
create or replace function app.financing_terms_patch(p_terms jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare amount numeric; down numeric; residual numeric; months int; rate numeric; credit numeric; monthly numeric;
  given numeric; overridden boolean;
begin
  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then return null; end if;
  amount   := nullif(p_terms ->> 'financing_amount', '')::numeric;
  down     := nullif(p_terms ->> 'down_payment', '')::numeric;
  residual := nullif(p_terms ->> 'residual_value', '')::numeric;
  months   := nullif(p_terms ->> 'amortization_months', '')::int;
  rate     := nullif(p_terms ->> 'interest_rate', '')::numeric;
  given    := nullif(p_terms ->> 'monthly_cost', '')::numeric;
  credit   := case when amount is null then null else round(amount - coalesce(down, 0), 2) end;
  monthly  := app.annuity_monthly(credit, residual, months, rate);
  -- A typed-in monthly cost wins and is marked, so a later change to the formula never rewrites the bank's figure.
  overridden := given is not null and (monthly is null or given <> monthly);
  return jsonb_build_object(
    'financing_amount', amount, 'down_payment', down, 'residual_value', residual,
    'amortization_months', months, 'interest_rate', rate,
    'total_credit_amount', credit, 'monthly_cost', coalesce(given, monthly), 'terms_overridden', overridden);
end $$;

-- The terms as JSON. Deliberately its own object: callers add it only where the reader is the owner or the holder,
-- instead of it riding along on encumbrance_json's p_full (which is also true for operators and authorities).
create or replace function app.encumbrance_terms_json(e public.encumbrances)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('terms', jsonb_build_object(
    'financing_amount', e.financing_amount, 'down_payment', e.down_payment, 'residual_value', e.residual_value,
    'amortization_months', e.amortization_months, 'interest_rate', e.interest_rate,
    'monthly_cost', e.monthly_cost, 'total_credit_amount', e.total_credit_amount,
    'terms_overridden', e.terms_overridden))
$$;

create or replace function app.apply_financing_terms(p_encumbrance_id uuid, p_terms jsonb)
returns public.encumbrances language plpgsql security definer set search_path = '' as $$
declare patch jsonb := app.financing_terms_patch(p_terms); e public.encumbrances;
begin
  if patch is null then
    select * into e from public.encumbrances where id = p_encumbrance_id;
    return e;
  end if;
  update public.encumbrances set
    financing_amount    = (patch ->> 'financing_amount')::numeric,
    down_payment        = (patch ->> 'down_payment')::numeric,
    residual_value      = (patch ->> 'residual_value')::numeric,
    amortization_months = (patch ->> 'amortization_months')::int,
    interest_rate       = (patch ->> 'interest_rate')::numeric,
    monthly_cost        = (patch ->> 'monthly_cost')::numeric,
    total_credit_amount = (patch ->> 'total_credit_amount')::numeric,
    terms_overridden    = (patch ->> 'terms_overridden')::boolean
  where id = p_encumbrance_id
  returning * into e;
  return e;
exception when check_violation then
  perform app.raise('VALIDATION', '{"field":"terms"}');
end $$;

grant execute on function app.annuity_monthly(numeric, numeric, int, numeric), app.require_contract_ref(text),
  app.financing_terms_patch(jsonb), app.encumbrance_terms_json(public.encumbrances) to authenticated, service_role;
revoke all on function app.apply_financing_terms(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.apply_financing_terms(uuid, jsonb) to service_role;
