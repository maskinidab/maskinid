// The in-browser demo register (~7.5 MB) lives in public/demo-db so `npm run dev` and the e2e suite need no
// backend. A Supabase build never reads it, so drop it from the output instead of shipping it to Vercel on
// every deploy. Runs as `postbuild`, after Vite has copied public/ into dist.
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.VITE_DATA_SOURCE === "supabase") {
  const dir = fileURLToPath(new URL("../dist/demo-db", import.meta.url));
  // retries: on Windows the directory is briefly locked after the build copied into it.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (existsSync(dir)) {
    // Windows locks the directory while OneDrive syncs it. That only costs a bigger local dist, so warn there
    // and fail only on CI, where the output is what actually gets deployed.
    const msg = `postbuild: could not remove ${dir} – it holds ~7.5 MB of demo data`;
    if (process.env.CI) { console.error(msg); process.exit(1); }
    console.warn(`${msg} (ignored outside CI)`);
  } else {
    console.log("postbuild: dropped dist/demo-db (VITE_DATA_SOURCE=supabase)");
  }
}
