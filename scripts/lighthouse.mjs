#!/usr/bin/env node
// Lighthouse budget for the public pages (step 27, ADR 0024). Measures a production build:
//   VITE_DATA_SOURCE=supabase VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… npm run build && npm run preview &
//   npm run lighthouse -- [--url http://localhost:4173] [--reg ABC2345] [--out lighthouse-report] [--no-performance]
// Budgets (mobile emulation, Lighthouse defaults): accessibility ≥ 95 and best practices ≥ 90 on every page, SEO ≥ 90 on
// indexable pages (machine cards are noindex on purpose), performance ≥ 75 on every page.
// The browser demo build (VITE_DATA_SOURCE=local) ships the whole register as an in-browser database (~20 MB), so
// performance is only meaningful for the Supabase build: pass --no-performance when measuring the demo.
// Exit code 1 when a budget is missed. Reports are written as HTML per page plus summary.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.map((a, i, all) => (a.startsWith("--") && all[i + 1] && !all[i + 1].startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const skipPerformance = argv.includes("--no-performance");
const base = (args.url || process.env.LIGHTHOUSE_URL || "http://localhost:4173").replace(/\/$/, "");
const out = args.out ?? "lighthouse-report";
const reg = args.reg || process.env.LIGHTHOUSE_REG || "ABC2345";

const PAGES = [
  { path: "/", budget: { performance: 0.75, accessibility: 0.95, "best-practices": 0.9, seo: 0.9 } },
  { path: "/security", budget: { performance: 0.75, accessibility: 0.95, "best-practices": 0.9, seo: 0.9 } },
  { path: "/pricing", budget: { performance: 0.75, accessibility: 0.95, "best-practices": 0.9, seo: 0.9 } },
  { path: "/stolen", budget: { performance: 0.75, accessibility: 0.95, "best-practices": 0.9, seo: 0.9 } },
  { path: `/r/${reg}`, budget: { performance: 0.75, accessibility: 0.95, "best-practices": 0.9 } },
].map((p) => (skipPerformance ? { ...p, budget: Object.fromEntries(Object.entries(p.budget).filter(([k]) => k !== "performance")) } : p));

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROMIUM_PATH || undefined,
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const p of PAGES) {
    const r = await lighthouse(`${base}${p.path}`, {
      port: chrome.port, output: "html", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    const scores = Object.fromEntries(Object.entries(r.lhr.categories).map(([k, c]) => [k, c.score]));
    const misses = Object.entries(p.budget).filter(([k, min]) => (scores[k] ?? 0) < min).map(([k, min]) => `${k} ${scores[k]} < ${min}`);
    writeFileSync(join(out, `${p.path.replace(/\W+/g, "_") || "root"}.html`), r.report);
    results.push({ page: p.path, scores, ok: misses.length === 0, misses });
    console.log(`${misses.length ? "✗" : "✓"} ${p.path}  ${Object.entries(scores).map(([k, v]) => `${k}=${Math.round((v ?? 0) * 100)}`).join(" ")}${misses.length ? `  (${misses.join(", ")})` : ""}`);
  }
} finally {
  await chrome.kill();
}
writeFileSync(join(out, "summary.json"), JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
