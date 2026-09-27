#!/usr/bin/env node
// Verifies a restored database copy (backup / PITR drill, step 26, docs/runbooks/backup-restore.md).
//   DATABASE_URL=postgres://… node scripts/verify-restore.mjs [--reference-url https://<ref>.supabase.co --anon-key …]
// Checks: migrations up to date, the whole event chain verifies, row-level security is on for every table, the register
// has data, and – with a reference – the latest anchor in the copy equals the one the live system published.
// Prints a JSON report; exit code 1 on any failure. Read-only: never writes to the database.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const root = new URL("..", import.meta.url).pathname;
const latestFile = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().at(-1)?.split("_")[0];

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("begin read only");
const checks = [];
const check = async (name, fn) => {
  try {
    const r = await fn();
    checks.push({ name, ok: r.ok, ...r });
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
  }
};
const one = async (sql) => (await client.query(sql)).rows[0];

await check("migrations", async () => {
  const exists = (await one("select to_regclass('supabase_migrations.schema_migrations') is not null as e")).e;
  if (!exists) return { ok: true, note: "no migration table (plain PostgreSQL copy)" };
  const v = (await one("select max(version) v from supabase_migrations.schema_migrations")).v;
  return { ok: v === latestFile, restored: v, expected: latestFile };
});
await check("event_chain", async () => {
  const r = (await one("select app.verify_chain() r")).r;
  return { ok: r.ok === true, checked: r.checked, detail: r.ok ? undefined : r };
});
await check("row_level_security", async () => {
  const rows = (await client.query("select tablename from pg_tables where schemaname = 'public' and not rowsecurity")).rows;
  return { ok: rows.length === 0, without_rls: rows.map((r) => r.tablename) };
});
await check("data_present", async () => {
  const r = await one(`select (select count(*) from public.machines)::int machines, (select count(*) from public.organizations)::int orgs,
    (select count(*) from public.events)::int events, (select max(created_at) from public.events) last_event`);
  return { ok: r.machines > 0 && r.orgs > 0 && r.events > 0, ...r };
});
await check("anchor_matches_live", async () => {
  const a = await one("select day::text, root_hash from public.event_anchors where published_at is not null order by day desc limit 1");
  if (!a) return { ok: false, error: "no published anchor in the copy" };
  if (!args["reference-url"] || !args["anon-key"]) return { ok: true, note: "no reference given", day: a.day };
  const res = await fetch(`${args["reference-url"].replace(/\/$/, "")}/rest/v1/rpc/public_system_status`, {
    method: "POST", headers: { apikey: args["anon-key"], "Content-Type": "application/json" }, body: "{}",
  });
  const live = (await res.json()).last_anchor;
  // The live system may be ahead of the restore point; compare the same day when available.
  if (live?.day === a.day) return { ok: live.root === a.root_hash, day: a.day };
  return { ok: !!live && live.day >= a.day, day: a.day, live_day: live?.day, note: "live is ahead of the restore point" };
});

await client.query("rollback");
await client.end();
const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({ ok, at: new Date().toISOString(), checks }, null, 2));
process.exit(ok ? 0 : 1);
