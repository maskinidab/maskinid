import { heuristicColumnMapping } from "@maskinid/shared/adapters/mock.ts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { formatDate } from "../../../lib/format";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { readTabularFile, toCsv } from "../../../lib/tabular";

const FIELDS = ["serial_number", "make", "model", "variant", "year", "category", "engine_make", "engine_model", "engine_serial", "emission_stage",
  "engine_power_kw", "service_weight_kg", "fuel_type", "has_lifting_device", "delivered_at", "delivered_to_country"];
const SYN: Record<string, string> = { serial_number: "serial", service_weight_kg: "weight", engine_power_kw: "power" };

interface Oem { total: number; matched: number; items: { id: string; make: string; model: string; year: number | null; serial_number: string;
  delivered_at: string | null; source: string; matched: boolean; reg_number: string | null }[] }

/** Manufacturer portal (SPEC §4.3 oem_records): delivery data via file (or API); registrations pick it up as factory data. */
export function OemPage() {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const q = useRpc<Oem>("list_oem_records", { p_org_id: orgId });
  const [result, setResult] = useState<{ saved: number; errors: { row: number; code: string }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const table = await readTabularFile(file);
      const heur = heuristicColumnMapping(table.headers, FIELDS.map((f) => SYN[f] ?? f));
      const rows = table.rows.map((r) => Object.fromEntries(FIELDS.map((f) => {
        const col = table.headers.find((h) => h.toLowerCase() === f) ?? heur[SYN[f] ?? f];
        return [f, col ? r[col] ?? "" : ""];
      })));
      setResult(await rpc("submit_oem_records", { p_org_id: orgId, p_rows: rows }));
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.oem")} lead={t("oem.lead")} />
      {q.data && (
        <dl className="nyckeltal">
          <div><dt>{t("oem.total")}</dt><dd>{q.data.total}</dd></div>
          <div><dt>{t("oem.matched")}</dt><dd>{q.data.matched}</dd></div>
        </dl>
      )}
      {canWrite && (
        <section className="panel stack-3">
          <FormField label={t("oem.file")} hint={t("oem.file_hint")}>
            <input type="file" className="mid-input" accept=".csv,.txt,.xlsx" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </FormField>
          <div><button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => downloadBytes(new TextEncoder().encode(toCsv(FIELDS,
            [["VCE0EC300E00012345", "Volvo", "EC300E", "", "2026", "excavator_tracked", "Volvo", "D8M", "", "stage_v", "200", "30000", "diesel", "true", "2026-09-01", "SE"]])), "maskinid-oem-mall.csv", "text/csv")}>
            <Icon name="nedladdning" />{t("import.template")}</button></div>
          {result && <Notice kind={result.errors.length ? "info" : "ok"} title={t("oem.saved", { count: result.saved })}>
            {result.errors.length > 0 && <p className="t-liten">{t("oem.errors", { rows: result.errors.map((e) => e.row).join(", ") })}</p>}</Notice>}
          {error != null && <ErrorNotice error={error} />}
        </section>
      )}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.oem")} rows={q.data?.items ?? []} getKey={(i) => i.id} exportName="leveransdata"
          empty={<EmptyState icon="verktyg" title={t("oem.empty")} />}
          columns={[
            { id: "serial", header: t("machines.col_serial"), value: (i) => i.serial_number, cell: (i) => <span className="mid-id">{i.serial_number}</span> },
            { id: "machine", header: t("machines.col_machine"), value: (i) => `${i.make} ${i.model}`, cell: (i) => `${i.make} ${i.model}${i.year ? ` · ${i.year}` : ""}` },
            { id: "delivered", header: t("oem.delivered"), value: (i) => i.delivered_at, cell: (i) => formatDate(i.delivered_at) || "–", sortable: true },
            { id: "match", header: t("oem.registered"), value: (i) => i.reg_number ?? "", cell: (i) => i.reg_number ? <RegNumber value={i.reg_number} /> : "–" },
          ]} />
      )}
    </div>
  );
}
