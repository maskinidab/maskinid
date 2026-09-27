import { describe, expect, it } from "vitest";
import { createAdapters } from "./index.ts";
import { createStripePayments, mockPayments, stripeForm, stripeSignature, verifyStripeSignature } from "./payments.ts";

describe("payments adapter", () => {
  it("DEMO_MODE uses the mock; Stripe only with a key outside demo", () => {
    expect(createAdapters({ DEMO_MODE: "true", STRIPE_SECRET_KEY: "sk_test_x" }).payments.name).toBe("mock");
    expect(createAdapters({ DEMO_MODE: "false" }).payments.name).toBe("mock");
    expect(createAdapters({ DEMO_MODE: "false", STRIPE_SECRET_KEY: "sk_test_x" }).payments.name).toBe("stripe");
  });

  it("refuses live keys unless explicitly allowed", () => {
    expect(() => createStripePayments({ secretKey: "sk_live_x", webhookSecret: "w", prices: {} })).toThrow(/test mode/);
    expect(createStripePayments({ secretKey: "sk_live_x", webhookSecret: "w", prices: {}, allowLive: true }).name).toBe("stripe");
  });

  it("encodes nested form bodies like Stripe expects", () => {
    expect(stripeForm({ a: 1, line_items: [{ price: "p", tax_rates: ["t"] }], metadata: { org_id: "o" }, skip: undefined }))
      .toBe("a=1&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Btax_rates%5D%5B0%5D=t&metadata%5Borg_id%5D=o");
  });

  it("verifies webhook signatures with tolerance", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
    const now = 1_790_000_000_000;
    const t = Math.floor(now / 1000);
    const sig = await stripeSignature("whsec_test", t, body);
    await expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_test", now)).resolves.toBeUndefined();
    await expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_other", now)).rejects.toThrow(/invalid/);
    await expect(verifyStripeSignature(body, `t=${t - 600},v1=${sig}`, "whsec_test", now)).rejects.toThrow(/old/);
    await expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, "whsec_test", now)).rejects.toThrow(/invalid/);
    const p = createStripePayments({ secretKey: "sk_test_x", webhookSecret: "whsec_test", prices: {}, now: () => now });
    expect(await p.verifyWebhook(body, `t=${t},v1=${sig}`)).toMatchObject({ id: "evt_1", type: "invoice.paid" });
  });

  it("creates a subscription checkout with metadata and VAT tax rate", async () => {
    const calls: { url: string; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createStripePayments({ secretKey: "sk_test_x", webhookSecret: "w", prices: { dealer: "price_d" }, taxRateId: "txr_25", fetch: fake });
    const r = await p.createCheckout({ orgId: "org-1", planKey: "dealer", email: "a@b.se", customerId: null, successUrl: "https://x/ok", cancelUrl: "https://x/no" });
    expect(r.url).toContain("checkout.stripe.com");
    expect(decodeURIComponent(calls[0].body)).toContain("metadata[plan]=dealer");
    expect(decodeURIComponent(calls[0].body)).toContain("line_items[0][tax_rates][0]=txr_25");
    await expect(p.createCheckout({ orgId: "o", planKey: "insurer", email: null, customerId: null, successUrl: "", cancelUrl: "" })).rejects.toThrow(/no Stripe price/);
  });

  it("mock checkout returns to the success page", async () => {
    const r = await mockPayments.createCheckout({ orgId: "12345678-aaaa", planKey: "dealer", email: null, customerId: null, successUrl: "/o/x/settings?tab=billing", cancelUrl: "/" });
    expect(r.url).toMatch(/^\/o\/x\/settings\?tab=billing&checkout=cs_mock_/);
  });
});
