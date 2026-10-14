import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, encParams, registerAs, sign, machineData } from "./factories.ts";
import { ORGS, USERS, tx, type Tx } from "./helpers.ts";

/**
 * The closed pilot (ADR 0034): production runs without demo mode, so e-mail is real, but with mock BankID until a
 * broker agreement exists. Because identity is then unverified, every new organisation waits for an operator.
 */
async function pilot(t: Tx) {
  await t.as(null);
  await t.q("update public.app_config set value = 'false' where key = 'DEMO_MODE'");
  await t.q("update public.app_config set value = 'true' where key in ('MOCK_IDENTITY', 'REQUIRE_ORG_APPROVAL')");
}

/** A fresh, verified user creating an organisation through the real RPC. Returns the org id. */
async function apply(t: Tx, orgNumber: string, types: string[], name = "Pilotbolaget AB") {
  await t.as("newcomer");
  const org = await t.rpc<any>("create_org", { p_org_number: orgNumber, p_types: types, p_name: name, p_accept_dpa_version: "2026-09" });
  return org.id as string;
}

const outbox = (t: Tx, to: string, type: string) =>
  t.val<number>(`select count(*)::int from public.email_outbox where to_email = $1 and template = 'notification' and data ->> 'type' = $2`, [to, type]);

describe("pilot mode: mock BankID without demo mode (ADR 0034)", () => {
  it("both flags exist and are off by default", async () => {
    await tx(async (t) => {
      await t.as(null);
      const cfg = Object.fromEntries((await t.q<{ key: string; value: unknown }>(
        "select key, value from public.app_config where key in ('MOCK_IDENTITY', 'REQUIRE_ORG_APPROVAL')")).map((r) => [r.key, r.value]));
      expect(cfg).toEqual({ MOCK_IDENTITY: false, REQUIRE_ORG_APPROVAL: false });
    });
  });

  it("identity and signatures work with MOCK_IDENTITY, and are refused without it", async () => {
    await tx(async (t) => {
      await pilot(t);
      await t.as("unverified");
      expect((await t.rpc<any>("verify_identity", { p_provider: "mock" })).ok).toBe(true);
      const ctx = await t.rpc<any>("my_context");
      expect(ctx.demo_mode).toBe(false);
      expect(ctx.mock_identity).toBe(true);

      // A whole signed action: the lender registers a financing with Demo-BankID.
      const m = await registerAs(t, "owner_a");
      await t.as("financier_a");
      const params = encParams("leasing", "PILOT-1", TODAY, NEXT_YEAR);
      const sig = await sign(t, ORGS.financier_a, "register_encumbrance", m.id, params);
      const r = await t.rpc<any>("register_encumbrance", {
        p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "PILOT-1",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_signature_id: sig,
      });
      expect(r.ok).toBe(true);

      await t.as(null);
      await t.q("update public.app_config set value = 'false' where key = 'MOCK_IDENTITY'");
      await t.as("newcomer");
      expect((await t.rpcError("verify_identity", { p_provider: "mock" })).code).toBe("MOCK_PROVIDER_DISABLED");
      await t.as("financier_a");
      const s = await t.rpc<any>("start_signature", { p_org_id: ORGS.financier_a, p_action: "register_encumbrance", p_subject_id: m.id, p_params: params });
      expect(s.provider).toBe("bankid");
    });
  });
});

