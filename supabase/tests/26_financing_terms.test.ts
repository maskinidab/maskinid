import { describe, expect, it } from "vitest";
import { CALCULATOR_CASES, calculateFinancing } from "@maskinid/shared/financing.ts";
import { NEXT_YEAR, TODAY, encParams, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

/**
 * Financing terms belong to the machine's owner and to the lender holding that financing, and to nobody else
 * (ADR 0029). CLAUDE.md rule 5 was narrowed rather than dropped, and the narrowing is only worth anything if
 * every way of serialising an encumbrance is checked — so this file walks all of them.
 */

const TERMS = {
  financing_amount: 1_250_000,
  down_payment: 250_000,
  residual_value: 200_000,
  amortization_months: 60,
  interest_rate: 6.45,
};
const AMOUNT_RX = /financing_amount|down_payment|residual_value|monthly_cost|total_credit_amount|amortization_months|interest_rate/;

/** A machine owned by owner_a, financed by financier_a, with the terms filled in. */
async function financed(t: any, type = "leasing") {
  const m = await registerAs(t, "owner_a");
  await t.as("financier_a");
  const params = encParams(type, "AVT-TERMS-1", TODAY, NEXT_YEAR);
  const sig = await sign(t, ORGS.financier_a, "register_encumbrance", m.id, params);
  const r = await t.rpc("register_encumbrance", {
    p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: type, p_contract_ref: "AVT-TERMS-1",
    p_start_date: TODAY, p_end_date: NEXT_YEAR, p_counterparty_org_id: ORGS.owner_a, p_signature_id: sig,
    p_terms: TERMS,
  });
  return { m, enc: r.encumbrance };
}

describe("financing terms: the calculator agrees in SQL and in TypeScript (ADR 0029)", () => {
  it("app.annuity_monthly matches packages/shared/src/financing.ts to the öre", async () => {
    await tx(async (t) => {
      for (const c of CALCULATOR_CASES) {
        const patch = await t.val<any>("select app.financing_terms_patch($1::jsonb)", [JSON.stringify(c.terms)]);
        const label = JSON.stringify(c.terms);
        // An empty object still produces a patch with nulls; the TypeScript side agrees on the two figures.
        const sqlMonthly = patch.monthly_cost === null ? null : Number(patch.monthly_cost);
        const sqlCredit = patch.total_credit_amount === null ? null : Number(patch.total_credit_amount);
        expect(sqlMonthly, `monthly ${label}`).toBe(c.monthly);
        expect(sqlCredit, `credit ${label}`).toBe(c.credit);
        expect(calculateFinancing(c.terms), `ts ${label}`).toEqual({ monthly_cost: c.monthly, total_credit_amount: c.credit });
      }
    });
  });

  it("a typed-in monthly cost wins and is recorded as overridden", async () => {
    await tx(async (t) => {
      const given = await t.val<any>("select app.financing_terms_patch($1::jsonb)", [JSON.stringify({ ...TERMS, monthly_cost: 17_000 })]);
      expect(Number(given.monthly_cost)).toBe(17_000);
      expect(given.terms_overridden).toBe(true);
      // The same figure the formula would produce is not an override.
      const same = await t.val<any>("select app.financing_terms_patch($1::jsonb)", [JSON.stringify({ ...TERMS, monthly_cost: 16_709.19 })]);
      expect(same.terms_overridden).toBe(false);
    });
  });
});

describe("financing terms: who may read them (ADR 0029)", () => {
  it("the owner and the holding lender see the terms", async () => {
    await tx(async (t) => {
      const { m } = await financed(t);

      await t.as("owner_a");
      const asOwner = await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(Number(asOwner.financing.active.terms.financing_amount)).toBe(1_250_000);
      expect(Number(asOwner.financing.active.terms.total_credit_amount)).toBe(1_000_000);
      expect(Number(asOwner.financing.active.terms.monthly_cost)).toBeCloseTo(16_709.19, 2);

      await t.as("financier_a");
      const asHolder = await t.rpc<any>("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      expect(Number(asHolder.financing.active.terms.residual_value)).toBe(200_000);
      // And in the lender's own portfolio, which is the page it actually works in.
      const portfolio = await t.rpc<any[]>("list_portfolio", { p_org_id: ORGS.financier_a });
      expect(Number(portfolio[0].terms.financing_amount)).toBe(1_250_000);
    });
  });

  it("nobody else does, on any path that serialises an encumbrance", async () => {
    await tx(async (t) => {
      const { m } = await financed(t);
      const reg = await t.val<string>("select reg_number from public.machines where id = $1", [m.id]);

      // A second lender: no relation to this machine at all.
      await t.as("financier_b");
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.financier_b, p_machine_id: m.id })).code).toBe("NOT_FOUND");
      expect(JSON.stringify(await t.rpc("list_portfolio", { p_org_id: ORGS.financier_b }))).not.toMatch(AMOUNT_RX);
      expect(JSON.stringify(await t.rpc("lookup_machine", { p_org_id: ORGS.financier_b, p_query: reg }))).not.toMatch(AMOUNT_RX);
      // The financing check a lender actually runs before lending: yes/no, never the other bank's terms.
      expect(JSON.stringify(await t.rpc("perform_check", { p_org_id: ORGS.financier_b, p_query: { reg } }))).not.toMatch(AMOUNT_RX);

      // An authority sees everything about the machine, by design – but not the contract figures.
      await t.as("authority");
      const asAuthority = await t.rpc<any>("get_machine", { p_org_id: ORGS.authority, p_machine_id: m.id });
      expect(JSON.stringify(asAuthority)).not.toMatch(AMOUNT_RX);
      expect(asAuthority.financing.active.holder.id).toBe(ORGS.financier_a); // it does see who holds it

      // The operator runs the register and still has no business with the figures.
      await t.as("operator");
      expect(JSON.stringify(await t.rpc("get_machine", { p_org_id: ORGS.operator, p_machine_id: m.id }))).not.toMatch(AMOUNT_RX);

      await t.as("insurer");
      expect(JSON.stringify(await t.rpc("lookup_machine", { p_org_id: ORGS.insurer, p_query: reg }))).not.toMatch(AMOUNT_RX);

      // A dealer at trade-in: the one case the product owner's own flow walks through.
      await t.as("dealer");
      const lookup = await t.rpc<any>("trade_in_lookup", { p_org_id: ORGS.dealer, p_code: null, p_reg: reg });
      expect(lookup.financing.has_active).toBe(true);
      expect(JSON.stringify(lookup)).not.toMatch(AMOUNT_RX);

      // Public card and a share link: the two unauthenticated surfaces.
      await t.as("owner_a");
      const share = await t.rpc<any>("create_share_link", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_scope: "buyer_report", p_days: 7 });
      await t.as("anon");
      expect(JSON.stringify(await t.rpc("public_machine_card", { p_code: null, p_reg: reg }))).not.toMatch(AMOUNT_RX);
      // get_share_view is service-only: the page calls it through an Edge Function, not from the browser.
      await t.as("service");
      expect(JSON.stringify(await t.rpc("get_share_view", { p_token: share.token }))).not.toMatch(AMOUNT_RX);
    });
  });

  it("the hash-chained event log and the webhook queue carry no figures", async () => {
    await tx(async (t) => {
      const { m } = await financed(t);
      await t.as(null);
      // Events are exported in register extracts and readable by everyone with full access, so `terms_set`
      // records that figures exist without revealing them.
      const ev = await t.one<{ payload: any }>(
        "select payload from public.events where machine_id = $1 and type = 'encumbrance.registered'", [m.id]);
      expect(ev.payload.terms_set).toBe(true);
      expect(JSON.stringify(ev.payload)).not.toMatch(AMOUNT_RX);
      expect(await t.val(`select count(*)::int from public.events where machine_id = $1 and payload::text ~ $2`,
        [m.id, AMOUNT_RX.source])).toBe(0);
      expect(await t.val(`select count(*)::int from public.webhook_deliveries where payload::text ~ $1`,
        [AMOUNT_RX.source])).toBe(0);
    });
  });

  it("the buyer's financing in a sale does not leak through the transfer row", async () => {
    // transfers.new_financing is stored verbatim and app.transfer_json returns it, while open_transfer is shown
    // to the authority and to a dealer at trade-in. app.open_new_financing therefore moves the terms onto the
    // encumbrance and strips them off the transfer in the same transaction.
    await tx(async (t) => {
      const m = await registerAs(t, "dealer");
      await t.as("dealer");
      const r = await t.rpc<any>("initiate_transfer", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_sale_date: TODAY, p_to_org_id: ORGS.owner_b,
        p_new_financing: { holder_org_id: ORGS.financier_a, type: "leasing", contract_ref: "SALE-1", end_date: NEXT_YEAR, ...TERMS },
      });
      expect(JSON.stringify(r.transfer.new_financing)).not.toMatch(AMOUNT_RX);

      await t.as(null);
      expect(await t.val("select new_financing::text from public.transfers where machine_id = $1", [m.id])).not.toMatch(AMOUNT_RX);
      // They did land where they belong.
      const enc = await t.one<{ financing_amount: string; contract_ref: string }>(
        "select financing_amount, contract_ref from public.encumbrances where machine_id = $1", [m.id]);
      expect(Number(enc.financing_amount)).toBe(1_250_000);
      expect(enc.contract_ref).toBe("SALE-1");

      await t.as("authority");
      expect(JSON.stringify(await t.rpc("get_machine", { p_org_id: ORGS.authority, p_machine_id: m.id }))).not.toMatch(AMOUNT_RX);
    });
  });
});

