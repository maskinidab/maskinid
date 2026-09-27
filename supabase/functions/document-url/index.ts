// Edge Function: document-url (SPEC §4.5, §11.5)
// Authorises a document download as the calling user (or with a share token) and returns a signed URL valid 5 minutes.
import { serviceClient, userClient } from "../_shared/db.ts";
import { json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("document-url", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const { document_id, share_token } = await req.json().catch(() => ({}));
  if (!document_id) return json(400, { code: "VALIDATION" });
  const caller = req.headers.get("Authorization") ? userClient(req) : serviceClient();
  const auth = share_token
    ? await serviceClient().rpc("authorize_document_download", { p_document_id: document_id, p_share_token: share_token })
    : await caller.rpc("authorize_document_download", { p_document_id: document_id });
  if (auth.error) return rpcError(auth.error);
  const { data, error } = await serviceClient().storage.from("documents").createSignedUrl(auth.data.path, 300, { download: auth.data.filename });
  if (error) return json(500, { code: "STORAGE_ERROR" });
  return json(200, { url: data.signedUrl, expires_in: 300, filename: auth.data.filename, mime: auth.data.mime });
}));