describe("pilot mode: every organisation waits for an operator (ADR 0034)", () => {
  it("a company without a lookup provider can be entered by hand, and is never auto-approved", async () => {
    await tx(async (t) => {
      await pilot(t);
      await t.as("newcomer");
      const lk = await t.rpc<any>("lookup_company", { p_org_number: "559900-0097" });
      expect(lk.manual).toBe(true);
      expect(lk.existing_org).toBeNull();
      // Owner-only used to be approved straight away; in the pilot nothing is.
      const id = await apply(t, "559900-0097", ["owner"]);
      await t.as(null);
      const o = await t.one<any>("select status::text, lookup_source, name from public.organizations where id = $1", [id]);
      expect(o).toEqual({ status: "pending", lookup_source: "manual", name: "Pilotbolaget AB" });
    });
  });

  it("a pending organisation can see its own status and nothing else, and cannot act", async () => {
    await tx(async (t) => {
      await pilot(t);
      const id = await apply(t, "559900-0022", ["dealer", "owner"]);
      await t.as("newcomer");
      const ctx = await t.rpc<any>("my_context");
      const mine = ctx.memberships.find((x: any) => x.org.id === id);
      expect(mine.org.status).toBe("pending");
      expect(ctx.require_org_approval).toBe(true);
      expect(await t.val("select app.current_org_ids()")).toEqual([]);
      const e = await t.rpcError("register_machine", { p_org_id: id, p_data: machineData() });
      expect(e.code).toBe("ORG_NOT_APPROVED");
      expect(e.detail).toMatchObject({ status: "pending" });
      expect((await t.rpcError("list_machines", { p_org_id: id })).code).toBe("ORG_NOT_APPROVED");
    });
  });

  it("the operator is e-mailed about the application, and the applicant is told it was received", async () => {
    await tx(async (t) => {
      await pilot(t);
      await apply(t, "559900-0030", ["financier"]);
      await t.as(null);
      const op = await t.val<string>("select email from public.profiles where user_id = $1", [USERS.verifier]);
      const me = await t.val<string>("select email from public.profiles where user_id = $1", [USERS.newcomer]);
      expect(await outbox(t, op, "org.pending_approval")).toBe(1);
      expect(await outbox(t, me, "org.received")).toBe(1);
    });
  });

  it("approval opens the account and tells the applicant", async () => {
    await tx(async (t) => {
      await pilot(t);
      const id = await apply(t, "559900-0048", ["owner"]);
      await t.as("newcomer");
      expect((await t.rpcError("approve_org", { p_org_id: id })).code).toBe("FORBIDDEN");
      await t.as("verifier");
      await t.rpc("approve_org", { p_org_id: id });
      await t.as("newcomer");
      expect((await t.rpc<any>("register_machine", { p_org_id: id, p_data: machineData() })).id).toBeTruthy();
      await t.as(null);
      const me = await t.val<string>("select email from public.profiles where user_id = $1", [USERS.newcomer]);
      expect(await outbox(t, me, "org.approved")).toBe(1);
    });
  });

  it("rejection keeps the account closed, records the reason and tells the applicant", async () => {
    await tx(async (t) => {
      await pilot(t);
      const id = await apply(t, "559900-0055", ["insurer"]);
      await t.as("newcomer");
      expect((await t.rpcError("reject_org", { p_org_id: id, p_reason: "x" })).code).toBe("FORBIDDEN");
      await t.as("verifier");
      expect((await t.rpcError("reject_org", { p_org_id: id, p_reason: " " })).code).toBe("VALIDATION");
      await t.rpc("reject_org", { p_org_id: id, p_reason: "Organisationsnumret hör till ett annat bolag" });
      // Only an application can be rejected; an approved organisation is suspended instead.
      expect((await t.rpcError("reject_org", { p_org_id: ORGS.owner_a, p_reason: "x" })).code).toBe("NOT_FOUND");
      await t.as(null);
      const o = await t.one<any>("select status::text, suspended_reason, rejected_at is not null as rejected from public.organizations where id = $1", [id]);
      expect(o).toEqual({ status: "suspended", suspended_reason: "Organisationsnumret hör till ett annat bolag", rejected: true });
      const me = await t.val<string>("select email from public.profiles where user_id = $1", [USERS.newcomer]);
      expect(await outbox(t, me, "org.rejected")).toBe(1);
      await t.as("newcomer");
      expect((await t.rpcError("register_machine", { p_org_id: id, p_data: machineData() })).code).toBe("ORG_NOT_APPROVED");
      const ctx = await t.rpc<any>("my_context");
      expect(ctx.memberships.find((x: any) => x.org.id === id).org.rejection_reason).toBe("Organisationsnumret hör till ett annat bolag");
    });
  });

  it("taking over a bank placeholder goes to the operator instead of being refused", async () => {
    await tx(async (t) => {
      await pilot(t);
      // A dealer reports a financing against a bank that has no account: a load-bearing placeholder.
      const m = await registerAs(t, "dealer");
      await t.as("dealer");
      await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "PH-1",
        p_holder_org_number: "559900-0063", p_holder_name: "Platshållarbanken AB",
      });
      const id = await apply(t, "559900-0063", ["financier"], "Platshållarbanken AB");
      await t.as(null);
      expect(await t.val("select status::text from public.organizations where id = $1", [id])).toBe("pending");
      // ...and until approved, the claimant sees none of the financings registered against the bank.
      await t.as("newcomer");
      expect((await t.rpcError("list_portfolio", { p_org_id: id })).code).toBe("ORG_NOT_APPROVED");
    });
  });

  it("without the flag, approval works as before", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const id = await apply(t, "559900-0071", ["owner"]);
      await t.as(null);
      // Demo mode: the mock register makes everyone a signatory, so an owner-only org is approved at once.
      expect(await t.val("select status::text from public.organizations where id = $1", [id])).toBe("approved");
    });
  });
});

describe("bootstrapping the first operator (ADR 0034)", () => {
  it("is for the deploy pipeline only, idempotent, and makes the user a superadmin", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      expect((await t.error(() => t.q("select app.bootstrap_operator('newcomer@acme-test.se')"))).code).toMatch(/permission denied/);
      await t.as(null);
      const r1 = await t.val<any>("select app.bootstrap_operator('NEWCOMER@acme-test.se')");
      const r2 = await t.val<any>("select app.bootstrap_operator('newcomer@acme-test.se')");
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(await t.val("select role::text from public.operator_roles where user_id = $1", [USERS.newcomer])).toBe("superadmin");
      expect(await t.val(`select count(*)::int from public.memberships m join public.organizations o on o.id = m.org_id
        where m.user_id = $1 and 'operator' = any (o.types) and m.status = 'active'`, [USERS.newcomer])).toBe(1);
      // An address with no account is a no-op, not an error: the deploy runs before the person has signed up.
      expect((await t.val<any>("select app.bootstrap_operator('nobody@example.invalid')")).ok).toBe(false);
    });
  });
});
