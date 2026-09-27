/**
 * Server-side PDFs (step 26, ADR 0023) for the Vercel Node function api/pdf.ts: the same generators as in the browser,
 * fed by the same RPCs called as the signed-in user, so authorisation and document numbering are identical.
 * Used for e-mail attachments and for API clients that want a finished PDF.
 */
import { translator, type Locale } from "@maskinid/shared/i18n/index.ts";
import type { TFunction } from "i18next";
import i18n from "../../i18n";
import type { CheckReceipt } from "../../components/ReceiptCard";
import { certificatePdf, machineReportPdf, type CertificateSnapshot, type MachineReportSnapshot } from "./certificate";
import { extractPdf } from "./extract";
import { invoicePdf, type InvoiceDetail } from "./invoice";
import { receiptPdf } from "./receipt";

export const PDF_KINDS = ["certificate", "machine_report", "register_extract", "receipt", "invoice"] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

export interface PdfRequest { kind: PdfKind; org_id?: string; machine_id?: string; receipt_number?: string; invoice_id?: string; locale?: Locale }
export type RpcCall = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

export class PdfRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Issued<T> { report_number: string; result_hash: string; result: T }

export function parsePdfRequest(body: unknown): PdfRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!PDF_KINDS.includes(b.kind as PdfKind)) throw new PdfRequestError(422, "VALIDATION");
  const need = (k: string, re: RegExp) => { if (typeof b[k] !== "string" || !re.test(b[k] as string)) throw new PdfRequestError(422, "VALIDATION"); };
  const kind = b.kind as PdfKind;
  if (kind === "receipt") need("receipt_number", /^[A-Z]-\d{4}-\d{6}$/);
  else if (kind === "invoice") { need("org_id", UUID); need("invoice_id", UUID); }
  else { need("org_id", UUID); need("machine_id", UUID); }
  return { kind, org_id: b.org_id as string, machine_id: b.machine_id as string, receipt_number: b.receipt_number as string,
    invoice_id: b.invoice_id as string, locale: b.locale === "en" ? "en" : "sv" };
}

export async function renderPdf(req: PdfRequest, rpc: RpcCall): Promise<{ bytes: Uint8Array; filename: string }> {
  const locale = req.locale ?? "sv";
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
  const t = translator(locale) as unknown as TFunction;
  switch (req.kind) {
    case "certificate": {
      const c = await rpc<Issued<CertificateSnapshot>>("create_ownership_certificate", { p_org_id: req.org_id, p_machine_id: req.machine_id });
      return { bytes: await certificatePdf(c.result, c, t), filename: `agarbevis-${c.report_number}.pdf` };
    }
    case "machine_report": {
      const r = await rpc<Issued<MachineReportSnapshot>>("create_machine_report", { p_org_id: req.org_id, p_machine_id: req.machine_id });
      return { bytes: await machineReportPdf(r.result, r, t), filename: `maskinrapport-${r.report_number}.pdf` };
    }
    case "register_extract": {
      const x = await rpc<Issued<never>>("create_register_extract", { p_org_id: req.org_id, p_machine_id: req.machine_id });
      return { bytes: await extractPdf(x.result, x, t), filename: `registerutdrag-${x.report_number}.pdf` };
    }
    case "receipt": {
      const r = await rpc<CheckReceipt>("get_check_receipt", { p_receipt_number: req.receipt_number });
      return { bytes: await receiptPdf(r, t), filename: `kontrollkvitto-${r.receipt_number}.pdf` };
    }
    case "invoice": {
      const inv = await rpc<InvoiceDetail>("get_invoice", { p_org_id: req.org_id, p_invoice_id: req.invoice_id });
      return { bytes: await invoicePdf(inv, t, locale), filename: `${inv.number}.pdf` };
    }
  }
}

/** Calls a Supabase RPC over REST as the user whose access token was given. */
export function supabaseRpc(url: string, anonKey: string, accessToken: string, f: typeof fetch = fetch): RpcCall {
  return async <T>(fn: string, args: Record<string, unknown>) => {
    const res = await f(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const code = typeof j?.message === "string" && /^[A-Z_]+$/.test(j.message) ? j.message : "UPSTREAM";
      throw new PdfRequestError(res.status === 401 ? 401 : res.status >= 500 ? 502 : res.status, code);
    }
    return j as T;
  };
}
