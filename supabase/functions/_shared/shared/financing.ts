/**
 * Financing terms arithmetic, shared by the web app, the Edge Functions and the database tests (ADR 0029).
 *
 * `app.annuity_monthly` in SQL computes the same thing, because `register_encumbrance` is reachable over the API
 * without a browser and the server has to be able to fill in the monthly cost itself. The two implementations are
 * checked against each other over CALCULATOR_CASES in supabase/tests/26_financing_terms.test.ts – two formulas
 * that drift apart is the kind of thing a lender disputes.
 *
 * All amounts are in kronor (not öre): these are contract figures a person types in, not invoice lines.
 */

export interface FinancingTerms {
  /** What is financed, before the down payment. */
  financing_amount?: number | null;
  /** Kontantinsats – paid up front, so it is not part of the credit. */
  down_payment?: number | null;
  /** Restvärde – the balloon left at the end of the term. */
  residual_value?: number | null;
  /** Amorteringstid in months. */
  amortization_months?: number | null;
  /** Nominal yearly interest rate in percent, e.g. 6.45. */
  interest_rate?: number | null;
}

export interface FinancingCalculation {
  /** financing_amount - down_payment, i.e. what is actually borrowed. */
  total_credit_amount: number | null;
  /** Monthly payment, rounded to whole kronor, or null when the inputs do not determine one. */
  monthly_cost: number | null;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Annuity with a residual value (balloon):
 *
 *   payment = (principal - residual / (1 + r)^n) * r / (1 - (1 + r)^-n)
 *
 * where r is the monthly rate and n the number of months. The residual is discounted back to today and taken out
 * of the principal, which is what a leasing contract with a restvärde actually amortises.
 *
 * With no interest it degrades to straight-line amortisation of the part that is paid off: (principal - residual) / n.
 * Returns null when the terms do not determine a payment (no principal, no term, or a residual above the principal).
 */
export function annuityMonthly(input: {
  principal: number | null | undefined;
  residual?: number | null;
  months: number | null | undefined;
  yearlyRate?: number | null;
}): number | null {
  const principal = num(input.principal);
  const months = num(input.months);
  const residual = num(input.residual) ?? 0;
  const yearlyRate = num(input.yearlyRate) ?? 0;
  if (principal === null || months === null || months <= 0 || principal <= 0) return null;
  if (residual < 0 || residual > principal) return null;
  if (yearlyRate <= 0) return round2((principal - residual) / months);
  const r = yearlyRate / 100 / 12;
  const discount = (1 + r) ** -months;
  const amortised = principal - residual * discount;
  return round2((amortised * r) / (1 - discount));
}

/** Two decimals, so SQL numeric(14,2) and TypeScript agree to the öre. */
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** The two derived figures shown in the finance calculator and stored on the encumbrance. */
export function calculateFinancing(terms: FinancingTerms): FinancingCalculation {
  const amount = num(terms.financing_amount);
  const down = num(terms.down_payment) ?? 0;
  const credit = amount === null ? null : round2(amount - down);
  return {
    total_credit_amount: credit,
    monthly_cost: annuityMonthly({
      principal: credit,
      residual: terms.residual_value,
      months: terms.amortization_months,
      yearlyRate: terms.interest_rate,
    }),
  };
}

/**
 * Shared cases for the SQL/TypeScript agreement test. Kept here rather than in the test file so the database test
 * and the unit test read the same table.
 */
export const CALCULATOR_CASES: { terms: FinancingTerms; monthly: number | null; credit: number | null }[] = [
  // The product owner's own example from the finance calculator.
  { terms: { financing_amount: 1_250_000, down_payment: 250_000, residual_value: 200_000, amortization_months: 60, interest_rate: 6.45 },
    monthly: 16_709.19, credit: 1_000_000 },
  // No interest: straight-line amortisation of what is actually paid off.
  { terms: { financing_amount: 600_000, down_payment: 0, residual_value: 120_000, amortization_months: 48, interest_rate: 0 },
    monthly: 10_000, credit: 600_000 },
  // No residual: a plain annuity.
  { terms: { financing_amount: 500_000, down_payment: 100_000, residual_value: 0, amortization_months: 36, interest_rate: 5 },
    monthly: 11_988.36, credit: 400_000 },
  // Residual equal to the credit: interest only.
  { terms: { financing_amount: 300_000, down_payment: 0, residual_value: 300_000, amortization_months: 24, interest_rate: 6 },
    monthly: 1_500, credit: 300_000 },
  // A term of one month.
  { terms: { financing_amount: 100_000, down_payment: 0, residual_value: 0, amortization_months: 1, interest_rate: 12 },
    monthly: 101_000, credit: 100_000 },
  // Not determined: no term.
  { terms: { financing_amount: 400_000, down_payment: 0, residual_value: 0, amortization_months: null, interest_rate: 5 },
    monthly: null, credit: 400_000 },
  // Not determined: a residual above what is borrowed.
  { terms: { financing_amount: 200_000, down_payment: 50_000, residual_value: 180_000, amortization_months: 60, interest_rate: 5 },
    monthly: null, credit: 150_000 },
  // Nothing filled in at all.
  { terms: {}, monthly: null, credit: null },
];
