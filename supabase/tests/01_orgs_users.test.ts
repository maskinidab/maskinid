import { describe, expect, it } from "vitest";
import { ORGS, USERS, tx } from "./helpers.ts";

const DPA = "2026-09";

describe("organisations (step 2)", () => {
  it("anon cannot read organisations, profiles, memberships or notifications", async () => {
    await tx(async (t) => {
      await t.as("anon");
      for (const table of ["organizations", "profiles", "memberships", "operator_roles", "notifications", "api_keys", "webhooks"]) {
        const e = await t.error(() => t.q(`select * from public.${table} limit 1`));
        expect(e.code, table).toMatch(/permission denied/);
      }
      const e = await t.rpcError("create_org", { p_org_number: "556677-8899", p_types: "{owner}", p_accept_dpa_version: DPA });
      expect(e.code).toMatch(/permission denied|NOT_AUTHENTICATED/);
    });
  });

  it("an unverified user cannot create an organisation", async () => {
    await tx(async (t) => {
      await t.as("unverified");
      const e = await t.rpcError("create_org", { p_org_number: "556677-8899", p_types: "{owner}", p_accept_dpa_version: DPA });
      expect(e.code).toBe("IDENTITY_NOT_VERIFIED");
    });
  });

  it("owner org is approved at once after mock lookup; creator becomes admin; event written", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const org = await t.rpc("create_org", { p_org_number: "5566778899", p_types: "{owner}", p_accept_dpa_version: DPA });
      expect(org.status).toBe("approved");
      expect(org.org_number).toBe("556677-8899");
      expect(org.name).toMatch(/Demoföretag 556677 AB/);
      const ctx = await t.rpc("my_context");
      expect(ctx.memberships).toHaveLength(1);
      expect(ctx.memberships[0].role).toBe("admin");
      await t.as(null);
      const ev = await t.one<{ type: string; org_id: string }>("select type, org_id from public.events order by seq desc limit 1");
      expect(ev).toEqual({ type: "org.created", org_id: org.id });
    });
  });

  it("dealer org is pending with owner rights; operator is notified and can approve", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const org = await t.rpc("create_org", { p_org_number: "556677-1111", p_types: "{dealer}", p_accept_dpa_version: DPA });
      expect(org.status).toBe("pending");
      expect(await t.val("select app.has_org_type($1, 'owner')", [org.id])).toBe(true);
      expect(await t.val("select app.has_org_type($1, 'dealer')", [org.id])).toBe(false);
      await t.as("operator");
      const n = await t.rpc<any[]>("list_notifications");
      expect(n.some((x) => x.type === "org.pending_approval" && x.data.org_id === org.id)).toBe(true);
      await t.as("owner_a");
      expect((await t.rpcError("approve_org", { p_org_id: org.id })).code).toBe("FORBIDDEN");
      await t.as("operator");
      await t.rpc("approve_org", { p_org_id: org.id });
      expect(await t.val("select app.has_org_type($1, 'dealer')", [org.id])).toBe(true);
    });
  });

  it("duplicate org number is rejected with ORG_EXISTS", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const e = await t.rpcError("create_org", { p_org_number: "559900-0001", p_types: "{owner}", p_accept_dpa_version: DPA });
      expect(e.code).toBe("ORG_EXISTS");
    });
  });

  it("sole trader: personal number encrypted, never stored in clear, masked for others", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const org = await t.rpc("create_org", { p_org_number: "820304-5678", p_types: "{owner}", p_accept_dpa_version: DPA });
      expect(org.is_sole_trader).toBe(true);
      expect(org.org_number).toBe("19XXXXXX-XXXX");
      await t.as(null);
      const raw = await t.one<{ org_number: string | null; org_number_enc: Buffer; row: string }>(
        "select org_number, org_number_enc, row_to_json(o)::text as row from public.organizations o where id = $1",
        [org.id],
      );
      expect(raw.org_number).toBeNull();
      expect(raw.row).not.toContain("820304");
      await t.claims("authority");
      expect(await t.val("select app.org_number_display($1)", [org.id])).toBe("820304-5678");
      await t.claims("operator");
      expect(await t.val("select app.org_number_display($1)", [org.id])).toBe("820304-5678");
      await t.claims("owner_b");
      expect(await t.val("select app.org_number_display($1)", [org.id])).toBe("19XXXXXX-XXXX");
    });
  });

  it("owner A cannot read owner B's org details, members or settings", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const rows = await t.q("select id from public.organizations where id = $1", [ORGS.owner_b]);
      expect(rows).toHaveLength(0);
      expect((await t.rpcError("get_org", { p_org_id: ORGS.owner_b })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("list_org_members", { p_org_id: ORGS.owner_b })).code).toBe("FORBIDDEN");
      const e = await t.error(() => t.q("select org_number_enc from public.organizations limit 1"));
      expect(e.code).toMatch(/permission denied/);
      // Approved financiers are searchable (name, city).
      const fin = await t.q("select id from public.organizations where id = $1", [ORGS.financier_a]);
      expect(fin).toHaveLength(1);
      const found = await t.rpc<any[]>("search_orgs", { p_query: "Test Finans", p_type: "financier" });
      expect(found.map((o) => o.id)).toContain(ORGS.financier_a);
    });
  });

  it("authority and operator can read all organisations", async () => {
    await tx(async (t) => {
      for (const who of ["authority", "support"] as const) {
        await t.as(who);
        const rows = await t.q("select id from public.organizations where id = $1", [ORGS.owner_b]);
        expect(rows, who).toHaveLength(1);
      }
    });
  });

  it("clients cannot write tables directly", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      for (const sql of [
        "update public.organizations set name = 'x'",
        "insert into public.memberships (org_id, user_id) values ('" + ORGS.owner_b + "', '" + USERS.owner_a + "')",
        "delete from public.notifications",
        "update public.profiles set identity_verified_at = now()",
        "insert into public.operator_roles (user_id, role) values ('" + USERS.owner_a + "', 'superadmin')",
      ]) {
        const e = await t.error(() => t.q(sql));
        expect(e.code, sql).toMatch(/permission denied/);
      }
    });
  });
});

