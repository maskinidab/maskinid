import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { useSign } from "../../../components/Signature";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { backend } from "../../../lib/backend";
import { formatDateTime } from "../../../lib/format";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { parseCsv, readTabularFile, toCsv, type Table } from "../../../lib/tabular";

export const BASE_TARGETS = ["serial", "pin", "vin", "road_reg", "make", "model", "year", "category", "hour_meter", "owner_org_number", "color", "description"];
export const FINANCIER_TARGETS = ["contract_ref", "encumbrance_type", "start_date", "end_date"];
const REQUIRED = ["serial", "make", "model"];

export interface ImportRow {
  row_no: number;
  data: Record<string, unknown>;
  identifiers: { type: string; value: string }[];
  errors: { field: string; code: string; reg_number?: string; row_no?: number }[];
  status: "ok" | "error" | "skipped" | "committed";
  action: "create" | "encumber_existing";
  machine_id: string | null;
  reg_number: string | null;
}
export interface ImportResult {
  id: string; filename: string; status: string; rows_total: number; rows_ok: number; rows_error: number; rows_committed: number;
  with_encumbrances: boolean; encumbrance_rows: number; created_at: string; committed_at: string | null; rows?: ImportRow[];
}

/** Template with the columns the importing org can use (SPEC §6.5 "mall att ladda ner"). */
export function templateCsv(targets: string[], label: (k: string) => string): string {
  return toCsv(targets.map(label), [targets.map((k) => ({ serial: "VCE0EC220E00012345", make: "Volvo", model: "EC220E", year: "2021",
    category: "Grävmaskin", hour_meter: "4200", owner_org_number: "556677-8899", contract_ref: "AVT-1001", encumbrance_type: "Leasing",
    start_date: "2026-01-01", end_date: "2030-12-31" } as Record<string, string>)[k] ?? "")]);
}

type Step = "upload" | "map" | "preview" | "done";

