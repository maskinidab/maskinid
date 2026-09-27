import { useTranslation } from "react-i18next";
import { BarList, ColumnChart, type BarDatum } from "../../components/charts/Charts";
import { ErrorNotice, PageHeader, Skeleton } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { useRpc } from "../../lib/api/query";
import { formatDateTime } from "../../lib/format";
import { downloadBytes } from "../../lib/pdf/receipt";

type Cell = { key: string | number; n: number | null };
export interface Statistics {
  generated_at: string; suppressed: boolean;
  totals: { machines: number; registered_12m: number; stolen_active: number; recovered_12m: number; labels_bound: number; electric_share: number };
  by_category: Cell[]; by_level: Cell[]; by_emission_stage: Cell[]; by_fuel: Cell[]; by_county: Cell[]; by_age: Cell[];
  registrations_by_month: { month: string; n: number }[];
  environment: { category: string; emission_stage: string; fuel: string; n: number; avg_power_kw: number | null; avg_hours: number | null }[];
  checks_by_month?: { month: string; n: number }[];
  orgs_by_type?: Record<string, number>;
  transfers_12m?: number; encumbrances_active?: number;
}

const MONTHS_SV = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function csv(rows: (string | number | null)[][]): Uint8Array {
  const esc = (v: string | number | null) => (v === null ? "" : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return new TextEncoder().encode("﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n"));
}

/** Statistics body shared by the public page (suppressed) and the operator view (exact numbers + extras). */
export function StatisticsView({ s }: { s: Statistics }) {
  const { t, i18n } = useTranslation();
  const label = (group: string, key: string | number) =>
    key === "unknown" ? t("stats.unknown") : group === "county" ? String(key) : t(`${group}.${key}`);
  const bars = (cells: Cell[], group: string): BarDatum[] => cells.map((c) => ({ key: String(c.key), label: label(group, c.key), n: c.n }));
  const month = (m: string) => `${MONTHS_SV[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
  const unit = t("stats.machines_unit");
  function downloadEnvironment() {
    downloadBytes(csv([[t("stats.col_category"), t("stats.col_stage"), t("stats.col_fuel"), t("stats.col_n"), t("stats.col_power"), t("stats.col_hours")],
      ...s.environment.map((r) => [r.category, r.emission_stage, r.fuel, r.n, r.avg_power_kw, r.avg_hours])]),
    `maskinid-miljostatistik-${s.generated_at.slice(0, 10)}.csv`, "text/csv");
  }
  return (
    <div className="stack-6">
      <dl className="nyckeltal">
        <div><dt>{t("stats.machines")}</dt><dd>{s.totals.machines.toLocaleString("sv-SE")}</dd></div>
        <div><dt>{t("stats.registered_12m")}</dt><dd>{s.totals.registered_12m.toLocaleString("sv-SE")}</dd></div>
        <div><dt>{t("stats.electric_share")}</dt><dd>{(Math.round(s.totals.electric_share * 1000) / 10).toLocaleString(i18n.language === "en" ? "en-GB" : "sv-SE")} %</dd></div>
        <div><dt>{t("stats.stolen_active")}</dt><dd>{s.totals.stolen_active}</dd></div>
        <div><dt>{t("stats.recovered_12m")}</dt><dd>{s.totals.recovered_12m}</dd></div>
        <div><dt>{t("stats.labels_bound")}</dt><dd>{s.totals.labels_bound.toLocaleString("sv-SE")}</dd></div>
      </dl>
      <ColumnChart title={t("stats.registrations_by_month")} unit={unit} data={s.registrations_by_month.map((r) => ({ key: r.month, label: month(r.month), n: r.n }))} />
      <div className="diagram-rutnat">
        <BarList title={t("stats.by_category")} unit={unit} data={bars(s.by_category, "enum.category")} />
        <BarList title={t("stats.by_county")} unit={unit} data={bars(s.by_county, "county")} />
        <BarList title={t("stats.by_emission_stage")} unit={unit} data={bars(s.by_emission_stage, "enum.emission")} />
        <BarList title={t("stats.by_fuel")} unit={unit} data={bars(s.by_fuel, "enum.fuel")} />
        <BarList title={t("stats.by_age")} unit={unit} data={bars(s.by_age, "stats.age")} />
        <BarList title={t("stats.by_level")} unit={unit} data={bars(s.by_level, "stats.level")} />
      </div>
      {s.checks_by_month && (
        <ColumnChart title={t("stats.checks_by_month")} unit={t("stats.checks_unit")} data={s.checks_by_month.map((r) => ({ key: r.month, label: month(r.month), n: r.n }))} />
      )}
      <section className="panel stack-3" aria-labelledby="miljo">
        <h2 id="miljo" className="t-rubrik-4">{t("stats.environment_title")}</h2>
        <p className="t-liten">{t("stats.environment_lead")}</p>
        <div><button type="button" className="mid-knapp mid-knapp-kontur" onClick={downloadEnvironment} disabled={!s.environment.length}>
          <Icon name="nedladdning" />{t("stats.environment_csv", { rows: s.environment.length })}</button></div>
      </section>
      <p className="t-liten t-sekundar">{s.suppressed ? t("stats.suppression_note") : t("stats.exact_note")} {t("stats.generated", { at: formatDateTime(s.generated_at) })}</p>
    </div>
  );
}

/** /statistics – public register statistics (step 24). */
export function StatisticsPage() {
  const { t } = useTranslation();
  const q = useRpc<Statistics>("public_statistics", {});
  return (
    <div className="behallare sektion stack-6">
      <header className="stack-2">
        <h1 className="t-rubrik-1">{t("stats.title")}</h1>
        <p className="t-ingress">{t("stats.lead")}</p>
      </header>
      {q.isLoading ? <Skeleton lines={8} /> : q.error ? <ErrorNotice error={q.error} /> : <StatisticsView s={q.data!} />}
    </div>
  );
}

/** Operator: exact statistics with extra figures. */
export function AdminStatisticsPage() {
  const { t } = useTranslation();
  const q = useRpc<Statistics>("admin_statistics", {});
  return (
    <div className="stack-6">
      <PageHeader title={t("stats.admin_title")} lead={t("stats.admin_lead")} />
      {q.isLoading ? <Skeleton lines={8} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <>
          <dl className="nyckeltal">
            <div><dt>{t("stats.transfers_12m")}</dt><dd>{q.data!.transfers_12m ?? 0}</dd></div>
            <div><dt>{t("stats.encumbrances_active")}</dt><dd>{q.data!.encumbrances_active ?? 0}</dd></div>
            {Object.entries(q.data!.orgs_by_type ?? {}).map(([k, n]) => <div key={k}><dt>{t(`enum.org_type.${k}`)}</dt><dd>{n}</dd></div>)}
          </dl>
          <StatisticsView s={q.data!} />
        </>
      )}
    </div>
  );
}