describe("financing terms: the agreement number is mandatory (ADR 0029)", () => {
  it("every door that writes a financing refuses an empty agreement number", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");

      // Door 1: the lender registers it itself.
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "register_encumbrance", m.id, encParams("leasing", null, TODAY, NEXT_YEAR));
      for (const ref of [null, "", "   "]) {
        expect((await t.rpcError("register_encumbrance", {
          p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "leasing", p_contract_ref: ref,
          p_start_date: TODAY, p_end_date: NEXT_YEAR, p_signature_id: sig,
        })).code, `ref ${JSON.stringify(ref)}`).toBe("VALIDATION");
      }

      // Door 2: the owner or dealer reports it to the bank.
      await t.as("owner_a");
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: null, p_start_date: TODAY, p_end_date: NEXT_YEAR,
      })).code).toBe("VALIDATION");

      // Door 3: the buyer's financing from the sale flow.
      const m2 = await registerAs(t, "dealer");
      await t.as("dealer");
      expect((await t.rpcError("initiate_transfer", {
        p_org_id: ORGS.dealer, p_machine_id: m2.id, p_sale_date: TODAY, p_to_org_id: ORGS.owner_b,
        p_new_financing: { holder_org_id: ORGS.financier_a, type: "leasing", end_date: NEXT_YEAR },
      })).code).toBe("VALIDATION");
    });
  });

  it("the lender's bare prefix is not an agreement number", async () => {
    // Picking a lender fills in its prefix ("NF-"), so "submit without filling anything in" sent the prefix alone
    // and registered a financing the bank could not tie to any agreement.
    await tx(async (t) => {
      await t.as(null);
      await t.q(`update public.organizations set settings = coalesce(settings, '{}'::jsonb)
        || '{"financing_defaults":{"contract_ref_prefix":"FA-"}}'::jsonb where id = $1`, [ORGS.financier_a]);
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const report = (ref: string) => ({
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: ref, p_start_date: TODAY, p_end_date: NEXT_YEAR,
      });
      for (const ref of ["FA-", " fa- "]) {
        const e = await t.rpcError("request_encumbrance", report(ref));
        expect(e.code, ref).toBe("VALIDATION");
        expect(e.detail).toMatchObject({ field: "contract_ref", reason: "required" });
      }
      await t.as("owner_a");
      expect((await t.rpc<any>("request_encumbrance", report("FA-2026-17"))).ok).toBe(true);
    });
  });

  it("an agreement number longer than 100 characters is refused", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: "A".repeat(101), p_start_date: TODAY, p_end_date: NEXT_YEAR,
      })).code).toBe("VALIDATION");
    });
  });

  it("releasing a financing registered before the requirement still works", async () => {
    // The requirement is enforced in the RPCs rather than as a column constraint: a CHECK (even NOT VALID) is
    // evaluated on every UPDATE of an existing row, so release_encumbrance / settle_payoff / accept_transfer
    // would start failing on rows written before this migration.
    await tx(async (t) => {
      const { m } = await financed(t);
      await t.as(null);
      await t.q("update public.encumbrances set contract_ref = null where machine_id = $1", [m.id]);
      await t.as("financier_a");
      const e = await t.val<string>("select id::text from public.encumbrances where machine_id = $1", [m.id]);
      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", e, {});
      const r = await t.rpc<any>("release_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: e, p_signature_id: sig });
      expect(r.ok).toBe(true);
    });
  });
});

