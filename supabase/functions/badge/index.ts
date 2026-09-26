// Edge Function: badge (SPEC §7.3) – GET /embed/badge/:reg.svg, public, cached 5 min, noindex.
// "Verifierad nivå 2 · Ingen stöldflagga"; the SVG links to the public page when embedded as <a><img></a>.
import { serviceClient } from "../_shared/db.ts";
import { preflight } from "../_shared/http.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function badgeSvg(b: { found: boolean; reg_number?: string; verification_level?: number; stolen?: boolean; status?: string }, lang = "sv") {
  const sv = lang !== "en";
  const reg = b.reg_number ? `${b.reg_number.slice(0, 3)}-${b.reg_number.slice(3)}` : "";
  const right = !b.found ? (sv ? "Finns inte" : "Not found")
    : b.stolen ? (sv ? "ANMÄLD STULEN" : "REPORTED STOLEN")
    : b.status !== "active" ? (sv ? "Ej aktiv" : "Not active")
    : `${sv ? "Nivå" : "Level"} ${b.verification_level} · ${sv ? "Ingen stöldflagga" : "No theft flag"}`;
  const color = !b.found || b.status !== "active" || b.stolen ? "#C4322B" : "#1D6B45";
  const w = 96 + right.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 90}" height="28" role="img" aria-label="MaskinID ${esc(reg)} ${esc(right)}">
<rect width="90" height="28" fill="#FFCC00"/><rect x="90" width="${w}" height="28" fill="${color}"/>
<text x="10" y="18" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="700" fill="#111">MaskinID</text>
<text x="100" y="18" font-family="Menlo,monospace" font-size="12" fill="#fff">${esc(reg)}</text>
<text x="${104 + reg.length * 7.5}" y="18" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#fff">${esc(right)}</text></svg>`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const url = new URL(req.url);
  const reg = (url.searchParams.get("reg") ?? url.pathname.split("/").pop() ?? "").replace(/\.svg$/i, "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 10);
  const { data } = await serviceClient().rpc("badge_data", { p_reg: reg });
  return new Response(badgeSvg(data ?? { found: false }, url.searchParams.get("lang") ?? "sv"), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex",
      "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" },
  });
});
