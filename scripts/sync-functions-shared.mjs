// Copies packages/shared/src into supabase/functions/_shared/shared so Edge Functions (Deno) can import the same
// code without relying on imports outside the functions directory. Run after changing packages/shared:
//   node scripts/sync-functions-shared.mjs          (write)
//   node scripts/sync-functions-shared.mjs --check  (CI: fail if out of date)
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true, filter: (p) => !skip(p) });
  console.log(`synced ${list(dst).length} files to ${relative(root, dst)}`);
}
