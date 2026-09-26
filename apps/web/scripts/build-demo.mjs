// Bygger en fristående demo av appen som EN html-fil (mock-data, hash-routing, allt inlinat).
// Används för att dela en klickbar demo utan server. Kör: npm run build:demo
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

execSync("vite build --mode demo", {
  stdio: "inherit",
  env: { ...process.env, VITE_ROUTER: "hash", VITE_DATA_SOURCE: "mock" },
});

const dir = new URL("../dist-demo/", import.meta.url);
const html = readFileSync(new URL("index.html", dir), "utf8");
const js = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/);
if (!js || !css) throw new Error("Hittade inte byggda filer i dist-demo/index.html");

const script = readFileSync(new URL(js[1], dir), "utf8").replace(/<\/script/gi, "<\\/script");
const style = readFileSync(new URL(css[1], dir), "utf8");
const title = html.match(/<title>.*<\/title>/)[0];

const out = `${title}
<meta name="description" content="MaskinID – demo med exempeldata.">
<style>${style}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(new URL("maskinid-demo.html", dir), out);
console.log(`dist-demo/maskinid-demo.html (${Math.round(out.length / 1024)} kB)`);
