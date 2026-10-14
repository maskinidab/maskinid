import { describe, expect, it } from "vitest";
import { encumber, registerAs } from "./factories.ts";
import { ORGS, USERS, tx, type UserKey } from "./helpers.ts";

/**
 * What the operator needs to run the closed pilot (ADR 0034): every account, every lender, what was e-mailed and what
 * the operators themselves have done. Operator-only, and every lookup of a person is itself audited.
 */
const OPERATOR_ONLY: [string, Record<string, unknown>][] = [
  ["admin_list_users", {}],
  ["admin_get_user", { p_user_id: USERS.owner_a }],
  ["admin_list_financiers", {}],
  ["admin_email_log", {}],
  ["admin_audit_log", {}],
];

describe("admin overview for the pilot (ADR 0034)", () => {
  it("is refused to everyone who is not an operator", async () => {
    await tx(async (t) => {
      for (const who of ["owner_a", "dealer", "financier_a", "authority", "newcomer"] as UserKey[]) {
        await t.as(who);
        for (const [fn, args] of OPERATOR_ONLY) {
          expect((await t.rpcError(fn, args)).code, `${who} ${fn}`).toBe("FORBIDDEN");
        }
      }
      await t.as("anon");
      expect((await t.error(() => t.rpc("admin_list_users"))).code).toMatch(/permission denied|NOT_AUTHENTICATED/);
    });
  });

  it("lists every account with its state, including someone who has only just signed up", async () => {
    await tx(async (t) => {
      await t.as("support");
      const users = await t.rpc<any[]>("admin_list_users", {});
      const newcomer = users.find((u) => u.user_id === USERS.newcomer);
      expect(newcomer).toMatchObject({ email: "newcomer@acme-test.se", identity_verified: true, orgs: [] });
      expect(newcomer).toHaveProperty("email_confirmed_at");
      expect(newcomer).toHaveProperty("last_sign_in_at");
      const ownerA = users.find((u) => u.user_id === USERS.owner_a);
      expect(ownerA.orgs.map((o: any) => o.id)).toContain(ORGS.owner_a);
      // Searching for a person is audited.
      const hits = await t.rpc<any[]>("admin_list_users", { p_query: "newcomer" });
      expect(hits.map((u) => u.user_id)).toEqual([USERS.newcomer]);
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action = 'user.search' and user_id = $1", [USERS.support])).toBe(1);
    });
  });

  it("one account in detail: organisations, security events and the e-mail it was sent", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q("select app.notify_user($1, $2, 'org.approved', '{\"name\":\"X\"}', '/dashboard', 'warning')", [USERS.owner_a, ORGS.owner_a]);
      await t.as("verifier");
      const u = await t.rpc<any>("admin_get_user", { p_user_id: USERS.owner_a });
      expect(u.user.email).toBeTruthy();
      expect(u.orgs.map((o: any) => o.id)).toContain(ORGS.owner_a);
      expect(Array.isArray(u.security_events)).toBe(true);
      expect(u.emails.some((e: any) => e.type === "org.approved")).toBe(true);
      expect((await t.rpcError("admin_get_user", { p_user_id: "00000000-0000-4000-8000-000000000000" })).code).toBe("NOT_FOUND");
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action = 'user.view' and target_id = $1", [USERS.owner_a])).toBe(1);
    });
  });

  it("every lender with its financings, including a bank that has no account yet", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await t.as("support");
      const banks = await t.rpc<any[]>("admin_list_financiers", {});
      const a = banks.find((b) => b.id === ORGS.financier_a);
      expect(a.active_encumbrances).toBeGreaterThanOrEqual(1);
      expect(a).toHaveProperty("pending_encumbrances");
      expect(a).toHaveProperty("open_payoffs");
      expect(a.placeholder).toBe(false);
      expect(banks.every((b) => b.types.includes("financier"))).toBe(true);
    });
  });

  it("the e-mail log shows what was sent, what failed and why, with counts", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q(`insert into public.email_outbox (to_email, template, data, status, last_error, attempts)
        values ('a@x.se', 'notification', '{"type":"org.approved"}', 'failed', 'Domain not verified', 6),
               ('b@x.se', 'invite', '{}', 'sent', null, 1)`);
      await t.as("support");
      const log = await t.rpc<any>("admin_email_log", {});
      expect(log.counts.failed).toBeGreaterThanOrEqual(1);
      const failed = await t.rpc<any>("admin_email_log", { p_status: "failed", p_query: "a@x.se" });
      expect(failed.items).toHaveLength(1);
      expect(failed.items[0]).toMatchObject({ to_email: "a@x.se", type: "org.approved", last_error: "Domain not verified", attempts: 6 });
    });
  });

  it("the audit log records what operators did, newest first", async () => {
    await tx(async (t) => {
      await t.as("verifier");
      await t.rpc("admin_get_user", { p_user_id: USERS.owner_b });
      await t.as("support");
      const log = await t.rpc<any[]>("admin_audit_log", {});
      expect(log[0]).toMatchObject({ action: "user.view", target_id: USERS.owner_b });
      expect(log[0].operator_email).toBeTruthy();
    });
  });

  it("the overview counts what needs attention in the pilot", async () => {
    await tx(async (t) => {
      await t.as("support");
      const o = await t.rpc<any>("admin_overview");
      for (const k of ["orgs_pending", "users_total", "users_unconfirmed", "emails_pending", "emails_failed_24h", "pilot"]) {
        expect(o, k).toHaveProperty(k);
      }
      expect(o.pilot).toMatchObject({ mock_identity: false, require_org_approval: false });
    });
  });
});