describe("members and invitations (step 2)", () => {
  it("admin invites, invitee accepts with matching e-mail; e-mail is queued", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const inv = await t.rpc("invite_member", { p_org_id: ORGS.owner_a, p_email: "Newcomer@acme-test.se", p_role: "member" });
      expect(inv.token).toMatch(/^[0-9a-f]{48}$/);
      await t.as(null);
      const mail = await t.one<{ template: string; to_email: string }>(
        "select template, to_email from public.email_outbox order by created_at desc limit 1",
      );
      expect(mail).toEqual({ template: "invite", to_email: "newcomer@acme-test.se" });
      expect(await t.val("select count(*)::int from public.memberships where invite_token_hash = $1", [inv.token])).toBe(0);
      await t.as("owner_b");
      expect((await t.rpcError("accept_invite", { p_token: inv.token })).code).toBe("INVITE_EMAIL_MISMATCH");
      await t.as("newcomer");
      const ctx0 = await t.rpc("my_context");
      expect(ctx0.pending_invites).toHaveLength(1);
      await t.rpc("accept_invite", { p_token: inv.token });
      const ctx = await t.rpc("my_context");
      expect(ctx.memberships.map((m: any) => m.org.id)).toContain(ORGS.owner_a);
    });
  });

  it("members and readonly members cannot invite; readonly cannot write", async () => {
    await tx(async (t) => {
      await t.as("owner_a_readonly");
      const e = await t.rpcError("invite_member", { p_org_id: ORGS.owner_a, p_email: "x@y.se" });
      expect(e.code).toBe("FORBIDDEN");
      await t.as("dealer");
      const e2 = await t.rpcError("invite_member", { p_org_id: ORGS.owner_a, p_email: "x@y.se" });
      expect(e2.code).toBe("FORBIDDEN");
    });
  });

  it("the last admin cannot be removed or demoted", async () => {
    await tx(async (t) => {
      await t.as("owner_b");
      const members = await t.rpc<any[]>("list_org_members", { p_org_id: ORGS.owner_b });
      const me = members.find((m) => m.user_id === USERS.owner_b);
      expect((await t.rpcError("set_member_role", { p_membership_id: me.membership_id, p_role: "member" })).code).toBe("LAST_ADMIN");
      expect((await t.rpcError("remove_member", { p_membership_id: me.membership_id })).code).toBe("LAST_ADMIN");
    });
  });

  it("colleagues see each other's names; others do not", async () => {
    await tx(async (t) => {
      await t.as("owner_a_readonly");
      const p = await t.q("select user_id from public.profiles where user_id = $1", [USERS.owner_a]);
      expect(p).toHaveLength(1);
      const e = await t.error(() => t.q("select personal_number_hash from public.profiles"));
      expect(e.code).toMatch(/permission denied/);
      await t.as("owner_b");
      const p2 = await t.q("select user_id from public.profiles where user_id = $1", [USERS.owner_a]);
      expect(p2).toHaveLength(0);
    });
  });

  it("suggests orgs by e-mail domain (not for public mail domains)", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const org = await t.rpc("create_org", { p_org_number: "556677-2222", p_types: "{owner}", p_accept_dpa_version: DPA });
      await t.as(null);
      await t.q("insert into auth.users (id, email) values ('f1000000-0000-4000-8000-0000000000aa', 'colleague@acme-test.se')");
      await t.as(null);
      await t.q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: "f1000000-0000-4000-8000-0000000000aa", role: "authenticated" }),
      ]);
      await t.q("set local role authenticated");
      const s = await t.rpc<any[]>("suggested_orgs");
      expect(s.map((o) => o.id)).toContain(org.id);
    });
  });
});

