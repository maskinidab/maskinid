import { describe, expect, it } from "vitest";
import { machineData, registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("jobs (step 26)", () => {
  it("operators list jobs; only superadmins run them; runs are recorded", async () => {
    await tx(async (t) => {
      await t.as("support");
      const l = await t.rpc<any>("admin_list_jobs", {});
      expect(l.jobs.map((j: any) => j.name)).toEqual(expect.arrayContaining(["expire-transfers", "verify-chain", "email-send", "cleanup"]));
      expect(l.scheduler).toMatchObject({ pg_cron: expect.any(Boolean), pg_net: expect.any(Boolean) });
      expect((await t.rpcError("admin_run_job", { p_name: "cleanup" })).code).toBe("FORBIDDEN");
      await t.as("operator");
      const r = await t.rpc<any>("admin_run_job", { p_name: "verify-chain" });
      expect(r).toMatchObject({ job: "verify-chain", status: "ok", result: { ok: true } });
      expect((await t.rpc<any>("admin_run_job", { p_name: "cleanup" })).status).toBe("ok");
      if (!l.scheduler.pg_net) expect((await t.rpcError("admin_run_job", { p_name: "email-send" })).code).toBe("FEATURE_DISABLED");
      const again = await t.rpc<any>("admin_list_jobs", {});
      expect(again.jobs.find((j: any) => j.name === "verify-chain").runs[0]).toMatchObject({ status: "ok" });
      await t.as("owner_a");
      expect((await t.rpcError("admin_list_jobs", {})).code).toBe("FORBIDDEN");
      expect(await t.q("select * from public.jobs")).toEqual([]);
    });
  });

  it("three failures in a row notify the superadmins; a success resets the counter", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q("create function app.test_failing_job() returns int language plpgsql as $$ begin raise exception 'boom'; end $$");
      await t.q("insert into public.jobs (name, description, schedule, kind, target) values ('test-fail', 'test', '* * * * *', 'sql', 'test_failing_job')");
      for (let i = 0; i < 3; i++) await t.q("select app.run_job('test-fail')");
      expect(await t.val("select consecutive_failures from public.jobs where name = 'test-fail'")).toBe(3);
      expect(await t.val("select last_error from public.jobs where name = 'test-fail'")).toBe("boom");
      expect(await t.val("select count(*)::int from public.notifications where type = 'job.failing'")).toBeGreaterThan(0);
      await t.q("create or replace function app.test_failing_job() returns int language sql as $$ select 1 $$");
      await t.q("select app.run_job('test-fail')");
      expect(await t.val("select consecutive_failures from public.jobs where name = 'test-fail'")).toBe(0);
    });
  });

  it("the health check is for the service role only and reports failing jobs", async () => {
    await tx(async (t) => {
      await t.as("service");
      expect(await t.rpc<any>("health_check", {})).toMatchObject({ ok: true, db: true, failing_jobs: [] });
      await t.as("anon");
      expect((await t.rpcError("health_check", {})).code).toMatch(/permission|FORBIDDEN/i);
      expect((await t.rpc<any>("public_system_status", {})).jobs).toMatchObject({ failing: 0 });
    });
  });
});

describe("scheduled rules (step 26)", () => {
  it("temporary registrations: reminder 30 days before, then deregistered as exported with labels revoked", async () => {
    await tx(async (t) => {
      const soon = await registerAs(t, "owner_a", machineData({ registration_type: "temporary", valid_until: inDays(10), origin_country: "NO" }));
      const past = await registerAs(t, "owner_a", machineData({ registration_type: "temporary", valid_until: inDays(20), origin_country: "DE" }));
      await t.as(null);
      await t.q("update public.machines set valid_until = current_date - 1 where id = $1", [past.id]);
      const r = JSON.parse(await t.val<string>("select app.run_job('temporary-regs')::text")).result;
      expect(r.reminded).toBeGreaterThanOrEqual(1);
      expect(r.expired).toBeGreaterThanOrEqual(1);
      expect(await t.val("select status from public.machines where id = $1", [past.id])).toBe("exported");
      expect(await t.val("select status from public.machines where id = $1", [soon.id])).toBe("active");
      expect(await t.val("select payload ->> 'cause' from public.events where machine_id = $1 and type = 'machine.deregistered'", [past.id])).toBe("temporary_expired");
      expect(await t.val("select count(*)::int from public.notifications where type = 'machine.temporary_expiring' and data ->> 'machine_id' = $1", [soon.id])).toBeGreaterThan(0);
      // the reminder is not repeated the next day
      const again = JSON.parse(await t.val<string>("select app.run_job('temporary-regs')::text")).result;
      expect(again.reminded).toBe(0);
    });
  });

  it("daily digest: collects the user's notifications into one e-mail and moves the watermark", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("set_notification_preferences", { p_org_id: ORGS.owner_a, p_channel: "email", p_event_types: ["*"], p_digest: "daily", p_enabled: true });
      await t.as(null);
      const user = await t.val<string>("select user_id from public.notification_preferences where org_id = $1 and channel = 'email' and digest = 'daily' limit 1", [ORGS.owner_a]);
      const before = await t.val<number>("select count(*)::int from public.email_outbox where user_id = $1", [user]);
      await t.q("select app.notify_user($1, $2, 'machine.verified', '{\"reg_number\":\"ABC2345\"}', '/machines/x', 'info')", [user, ORGS.owner_a]);
      expect(await t.val("select count(*)::int from public.email_outbox where user_id = $1", [user])).toBe(before);
      await t.q("select app.run_job('daily-digests')");
      expect(await t.val("select count(*)::int from public.email_outbox where user_id = $1 and template = 'notification_digest'", [user])).toBe(1);
      await t.q("select app.run_job('daily-digests')");
      expect(await t.val("select count(*)::int from public.email_outbox where user_id = $1 and template = 'notification_digest'", [user])).toBe(1);
    });
  });

  it("stolen for more than 24 months: one suggestion to the verifiers", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as(null);
      await t.q("insert into public.flags (machine_id, type, raised_by_org_id, reference, raised_at) values ($1, 'stolen', $2, 'P-OLD', now() - interval '25 months')", [m.id, ORGS.authority]);
      await t.q("select app.run_job('stolen-24-months')");
      await t.q("select app.run_job('stolen-24-months')");
      expect(await t.val("select count(distinct data ->> 'machine_id')::int from public.notifications where type = 'flag.stolen_24_months' and data ->> 'machine_id' = $1", [m.id])).toBe(1);
    });
  });

  it("every SQL job target exists and runs", async () => {
    await tx(async (t) => {
      await t.as(null);
      const jobs = await t.q<{ name: string }>("select name from public.jobs where kind = 'sql' and name <> 'billing-close' order by name");
      for (const j of jobs) {
        const r = JSON.parse(await t.val<string>("select app.run_job($1)::text", [j.name]));
        expect(r, j.name).toMatchObject({ status: "ok" });
      }
    });
  });
});
