// Edge Function: bankid-sign (SPEC §11.1, §16.9). The signer confirms the server-built text with BankID.
// POST (user) { signature_id, return_to } → { url }; GET (broker callback) → record_signature, then back to the app.
// The database checks that the BankID personal number belongs to the signed-in user; the app polls the status.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, serviceClient, userClient } from "../_shared/db.ts";
import { json, preflight } from "../_shared/http.ts";
import { safeReturnTo, signState, verifyState } from "../_shared/oidc-state.ts";

const callbackUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/bankid-sign`;
const appOrigin = () => Deno.env.get("APP_ORIGIN") ?? "http://localhost:5173";
const secret = () => Deno.env.get("BANKID_STATE_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const { signature } = createAdapters(envRecord());
  if (signature.name !== "bankid") return json(409, { code: "USE_MOCK_PROVIDER" });

  if (req.method === "POST") {
    const ctx = await userClient(req).rpc("my_context");
    if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
    const body = await req.json().catch(() => ({}));
    if (typeof body.signature_id !== "string") return json(422, { code: "VALIDATION", detail: { field: "signature_id" } });
    const { data: s } = await serviceClient().from("signatures")
      .select("id, signed_text, subject_type, subject_id, signer_user_id, status, provider, expires_at").eq("id", body.signature_id).maybeSingle();
    if (!s || s.signer_user_id !== ctx.data.user_id) return json(404, { code: "NOT_FOUND" });
    if (s.status !== "pending" || s.provider !== "bankid" || new Date(s.expires_at) < new Date()) return json(409, { code: "SIGNATURE_INVALID" });
    const state = await signState({ kind: "sign", uid: ctx.data.user_id, sid: s.id, return_to: safeReturnTo(body.return_to, appOrigin()) }, secret());
    const { url } = await signature.start({ signedText: s.signed_text, subjectType: s.subject_type, subjectId: s.subject_id, redirectUri: callbackUrl(), state });
    return json(200, { url });
  }

  const params = new URL(req.url).searchParams;
  const token = params.get("state") ?? "";
  const state = await verifyState(token, secret(), "sign");
  if (!state?.sid) return json(400, { code: "LINK_INVALID" });
  const back = new URL(state.return_to);
  const code = params.get("code");
  const r = code
    ? await signature.collect(token, { code, redirectUri: callbackUrl() })
    : { provider: "bankid" as const, status: "cancelled" as const, evidence: { reason: params.get("error") ?? "cancelled" } };
  const { data, error } = await serviceClient().rpc("record_signature", {
    p_signature_id: state.sid, p_status: r.status, p_personal_number: r.personalNumber ?? null, p_evidence: r.evidence,
  });
  back.searchParams.set("signature", error ? "failed" : String(data?.status ?? r.status));
  return Response.redirect(back.toString(), 302);
});
