// Lists translation keys used in apps/web/src (t("…") / i18nKey="…" / label: "…" in nav) that are missing in sv.json.
// Dynamic keys (template strings) are ignored. Exit code 1 if anything is missing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sv = JSON.parse(readFileSync(join(root, "packages/shared/src/i18n/sv.json"), "utf8"));
const flat = {};
(function walk(o, p) {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") walk(v, key);
    else flat[key] = v;
  }
})(sv, "");

function files(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(tsx?|mjs)$/.test(e) && !e.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const used = new Map();
const re = [/\bt\(\s*"([a-z][\w.]*[\w])"/g, /\bt\(\s*'([a-z][\w.]*[\w])'/g, /label:\s*"((?:nav|common)\.[\w.]+)"/g, /i18nKey="([\w.]+)"/g];
for (const f of files(join(root, "apps/web/src"))) {
  const src = readFileSync(f, "utf8");
  for (const r of re) for (const m of src.matchAll(r)) if (!(m[1] in flat) && !(`${m[1]}_other` in flat)) used.set(m[1], f.replace(root, ""));
}
if (used.size) {
  for (const [k, f] of used) console.log(`${k}\t${f}`);
  process.exitCode = 1;
} else console.log("all i18n keys present");
