import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";

export interface Column<T> {
  id: string;
  header: string;
  cell(row: T): ReactNode;
  /** Plain value for search, sort and CSV export. */
  value?(row: T): string | number | null | undefined;
  sortable?: boolean;
  hideOnMobile?: boolean;
}

/**
 * Lists: search + filter + export on every list (SPEC §10). Table on desktop, cards on mobile (`card` render prop).
 */
export function DataTable<T>({ rows, columns, getKey, card, filters, exportName, empty, searchPlaceholder, caption }: {
  rows: T[];
  columns: Column<T>[];
  getKey(row: T): string;
  card?(row: T): ReactNode;
  filters?: { id: string; label: string; options: { value: string; label: string }[]; match(row: T, value: string): boolean }[];
  exportName?: string;
  empty?: ReactNode;
  searchPlaceholder?: string;
  caption: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = rows.filter((row) => {
      for (const f of filters ?? []) {
        const v = active[f.id];
        if (v && !f.match(row, v)) return false;
      }
      if (!needle) return true;
      return columns.some((c) => String(c.value?.(row) ?? "").toLowerCase().includes(needle));
    });
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col?.value) r = [...r].sort((a, b) => {
        const va = col.value!(a) ?? "";
        const vb = col.value!(b) ?? "";
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
      });
    }
    return r;
  }, [rows, q, active, sort, columns, filters]);

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cols = columns.filter((c) => c.value);
    const lines = [cols.map((c) => esc(c.header)).join(";"), ...shown.map((r) => cols.map((c) => esc(c.value!(r))).join(";"))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="stack-4">
      <div className="lista-verktyg">
        <label className="lista-sok">
          <span className="visually-hidden">{t("common.search")}</span>
          <Icon name="sok" />
          <input className="mid-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder ?? t("common.search")} />
        </label>
        {filters?.map((f) => (
          <label key={f.id} className="lista-filter">
            <span className="visually-hidden">{f.label}</span>
            <select className="mid-select" value={active[f.id] ?? ""} onChange={(e) => setActive((a) => ({ ...a, [f.id]: e.target.value }))}>
              <option value="">{f.label}: {t("common.all")}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {exportName && (
          <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={exportCsv} disabled={!shown.length}>
            <Icon name="nedladdning" />{t("common.export_csv")}
          </button>
        )}
        <span className="t-liten t-sekundar" aria-live="polite">{t("common.results", { count: shown.length })}</span>
      </div>
      {!shown.length ? (empty ?? <p className="t-sekundar">{t("common.empty")}</p>) : (
        <>
          <div className="mid-tabell-wrap bara-desktop">
            <table className="mid-tabell">
              <caption className="visually-hidden">{caption}</caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.id} scope="col" aria-sort={sort?.id === c.id ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                      {c.sortable && c.value ? (
                        <button type="button" className="mid-lank-knapp" onClick={() => setSort((s) => ({ id: c.id, dir: s?.id === c.id ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                          {c.header}
                        </button>
                      ) : c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => <tr key={getKey(r)}>{columns.map((c) => <td key={c.id}>{c.cell(r)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <ul className="kortlista bara-mobil">
            {shown.map((r) => (
              <li key={getKey(r)}>{card ? card(r) : columns.filter((c) => !c.hideOnMobile).map((c) => <div key={c.id}>{c.cell(r)}</div>)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