/** Bulk import (SPEC §6.5): upload/paste → column mapping (AI suggestion) → row-by-row validation → commit → report. */
export function ImportPage() {
  const { t } = useTranslation();
  const { orgId, has, path } = useOrg();
  const sign = useSign();
  const targets = has("financier") ? [...BASE_TARGETS, ...FINANCIER_TARGETS] : BASE_TARGETS;
  const history = useRpc<ImportResult[]>("list_imports", { p_org_id: orgId });
  const [step, setStep] = useState<Step>("upload");
  const [table, setTable] = useState<Table | null>(null);
  const [filename, setFilename] = useState("");
  const [paste, setPaste] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [mapSource, setMapSource] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const label = (k: string) => t(`import.field.${k}`);

  async function load(tab: Table, name: string) {
    setError(null);
    if (tab.rows.length === 0) { setError(new Error("EMPTY")); return; }
    setTable(tab);
    setFilename(name);
    setBusy(true);
    try {
      const r = await backend.invoke<{ mapping: Record<string, string | null>; source: string }>("import-map", {
        headers: tab.headers, sample: tab.rows.slice(0, 5), targets,
      });
      setMapping(r.mapping);
      setMapSource(r.source);
    } catch {
      setMapping(Object.fromEntries(targets.map((k) => [k, null])));
    } finally {
      setBusy(false);
      setStep("map");
    }
  }

  async function validate() {
    if (!table) return;
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
      setResult(await rpc<ImportResult>("create_import", { p_org_id: orgId, p_filename: filename, p_mapping: clean, p_rows: table.rows }));
      setStep("preview");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const sig = result.encumbrance_rows > 0
        ? await sign(orgId, "import_commit", result.id, { rows: result.rows_ok, encumbrances: result.encumbrance_rows }) : null;
      setResult(await rpc<ImportResult>("import_commit", { p_org_id: orgId, p_import_id: result.id, p_signature_id: sig }));
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
      setStep("done");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function errorText(e: ImportRow["errors"][number]) {
    const field = e.field === "row" ? "" : `${label(e.field)}: `;
    return field + t(`import.error.${e.code}`, { defaultValue: e.code, reg: e.reg_number ?? "", row: e.row_no ?? "" });
  }

  function errorReport() {
    const rows = (result?.rows ?? []).filter((r) => r.errors.length > 0);
    const csv = toCsv([t("import.col_row"), ...targets.map(label), t("import.col_errors")],
      rows.map((r) => [r.row_no, ...targets.map((k) => (k in r.data ? String(r.data[k]) : r.identifiers.find((i) => i.type === k)?.value ?? "")),
        r.errors.map(errorText).join(" | ")]));
    downloadBytes(new TextEncoder().encode(csv), `felrapport-${result!.filename.replace(/\.\w+$/, "")}.csv`, "text/csv");
  }

  const reset = () => { setStep("upload"); setTable(null); setResult(null); setPaste(""); setError(null); };
  const steps: Step[] = ["upload", "map", "preview", "done"];
  const missingRequired = REQUIRED.filter((k) => !(k === "serial" ? mapping.serial || mapping.pin || mapping.vin : mapping[k]));

  return (
    <div className="stack-6">
      <PageHeader title={t("import.title")} lead={has("financier") ? t("import.lead_financier") : t("import.lead")} />
      <ol className="guide-steg" aria-label={t("import.progress")}>
        {steps.map((s, i) => (
          <li key={s} aria-current={step === s ? "step" : undefined} className={steps.indexOf(step) > i ? "is-klar" : undefined}><span>{t(`import.step_${s}`)}</span></li>
        ))}
      </ol>
      {error != null && (error instanceof Error && error.message === "EMPTY" ? <Notice kind="fel" title={t("import.empty_file")} /> : <ErrorNotice error={error} />)}

      {step === "upload" && (
        <section className="panel stack-4">
          <FormField label={t("import.file")} hint={t("import.file_hint")}>
            <input type="file" className="mid-input" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await load(await readTabularFile(f), f.name); } catch (err) { setError(err); }
              }} />
          </FormField>
          <FormField label={t("import.paste")} optional hint={t("import.paste_hint")}>
            <textarea className="mid-textarea is-id" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} spellCheck={false} />
          </FormField>
          <div className="mid-rad">
            <button type="button" className="mid-knapp mid-knapp-primar" disabled={!paste.trim() || busy} onClick={() => void load(parseCsv(paste), "inklistrat.csv")}>
              {t("common.continue")}<Icon name="pil-hoger" /></button>
            <button type="button" className="mid-knapp mid-knapp-kontur"
              onClick={() => downloadBytes(new TextEncoder().encode(templateCsv(targets, label)), "maskinid-importmall.csv", "text/csv")}>
              <Icon name="nedladdning" />{t("import.template")}</button>
          </div>
        </section>
      )}

      {step === "map" && table && (
        <section className="panel stack-4" aria-labelledby="mappning">
          <h2 id="mappning" className="t-rubrik-4">{t("import.map_title", { count: table.rows.length, file: filename })}</h2>
          <p className="t-liten t-sekundar">{mapSource === "ai" ? t("import.map_ai") : t("import.map_heuristic")}</p>
          <div className="rutnat">
            {targets.map((k) => (
              <FormField key={k} className="kol-4" label={label(k)} optional={!REQUIRED.includes(k)}>
                <select className="mid-select" value={mapping[k] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value || null }))}>
                  <option value="">{t("import.not_in_file")}</option>
                  {table.headers.map((h) => <option key={h} value={h}>{h}{table.rows[0]?.[h] ? ` (${table.rows[0][h]!.slice(0, 24)})` : ""}</option>)}
                </select>
              </FormField>
            ))}
          </div>
          {missingRequired.length > 0 && <p className="mid-fel">{t("import.missing_required", { fields: missingRequired.map(label).join(", ") })}</p>}
          <div className="mid-rad mid-rad-mellan">
            <button type="button" className="mid-knapp mid-knapp-kontur" onClick={reset}><Icon name="pil-vanster" />{t("common.back")}</button>
            <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy || missingRequired.length > 0} onClick={() => void validate()}>
              {busy ? t("common.loading") : t("import.validate")}</button>
          </div>
        </section>
      )}

      {step === "preview" && result && (
        <section className="stack-4" aria-labelledby="forhand">
          <h2 id="forhand" className="t-rubrik-4">{t("import.preview_title")}</h2>
          <dl className="nyckeltal">
            <div><dt>{t("import.rows_total")}</dt><dd>{result.rows_total}</dd></div>
            <div><dt>{t("import.rows_ok")}</dt><dd>{result.rows_ok}</dd></div>
            <div><dt>{t("import.rows_error")}</dt><dd>{result.rows_error}</dd></div>
            {result.encumbrance_rows > 0 && <div><dt>{t("import.encumbrances")}</dt><dd>{result.encumbrance_rows}</dd></div>}
          </dl>
          {result.encumbrance_rows > 0 && <Notice kind="info" title={t("import.sign_notice", { count: result.encumbrance_rows })} />}
          <label className="mid-kryss"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />{t("import.only_errors")}</label>
          <RowTable rows={(result.rows ?? []).filter((r) => !onlyErrors || r.errors.length > 0)} errorText={errorText} />
          <div className="mid-rad mid-rad-mellan">
            <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setStep("map")}><Icon name="pil-vanster" />{t("import.change_mapping")}</button>
            <span className="mid-rad">
              {result.rows_error > 0 && <button type="button" className="mid-knapp mid-knapp-kontur" onClick={errorReport}><Icon name="nedladdning" />{t("import.error_report")}</button>}
              <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy || result.rows_ok === 0} onClick={() => void commit()}>
                {busy ? t("common.loading") : result.rows_error > 0 ? t("import.commit_valid", { count: result.rows_ok }) : t("import.commit", { count: result.rows_ok })}
              </button>
            </span>
          </div>
        </section>
      )}

      {step === "done" && result && (
        <section className="panel stack-4" aria-labelledby="klart">
          <h2 id="klart" className="t-rubrik-3">{t("import.done_title", { count: result.rows_committed })}</h2>
          {result.rows_error > 0 && <p className="t-brodtext">{t("import.done_errors", { count: result.rows_error })}</p>}
          <div className="mid-rad">
            <Link className="mid-knapp mid-knapp-primar" to={path("machines")}>{t("import.to_machines")}</Link>
            {result.rows_error > 0 && <button type="button" className="mid-knapp mid-knapp-kontur" onClick={errorReport}><Icon name="nedladdning" />{t("import.error_report")}</button>}
            <Link className="mid-knapp mid-knapp-kontur" to={path("labels")}>{t("import.order_labels")}</Link>
            <button type="button" className="mid-knapp mid-knapp-text" onClick={reset}>{t("import.new_import")}</button>
          </div>
          <RowTable rows={(result.rows ?? []).filter((r) => r.status === "committed").slice(0, 200)} errorText={errorText} />
        </section>
      )}

      <section className="stack-3" aria-labelledby="tidigare">
        <h2 id="tidigare" className="t-rubrik-4">{t("import.history")}</h2>
        {history.isLoading ? <Skeleton /> : (history.data ?? []).length === 0 ? <p className="t-liten t-sekundar">{t("import.no_history")}</p> : (
          <DataTable caption={t("import.history")} rows={history.data!} getKey={(i) => i.id} exportName="importer"
            columns={[
              { id: "file", header: t("import.file"), value: (i) => i.filename, cell: (i) => i.filename },
              { id: "at", header: t("common.date"), value: (i) => i.created_at, cell: (i) => formatDateTime(i.committed_at ?? i.created_at), sortable: true },
              { id: "status", header: t("common.status"), value: (i) => i.status, cell: (i) => t(`import.status.${i.status}`) },
              { id: "n", header: t("import.rows_committed"), value: (i) => i.rows_committed, cell: (i) => `${i.rows_committed} / ${i.rows_total}` },
            ]} />
        )}
      </section>
    </div>
  );
}

