// Copies packages/shared/src into supabase/functions/_shared/shared so Edge Functions (Deno) can import the same
// code without relying on imports outside the functions directory. Run after changing packages/shared:
//   node scripts/sync-functions-shared.mjs          (write)
//   node scripts/sync-functions-shared.mjs --check  (CI: fail if out of date)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "packages/shared/src");
const dst = join(root, "supabase/functions/_shared/shared");
const skip = (p) => /\.test\.ts$/.test(p) || p.includes("testdata");

function list(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...list(p));
    else if (!skip(p)) out.push(p);
  }
  return out;
}

if (process.argv.includes("--check")) {
  const want = list(src).map((p) => relative(src, p)).sort();
  const have = existsSync(dst) ? list(dst).map((p) => relative(dst, p)).sort() : [];
  const stale = want.filter((f) => !have.includes(f) || readFileSync(join(src, f), "utf8") !== readFileSync(join(dst, f), "utf8"));
  const extra = have.filter((f) => !want.includes(f));
  if (stale.length || extra.length) {
    console.error(`supabase/functions/_shared/shared is out of date: ${[...stale, ...extra].join(", ")}\nRun: node scripts/sync-functions-shared.mjs`);
    process.exit(1);
  }
  console.log("functions shared code is in sync");
} else {
  // Copied file by file rather than with cpSync: on a OneDrive-backed working copy cpSync fails trying to unlink
  // the destination (errno 0, "The operation completed successfully"), and rmSync does not reliably clear it either.
  // Writing each file and then pruning what is no longer wanted gives the same result without touching that path.
  const want = list(src).map((p) => relative(src, p));
  for (const f of want) {
    const to = join(dst, f);
    mkdirSync(dirname(to), { recursive: true });
    const body = readFileSync(join(src, f));
    if (!existsSync(to) || !readFileSync(to).equals(body)) writeFileSync(to, body);
  }
  for (const f of (existsSync(dst) ? list(dst).map((p) => relative(dst, p)) : [])) {
    if (!want.includes(f)) rmSync(join(dst, f), { force: true });
  }
  console.log(`synced ${want.length} files to ${relative(root, dst)}`);
}
