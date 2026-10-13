import { describe, expect, it } from "vitest";
import { annuityMonthly, CALCULATOR_CASES, calculateFinancing } from "./financing.ts";

describe("financing terms calculator (ADR 0029)", () => {
  it("matches every shared case", () => {
    // The same table drives the SQL/TypeScript agreement test in supabase/tests/26_financing_terms.test.ts.
    for (const c of CALCULATOR_CASES) {
      const r = calculateFinancing(c.terms);
      expect(r, JSON.stringify(c.terms)).toEqual({ total_credit_amount: c.credit, monthly_cost: c.monthly });
    }
  });

  it("no interest amortises the part that is actually paid off", () => {
    expect(annuityMonthly({ principal: 120_000, residual: 0, months: 12, yearlyRate: 0 })).toBe(10_000);
    expect(annuityMonthly({ principal: 120_000, residual: 60_000, months: 12, yearlyRate: 0 })).toBe(5_000);
    // A missing rate is the same as no interest, not an error.
    expect(annuityMonthly({ principal: 120_000, months: 12 })).toBe(10_000);
  });

  it("a residual equal to the principal leaves interest only", () => {
    // Nothing is amortised, so the payment is one month's interest on the whole amount.
    expect(annuityMonthly({ principal: 240_000, residual: 240_000, months: 36, yearlyRate: 5 })).toBe(1_000);
  });

  it("a higher rate costs more and a longer term costs less per month", () => {
    const base = annuityMonthly({ principal: 500_000, residual: 0, months: 60, yearlyRate: 5 })!;
    expect(annuityMonthly({ principal: 500_000, residual: 0, months: 60, yearlyRate: 8 })!).toBeGreaterThan(base);
    expect(annuityMonthly({ principal: 500_000, residual: 0, months: 120, yearlyRate: 5 })!).toBeLessThan(base);
    // A residual lowers the monthly cost – that is the point of one.
    expect(annuityMonthly({ principal: 500_000, residual: 150_000, months: 60, yearlyRate: 5 })!).toBeLessThan(base);
  });

  it("the payments add up to the credit plus interest, and leave the residual", () => {
    // Amortising by hand for 60 months must land on the residual, which is what makes the formula right.
    // Within a krona, not to the öre: the payment itself is rounded to two decimals, and 60 rounded payments
    // drift a few öre from the exact annuity. A real contract settles that on the last instalment.
    const principal = 1_000_000;
    const residual = 200_000;
    const months = 60;
    const rate = 6.45;
    const pay = annuityMonthly({ principal, residual, months, yearlyRate: rate })!;
    let balance = principal;
    for (let i = 0; i < months; i++) balance = balance * (1 + rate / 100 / 12) - pay;
    expect(balance).toBeCloseTo(residual, 0);
  });

  it("returns null rather than a number when the terms do not determine one", () => {
    expect(annuityMonthly({ principal: 0, months: 60, yearlyRate: 5 })).toBeNull();
    expect(annuityMonthly({ principal: 100_000, months: 0, yearlyRate: 5 })).toBeNull();
    expect(annuityMonthly({ principal: 100_000, months: null, yearlyRate: 5 })).toBeNull();
    expect(annuityMonthly({ principal: null, months: 60, yearlyRate: 5 })).toBeNull();
    expect(annuityMonthly({ principal: 100_000, residual: 100_001, months: 60, yearlyRate: 5 })).toBeNull();
    expect(annuityMonthly({ principal: 100_000, residual: -1, months: 60, yearlyRate: 5 })).toBeNull();
    expect(annuityMonthly({ principal: Number.NaN, months: 60 })).toBeNull();
  });

  it("the down payment is taken out of the credit, not out of the machine's value", () => {
    expect(calculateFinancing({ financing_amount: 800_000, down_payment: 200_000 }).total_credit_amount).toBe(600_000);
    // No down payment given is the same as none paid.
    expect(calculateFinancing({ financing_amount: 800_000 }).total_credit_amount).toBe(800_000);
    expect(calculateFinancing({ down_payment: 200_000 }).total_credit_amount).toBeNull();
  });
});
