// Edge Function: import-map (SPEC §6.5 step 2) – suggests a column mapping for an import file (AI), falls back to the
// deterministic header heuristic. POST { headers, sample, targets } → { mapping, source }.
import { heuristicColumnMapping } from "../_shared/shared/adapters/mock.ts";
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, userClient } from "../_shared/db.ts";
import { json, preflight } from "../_shared/http.ts";
import { createAnthropicOcr } from "../_shared/anthropic-ocr.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("import-map", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const ctx = await userClient(req).rpc("my_context");
  if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
  const { headers, sample, targets } = await req.json().catch(() => ({}));
  if (!Array.isArray(headers) || !Array.isArray(targets) || headers.length > 200) return json(422, { code: "VALIDATION" });
  const heuristic = heuristicColumnMapping(headers, targets);
  const { ocr } = createAdapters(envRecord(), Deno.env.get("ANTHROPIC_API_KEY") ? createAnthropicOcr() : undefined);
  if (ocr.name === "mock") return json(200, { mapping: heuristic, source: "heuristic" });
  try {
    const ai = await ocr.mapColumns({ headers, sample: (sample ?? []).slice(0, 5), targets });
    // Keep heuristic hits where the model had no answer.
    const mapping = Object.fromEntries(targets.map((t: string) => [t, ai[t] ?? heuristic[t] ?? null]));
    return json(200, { mapping, source: "ai" });
  } catch {
    return json(200, { mapping: heuristic, source: "heuristic" });
  }
}));
