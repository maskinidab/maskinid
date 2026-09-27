// Vercel Node function: POST /api/pdf (step 26, ADR 0023). Renders a formal PDF server-side with the same generators
// as the web app. Authorization: Bearer <Supabase access token>; the RPCs run as that user, so the database decides
// what may be issued. Body: { kind, org_id, machine_id | receipt_number | invoice_id, locale }.
import { parsePdfRequest, PdfRequestError, renderPdf, supabaseRpc } from "../apps/web/src/lib/pdf/server";

export const config = { runtime: "nodejs", maxDuration: 30 };

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/)?.[1];
  if (!token) return Response.json({ code: "NOT_AUTHENTICATED" }, { status: 401 });
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  try {
    const req = parsePdfRequest(await request.json().catch(() => null));
    const { bytes, filename } = await renderPdf(req, supabaseRpc(url, key, token));
    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof PdfRequestError) return Response.json({ code: e.code }, { status: e.status });
    console.error("pdf failed", e);
    return Response.json({ code: "INTERNAL" }, { status: 500 });
  }
}
