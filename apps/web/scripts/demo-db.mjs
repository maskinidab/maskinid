// Builds the browser demo database: stubs + all migrations + seed, run in PGlite (Node) and dumped as a gzipped data
// directory to public/demo-db/maskinid-<version>.tar.gz. The version is a hash of every input, so the browser
// (which keeps the database in IndexedDB under that version) picks up schema or seed changes automatically.
//   node scripts/demo-db.mjs          build if missing
//   node scripts/demo-db.mjs --force  rebuild
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const supa = join(here, "../../../supabase");
const outDir = join(here, "../public/demo-db");

export function inputs() {
  const files = [
    join(supa, "tests/stubs/supabase-stubs.sql"),
    ...readdirSync(join(supa, "migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => join(supa, "migrations", f)),
    ...readdirSync(join(supa, "seed")).filter((f) => f.endsWith(".sql")).sort().map((f) => join(supa, "seed", f)),
  ];
  return files.map((f) => ({ name: f, sql: readFileSync(f, "utf8") }));
}

export function demoDbVersion() {
  const h = createHash("sha256");
  for (const { name, sql } of inputs()) h.update(name.split("/supabase/")[1]).update(sql);
  return h.digest("hex").slice(0, 12);
}

async function build(force) {
  const version = demoDbVersion();
  const target = join(outDir, `maskinid-${version}.tar.gz`);
  if (existsSync(target) && !force) {
    console.log(`demo db up to date (${version})`);
    return;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const t0 = Date.now();
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  for (const { name, sql } of inputs()) {
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  await db.exec("vacuum analyze");
  const dump = await db.dumpDataDir("gzip");
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.startsWith("maskinid-")) rmSync(join(outDir, f));
  writeFileSync(target, Buffer.from(await dump.arrayBuffer()));
  console.log(`demo db ${version}: ${Math.round(dump.size / 1024)} kB in ${Date.now() - t0} ms`);
  await db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build(process.argv.includes("--force"));
}
