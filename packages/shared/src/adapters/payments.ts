/**
 * Payments adapter (step 23, ADR 0020): Stripe in test mode, or a mock for DEMO_MODE and local development.
 * Dependency-free (fetch + Web Crypto) so it runs in Deno Edge Functions and in Node tests.
 * Amounts are integers in öre, excluding VAT; VAT is added as a Stripe tax rate so it is shown separately.
 */
type FetchLike = typeof fetch;

export interface CheckoutInput {
  orgId: string;
  planKey: string;
  email: string | null;
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface InvoiceLineInput { description: string; amountOre: number }

export interface ProviderInvoiceInput {
  customerId: string;
  invoiceId: string;
  number: string;
  lines: InvoiceLineInput[];
  daysUntilDue: number;
}

export interface PaymentEvent { id: string; type: string; payload: Record<string, unknown> }

export interface Payments {
  readonly name: "stripe" | "mock";
  /** Hosted checkout for a subscription; the plan is activated by the webhook (or at once by the mock). */
  createCheckout(input: CheckoutInput): Promise<{ url: string; sessionId: string }>;
  /** Hosted page where the customer manages card and cancels. */
  createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Pushes one of our invoices (usage + fee) to the provider for collection. */
  createInvoice(input: ProviderInvoiceInput): Promise<{ providerInvoiceId: string; url: string | null }>;
  /** Verifies a webhook request and returns the event. Throws when the signature is invalid. */
  verifyWebhook(body: string, signatureHeader: string | null): Promise<PaymentEvent>;
}

// ---------- Mock ----------
export const mockPayments: Payments = {
  name: "mock",
  async createCheckout(input) {
    const sessionId = `cs_mock_${input.orgId.slice(0, 8)}_${input.planKey}`;
    const sep = input.successUrl.includes("?") ? "&" : "?";
    return { url: `${input.successUrl}${sep}checkout=${encodeURIComponent(sessionId)}`, sessionId };
  },
  async createPortal(_customerId, returnUrl) {
    return { url: returnUrl };
  },
  async createInvoice(input) {
    return { providerInvoiceId: `in_mock_${input.invoiceId}`, url: null };
  },
  async verifyWebhook(body) {
    const e = JSON.parse(body) as { id: string; type: string };
    return { id: e.id, type: e.type, payload: e as unknown as Record<string, unknown> };
  },
};

// ---------- Stripe ----------
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Price ids per plan key, e.g. { dealer: "price_123" } (from STRIPE_PRICE_DEALER …). */
  prices: Record<string, string>;
  /** Tax rate id for 25 % Swedish VAT (moms), exclusive. */
  taxRateId?: string;
  /** Live keys are refused unless explicitly allowed – step 23 is test mode. */
  allowLive?: boolean;
  fetch?: FetchLike;
  now?: () => number;
}

/** Stripe's form encoding: nested keys as a[b][0]=… */
export function stripeForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") parts.push(stripeForm(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      parts.push(stripeForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function stripeSignature(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

/** Verifies a Stripe-Signature header (t=…,v1=…) with a 5-minute tolerance. */
export async function verifyStripeSignature(body: string, header: string | null, secret: string, nowMs = Date.now()): Promise<void> {
  if (!header) throw new Error("missing signature");
  const fields = header.split(",").map((x) => x.split("=") as [string, string]);
  const t = Number(fields.find(([k]) => k === "t")?.[1]);
  const sigs = fields.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) throw new Error("malformed signature");
  if (Math.abs(nowMs / 1000 - t) > 300) throw new Error("signature too old");
  const expected = await stripeSignature(secret, t, body);
  if (!sigs.some((s) => timingSafeEqual(s, expected))) throw new Error("invalid signature");
}

export function createStripePayments(cfg: StripeConfig): Payments {
  if (!cfg.allowLive && !cfg.secretKey.startsWith("sk_test_")) throw new Error("Stripe live keys are not allowed (test mode only)");
  const f = cfg.fetch ?? fetch;
  async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await f(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body ? stripeForm(body) : undefined,
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`stripe ${res.status}: ${json.error?.message ?? "error"}`);
    return json;
  }
  const taxRates = cfg.taxRateId ? [cfg.taxRateId] : undefined;
  return {
    name: "stripe",
    async createCheckout(input) {
      const price = cfg.prices[input.planKey];
      if (!price) throw new Error(`no Stripe price for plan ${input.planKey}`);
      const s = await call<{ id: string; url: string }>("POST", "/checkout/sessions", {
        mode: "subscription",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer: input.customerId ?? undefined,
        customer_email: input.customerId ? undefined : input.email ?? undefined,
        line_items: [{ price, quantity: 1, tax_rates: taxRates }],
        metadata: { org_id: input.orgId, plan: input.planKey },
        subscription_data: { metadata: { org_id: input.orgId, plan: input.planKey } },
        locale: "sv",
      });
      return { url: s.url, sessionId: s.id };
    },
    async createPortal(customerId, returnUrl) {
      const s = await call<{ url: string }>("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
      return { url: s.url };
    },
    async createInvoice(input) {
      for (const l of input.lines) {
        await call("POST", "/invoiceitems", {
          customer: input.customerId, currency: "sek", amount: l.amountOre, description: l.description, tax_rates: taxRates,
          metadata: { invoice_id: input.invoiceId },
        });
      }
      const inv = await call<{ id: string }>("POST", "/invoices", {
        customer: input.customerId, collection_method: "send_invoice", days_until_due: input.daysUntilDue,
        pending_invoice_items_behavior: "include", metadata: { invoice_id: input.invoiceId, number: input.number },
      });
      const fin = await call<{ id: string; hosted_invoice_url: string | null }>("POST", `/invoices/${inv.id}/finalize`, {});
      return { providerInvoiceId: fin.id, url: fin.hosted_invoice_url };
    },
    async verifyWebhook(body, header) {
      await verifyStripeSignature(body, header, cfg.webhookSecret, cfg.now?.());
      const e = JSON.parse(body) as { id: string; type: string };
      return { id: e.id, type: e.type, payload: e as unknown as Record<string, unknown> };
    },
  };
}
