/**
 * Local emulation of the Edge Functions (see supabase/functions). Each handler does what the function does on the
 * server in DEMO_MODE, using the same RPCs (as service_role where the real function uses the service key) and the
 * same mock adapters from @maskinid/shared.
 */
import { heuristicColumnMapping, mockOcr } from "@maskinid/shared/adapters/mock.ts";
import { ApiError } from "./errors";
import { idbGet } from "./idb";
import type { LocalContext } from "./local";
import type { InvokeOptions } from "./types";

type Handler = (ctx: LocalContext, body: any, opts: InvokeOptions) => Promise<unknown>;

const LOCAL_IP = "local-browser";

export const localFunctions: Record<string, Handler> = {
  async "scan-log"(ctx, body, opts) {
    const code = body?.code ?? opts.query?.code ?? null;
    const reg = body?.reg ?? opts.query?.reg ?? null;
    if (body?.sighting) {
      return ctx.rpcAs("service_role", "report_sighting", {
        p_code: code, p_reg: reg, p_ip_hash: LOCAL_IP, p_location: body.location ?? null, p_message: body.message ?? null, p_contact: body.contact ?? null,
      });
    }
    return ctx.rpcAs("service_role", "log_public_scan", {
      p_code: code, p_reg: reg, p_ip_hash: LOCAL_IP, p_user_agent_family: "browser", p_location: body?.location ?? null,
    });
  },

  async lead(ctx, body) {
    return ctx.rpcAs("service_role", "submit_lead", {
      p_reg: String(body?.reg ?? ""), p_name: String(body?.name ?? ""), p_contact: String(body?.contact ?? ""),
      p_message: body?.message ?? null, p_consent: body?.consent === true, p_ip_hash: LOCAL_IP,
    });
  },

  async "share-view"(ctx, _body, opts) {
    if (opts.query?.report === "1") return ctx.rpcAs("service_role", "create_shared_machine_report", { p_token: opts.query?.token ?? "", p_ip_hash: LOCAL_IP });
    const r = await ctx.rpcAs<{ ok: boolean }>("service_role", "get_share_view", { p_token: opts.query?.token ?? "", p_ip_hash: LOCAL_IP });
    return r;
  },

  async "document-url"(ctx, body) {
    const auth = await (body?.share_token
      ? ctx.rpcAs<{ path: string; filename: string; mime: string }>("service_role", "authorize_document_download", {
          p_document_id: body.document_id, p_share_token: body.share_token,
        })
      : ctx.rpcAs<{ path: string; filename: string; mime: string }>(ctx.session() ? "authenticated" : "anon", "authorize_document_download", {
          p_document_id: body.document_id,
        }));
    const file = await idbGet<{ blob: Blob }>(`documents/${auth.path}`);
    // Seeded demo documents have no file content: serve a small placeholder PDF text so downloads work.
    const blob = file?.blob ?? new Blob([`MaskinID demo document: ${auth.filename}`], { type: "text/plain" });
    return { url: URL.createObjectURL(blob), expires_in: 300, filename: auth.filename, mime: auth.mime };
  },

  async "av-scan"() {
    return { status: "clean" };
  },

  async "company-lookup"(ctx, body) {
    return ctx.rpcAs("authenticated", "lookup_company", { p_org_number: body?.org_number });
  },

  async "vtr-lookup"(ctx, body) {
    return ctx.rpcAs("authenticated", "lookup_vehicle_registry", { p_road_reg: body?.road_reg });
  },

  async "ocr-nameplate"(_ctx, body) {
    if (!body?.image_base64) throw new ApiError("VALIDATION", { field: "image" });
    return mockOcr.nameplate({ base64: body.image_base64, mediaType: body.media_type ?? "image/jpeg" });
  },

  async "import-map"(_ctx, body) {
    return { mapping: heuristicColumnMapping(body?.headers ?? [], body?.targets ?? []), source: "heuristic" };
  },
};
