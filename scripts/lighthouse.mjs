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
// Each page is measured this many times and judged on the median (override with --samples N, or 1 to sample once).
const SAMPLES = Math.max(1, Number(args.samples ?? process.env.LIGHTHOUSE_SAMPLES ?? 3));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

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
    // Shared CI runners swing a page's performance score by 20 points or more between identical runs, which is
    // wider than the budget itself: a single sample tells you nothing about whether a change helped. Sample a few
    // times and judge the median, so a red build means a real regression rather than a noisy neighbour.
    const runs = [];
    for (let i = 0; i < SAMPLES; i++) {
      runs.push(await lighthouse(`${base}${p.path}`, {
        port: chrome.port, output: "html", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      }));
    }
    const categories = Object.keys(runs[0].lhr.categories);
    const scores = Object.fromEntries(categories.map((k) => [k, median(runs.map((r) => r.lhr.categories[k].score ?? 0))]));
    // Keep the report whose performance score is the median one, so the artefact matches the verdict.
    const perf = runs.map((r) => r.lhr.categories.performance?.score ?? 0);
    const keep = runs[perf.indexOf([...perf].sort((a, b) => a - b)[Math.floor((perf.length - 1) / 2)])] ?? runs[0];
    const misses = Object.entries(p.budget).filter(([k, min]) => (scores[k] ?? 0) < min).map(([k, min]) => `${k} ${scores[k]} < ${min}`);
    writeFileSync(join(out, `${p.path.replace(/\W+/g, "_") || "root"}.html`), keep.report);
    results.push({ page: p.path, scores, samples: perf, ok: misses.length === 0, misses });
    const spread = SAMPLES > 1 ? `  [${perf.map((v) => Math.round(v * 100)).join("/")}]` : "";
    console.log(`${misses.length ? "✗" : "✓"} ${p.path}  ${Object.entries(scores).map(([k, v]) => `${k}=${Math.round((v ?? 0) * 100)}`).join(" ")}${spread}${misses.length ? `  (${misses.join(", ")})` : ""}`);
  }
} finally {
  await chrome.kill();
}
writeFileSync(join(out, "summary.json"), JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