function RowTable({ rows, errorText }: { rows: ImportRow[]; errorText(e: ImportRow["errors"][number]): string }) {
  const { t } = useTranslation();
  if (rows.length === 0) return <EmptyState icon="lista" title={t("import.no_rows")} />;
  return (
    <div className="mid-tabell-wrap">
      <table className="mid-tabell">
        <caption className="visually-hidden">{t("import.preview_title")}</caption>
        <thead><tr>
          <th scope="col">{t("import.col_row")}</th><th scope="col">{t("import.field.serial")}</th><th scope="col">{t("machines.col_machine")}</th>
          <th scope="col">{t("import.col_result")}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.row_no} className={r.errors.length ? "rad-fel" : undefined}>
              <td className="mid-id">{r.row_no}</td>
              <td className="mid-id">{r.identifiers.map((i) => i.value).join(" · ") || "–"}</td>
              <td>{[r.data.make, r.data.model].filter(Boolean).join(" ") || (r.reg_number ? <RegNumber value={r.reg_number} /> : "–")}
                {r.data.category ? <span className="t-liten t-sekundar"> · {t(`enum.category.${r.data.category}`, { defaultValue: String(r.data.category) })}</span> : null}</td>
              <td>
                {r.errors.length > 0 ? <ul className="felista">{r.errors.map((e, i) => <li key={i}>{errorText(e)}</li>)}</ul>
                  : r.status === "committed" && r.reg_number ? <RegNumber value={r.reg_number} />
                  : r.action === "encumber_existing" ? t("import.action_encumber", { reg: r.reg_number ?? "" }) : t("import.action_create")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
