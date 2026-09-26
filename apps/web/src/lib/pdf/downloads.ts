import type { TFunction } from "i18next";
import { rpc } from "../api/query";
import { backend } from "../backend";
import { certificatePdf, machineReportPdf, type CertificateSnapshot, type MachineReportSnapshot } from "./certificate";
import { downloadBytes } from "./receipt";

interface Issued<T> { report_number: string; result_hash: string; result: T }

/** Issues a new ownership certificate (B-number) and downloads it. */
export async function downloadCertificate(orgId: string, machineId: string, t: TFunction) {
  const c = await rpc<Issued<CertificateSnapshot>>("create_ownership_certificate", { p_org_id: orgId, p_machine_id: machineId });
  downloadBytes(await certificatePdf(c.result, c, t), `agarbevis-${c.report_number}.pdf`);
  return c;
}

/** Issues a machine report (R-number) for the owner and downloads it. */
export async function downloadMachineReport(orgId: string, machineId: string, t: TFunction) {
  const r = await rpc<Issued<MachineReportSnapshot>>("create_machine_report", { p_org_id: orgId, p_machine_id: machineId });
  downloadBytes(await machineReportPdf(r.result, r, t), `maskinrapport-${r.report_number}.pdf`);
}

/** Machine report from a buyer_report share link (no sign-in). */
export async function downloadSharedMachineReport(token: string, t: TFunction) {
  const r = await backend.invoke<Issued<MachineReportSnapshot>>("share-view", undefined, { method: "GET", query: { token, report: "1" }, anonymous: true });
  downloadBytes(await machineReportPdf(r.result, r, t), `maskinrapport-${r.report_number}.pdf`);
}
