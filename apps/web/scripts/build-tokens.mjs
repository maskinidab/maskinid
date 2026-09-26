// Genererar src/styles/tokens.css från design-system/tokens.json (den grafiska profilens tokens).
// Kör: npm run tokens
import { readFileSync, writeFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync(new URL("../../../design-system/tokens.json", import.meta.url), "utf8"));
const [light, dark] = tokens.color.themes.map((t) => t.id);

const ljust = [];
const morkt = [];
for (const c of tokens.color.tokens) {
  ljust.push(`  --${c.name}: ${c.value[light]};`);
  morkt.push(`  --${c.name}: ${c.value[dark] ?? c.value[light]};`);
}
for (const [name, value] of Object.entries(tokens.type.families)) ljust.push(`  --font-${name}: ${value};`);
for (const family of ["spacing", "radius", "stroke"]) {
  for (const t of tokens[family].tokens) ljust.push(`  --${t.name}: ${t.value};`);
}
for (const s of tokens.shadow.tokens) {
  ljust.push(`  --${s.name}: ${s.value[light]};`);
  morkt.push(`  --${s.name}: ${s.value[dark]};`);
}

// "light"/"dark" stöds också, för värdmiljöer (t.ex. claude.ai) som sätter data-theme själva.
const darkBlock = ["  color-scheme: dark;", ...morkt];
const css = `/* GENERERAD från design-system/tokens.json – ändra där och kör \`npm run tokens\`. */
:root {
  color-scheme: light;
${ljust.join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="${light}"]):not([data-theme="light"]) {
${darkBlock.map((l) => "  " + l).join("\n")}
  }
}

:root[data-theme="${dark}"],
:root[data-theme="dark"] {
${darkBlock.join("\n")}
}
`;
writeFileSync(new URL("../src/styles/tokens.css", import.meta.url), css);
console.log("tokens.css skriven");
