// Edge Function: bankid-identify (SPEC §2.4, §11.1). Verifies the signed-in user's identity with BankID via the OIDC
// broker. POST (user) → { url } to redirect to; GET (callback from the broker) → records the verification and sends
// the browser back. The personal number is hashed by the database and never stored in clear.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, serviceClient, userClient } from "../_shared/db.ts";
import { json, preflight } from "../_shared/http.ts";
import { safeReturnTo, signState, verifyState } from "../_shared/oidc-state.ts";
import { withSentry } from "../_shared/sentry.ts";

const callbackUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/bankid-identify`;
const appOrigin = () => Deno.env.get("APP_ORIGIN") ?? "http://localhost:5173";
const secret = () => Deno.env.get("BANKID_STATE_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry("bankid-identify", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const { identity } = createAdapters(envRecord());
  if (identity.name !== "bankid") return json(409, { code: "USE_MOCK_PROVIDER" });

  if (req.method === "POST") {
    const ctx = await userClient(req).rpc("my_context");
    if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
    const body = await req.json().catch(() => ({}));
    const state = await signState({ kind: "identify", uid: ctx.data.user_id, return_to: safeReturnTo(body.return_to, appOrigin()) }, secret());
    const payload = await verifyState(state, secret(), "identify");
    const { url } = await identity.start({ redirectUri: callbackUrl(), state, nonce: payload!.nonce });
    return json(200, { url });
  }

  // Callback: ?code=…&state=…
  const params = new URL(req.url).searchParams;
  const state = await verifyState(params.get("state") ?? "", secret(), "identify");
  if (!state) return json(400, { code: "LINK_INVALID" });
  const back = new URL(state.return_to);
  const code = params.get("code");
  if (!code) {
    back.searchParams.set("bankid", "cancelled");
    return Response.redirect(back.toString(), 302);
  }
  try {
    const r = await identity.complete({ code, redirectUri: callbackUrl(), nonce: state.nonce });
    const { error } = await serviceClient().rpc("record_identity_verification", {
      p_user_id: state.uid, p_personal_number: r.personalNumber, p_provider: "bankid", p_evidence: r.evidence,
    });
    back.searchParams.set("bankid", error ? (error.message ?? "failed") : "ok");
  } catch (e) {
    console.error("bankid-identify failed", (e as Error).message);
    back.searchParams.set("bankid", "failed");
  }
  return Response.redirect(back.toString(), 302);
}));
