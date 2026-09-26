// Local database for development and the RLS/RPC tests.
//
//   node supabase/scripts/local-db.mjs reset   – (re)create the database, apply migrations, seed and test fixtures
//
// Target: DATABASE_URL (default postgres://postgres:postgres@127.0.0.1:54322/postgres – the port `supabase start` uses).
// If the target already is a Supabase database (auth.users exists and SUPABASE_LOCAL=1), migrations are expected to be
// applied by `supabase db reset`; this script then only loads test fixtures. Otherwise (plain PostgreSQL, e.g. in a
// container without Docker) it creates the database `maskinid` with Supabase stubs (supabase/tests/stubs).
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
export const DEFAULT_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres";

export function targetUrl() {
  return process.env.DATABASE_URL ?? DEFAULT_URL;
}

function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export function migrationFiles() {
  return readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
}

export async function applySql(client, sql, label) {
  try {
    await client.query(sql);
  } catch (e) {
    const pos = e.position ? Number(e.position) : null;
    const ctx = pos ? sql.slice(Math.max(0, pos - 200), pos + 100) : "";
    throw new Error(`${label}: ${e.message}${e.where ? `\n  where: ${e.where}` : ""}${ctx ? `\n---\n${ctx}\n---` : ""}`);
  }
}

export async function reset({ seed = true, fixtures = true, quiet = false } = {}) {
  const url = targetUrl();
  const log = quiet ? () => {} : (m) => console.log(m);
  if (process.env.SUPABASE_LOCAL === "1") {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    if (fixtures) await applySql(c, readFileSync(join(root, "tests/fixtures.sql"), "utf8"), "fixtures.sql");
    await c.end();
    return url;
  }
  const dbName = process.env.MASKINID_DB ?? "maskinid";
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const dbUrl = withDb(url, dbName);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  await c.query("set client_min_messages = warning");
  await applySql(c, readFileSync(join(root, "tests/stubs/supabase-stubs.sql"), "utf8"), "supabase-stubs.sql");
  // The prototype migrations (20260926*) ran on the live project; replay them so the retirement migration is tested too.
  for (const f of migrationFiles()) {
    await applySql(c, readFileSync(join(root, "migrations", f), "utf8"), f);
    log(`applied ${f}`);
  }
  if (seed) {
    await applySql(c, readFileSync(join(root, "seed.sql"), "utf8"), "seed.sql");
    log("applied seed.sql");
  }
  if (fixtures) {
    await applySql(c, readFileSync(join(root, "tests/fixtures.sql"), "utf8"), "fixtures.sql");
    log("applied tests/fixtures.sql");
  }
  await c.end();
  return dbUrl;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? "reset";
  if (cmd === "reset") {
    const url = await reset({ fixtures: process.argv.includes("--fixtures") });
    console.log(`ready: ${url}`);
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(1);
  }
}