describe("identity (step 2)", () => {
  it("mock BankID works in DEMO_MODE only and stores only a hash", async () => {
    await tx(async (t) => {
      await t.as("unverified");
      const r = await t.rpc("verify_identity", { p_provider: "mock" });
      expect(r.ok).toBe(true);
      const ctx = await t.rpc("my_context");
      expect(ctx.identity_provider).toBe("mock");
      await t.as(null);
      const h = await t.val<string>("select personal_number_hash from public.profiles where user_id = $1", [USERS.unverified]);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      await t.q("update public.app_config set value = 'false' where key = 'DEMO_MODE'");
      await t.as("newcomer");
      expect((await t.rpcError("verify_identity", { p_provider: "mock" })).code).toBe("MOCK_PROVIDER_DISABLED");
    });
  });

  it("record_identity_verification is service-role only", async () => {
    await tx(async (t) => {
      await t.as("unverified");
      const e = await t.error(() =>
        t.rpc("record_identity_verification", { p_user_id: USERS.unverified, p_personal_number: "197805121236", p_provider: "bankid" }),
      );
      expect(e.code).toMatch(/permission denied/);
      await t.as("service");
      const r = await t.rpc("record_identity_verification", { p_user_id: USERS.unverified, p_personal_number: "197805121236", p_provider: "bankid" });
      expect(r.ok).toBe(true);
      await t.as(null);
      const row = await t.val<string>("select row_to_json(p)::text from public.profiles p where user_id = $1", [USERS.unverified]);
      expect(row).not.toContain("197805121236");
    });
  });

  it("MFA is required for financiers outside DEMO_MODE", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q("update public.app_config set value = 'false' where key = 'DEMO_MODE'");
      await t.claims("financier_a", { aal: "aal1" });
      const e = await t.error(() => t.q("select app.require_actor($1)", [ORGS.financier_a]));
      expect(e.code).toBe("MFA_REQUIRED");
    });
  });
});

describe("notifications (step 2)", () => {
  it("users only see and mark their own notifications", async () => {
    await tx(async (t) => {
      await t.q("select app.notify_user($1, $2, 'test.hello', '{}', '/x', 'info')", [USERS.owner_a, ORGS.owner_a]);
      await t.as("owner_b");
      expect(await t.rpc<any[]>("list_notifications")).toHaveLength(0);
      expect(await t.rpc("mark_notifications_read")).toBe(0);
      await t.as("owner_a");
      expect(await t.rpc<any[]>("list_notifications")).toHaveLength(1);
      expect(await t.rpc("mark_notifications_read")).toBe(1);
    });
  });

  it("critical notifications are e-mailed by default, info is not", async () => {
    await tx(async (t) => {
      await t.q("select app.notify_user($1, $2, 'test.info', '{}', '/x', 'info')", [USERS.owner_a, ORGS.owner_a]);
      await t.q("select app.notify_user($1, $2, 'test.crit', '{}', '/x', 'critical')", [USERS.owner_a, ORGS.owner_a]);
      const rows = await t.q<{ t: string }>("select data->>'type' t from public.email_outbox where user_id = $1", [USERS.owner_a]);
      expect(rows.map((r) => r.t)).toEqual(["test.crit"]);
    });
  });
});
