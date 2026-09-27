// Adds or updates translation keys in both languages and keeps the files sorted.
//   node scripts/i18n-set.mjs keys.json      where keys.json = { "a.b": ["svensk text", "English text"], ... }
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../packages/shared/src/i18n/", import.meta.url);
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [idx, lang] of [[0, "sv"], [1, "en"]]) {
  const file = new URL(`${lang}.json`, dir);
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const [key, vals] of Object.entries(input)) {
    const parts = key.split(".");
    let cur = data;
    for (const p of parts.slice(0, -1)) {
      if (typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts.at(-1)] = vals[idx];
  }
  const sort = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])])) : o);
  writeFileSync(file, JSON.stringify(sort(data), null, 1) + "\n");
}
console.log(`set ${Object.keys(input).length} keys`);