describe("financing terms: correcting them afterwards (ADR 0029)", () => {
  it("the owner and the holder may correct the figures; nobody else may", async () => {
    await tx(async (t) => {
      const { m, enc } = await financed(t);

      await t.as("owner_a");
      const fixed = await t.rpc<any>("update_encumbrance_terms", {
        p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id,
        p_terms: { ...TERMS, financing_amount: 1_300_000, contract_ref: "AVT-TERMS-2" },
      });
      expect(Number(fixed.encumbrance.terms.financing_amount)).toBe(1_300_000);
      expect(Number(fixed.encumbrance.terms.total_credit_amount)).toBe(1_050_000);
      expect(fixed.encumbrance.contract_ref).toBe("AVT-TERMS-2");

      await t.as("financier_a");
      expect((await t.rpc<any>("update_encumbrance_terms", {
        p_org_id: ORGS.financier_a, p_encumbrance_id: enc.id, p_terms: { ...TERMS, interest_rate: 7.1 },
      })).ok).toBe(true);

      for (const who of ["financier_b", "dealer", "authority"] as const) {
        await t.as(who);
        expect((await t.rpcError("update_encumbrance_terms", {
          p_org_id: ORGS[who], p_encumbrance_id: enc.id, p_terms: TERMS,
        })).code, who).toBe("FORBIDDEN");
      }

      // The correction is in the chain, still without the figures, and the other party is told.
      await t.as(null);
      const ev = await t.one<{ payload: any }>(
        "select payload from public.events where machine_id = $1 and type = 'encumbrance.terms_updated' order by seq limit 1", [m.id]);
      expect(ev.payload.terms_set).toBe(true);
      expect(JSON.stringify(ev.payload)).not.toMatch(AMOUNT_RX);
      expect(await t.val(
        "select count(*)::int from public.notifications where type = 'encumbrance.terms_updated'")).toBeGreaterThan(0);
    });
  });

  it("the terms must add up: a residual above the credit amount is refused", async () => {
    await tx(async (t) => {
      const { enc } = await financed(t);
      await t.as("owner_a");
      expect((await t.rpcError("update_encumbrance_terms", {
        p_org_id: ORGS.owner_a, p_encumbrance_id: enc.id,
        p_terms: { financing_amount: 100_000, down_payment: 20_000, residual_value: 90_000, amortization_months: 24, interest_rate: 5, contract_ref: "X-1" },
      })).code).toBe("VALIDATION");
    });
  });
});

describe("financing terms: payoff requests stay amount-free (ADR 0025 still holds)", () => {
  it("no column on payoff_requests can hold a figure", async () => {
    await tx(async (t) => {
      expect(await t.val(`select count(*)::int from information_schema.columns
        where table_schema = 'public' and table_name = 'payoff_requests'
          and column_name ~ 'amount|belopp|sum|price|debt|residual|sek|cost|payment'`)).toBe(0);
    });
  });

  it("encumbrances hold exactly the eight agreed term columns and nothing else", async () => {
    // Narrowing rule 5 is only meaningful if the set of stored figures is pinned down.
    await tx(async (t) => {
      const cols = (await t.q<{ column_name: string }>(`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'encumbrances'
          and column_name ~ 'amount|belopp|sum|price|debt|residual|sek|cost|rate|months|overridden|payment'
        order by column_name`)).map((r) => r.column_name);
      expect(cols).toEqual([
        "amortization_months", "down_payment", "financing_amount", "interest_rate",
        "monthly_cost", "residual_value", "terms_overridden", "total_credit_amount",
      ]);
    });
  });
});
