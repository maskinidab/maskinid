import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export interface BarDatum { key: string; label: string; n: number | null }

const fmt = (n: number) => n.toLocaleString("sv-SE");

/** Table view for any chart: the values are never gated behind the graphic. */
function TableView({ caption, rows, head }: { caption: string; rows: [string, string][]; head: [string, string] }) {
  const { t } = useTranslation();
  return (
    <details className="diagram-tabell">
      <summary className="t-liten">{t("charts.show_table")}</summary>
      <table className="mid-tabell">
        <caption className="visually-hidden">{caption}</caption>
        <thead><tr><th scope="col">{head[0]}</th><th scope="col" className="tal">{head[1]}</th></tr></thead>
        <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="tal">{b}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/**
 * Horizontal bars for a magnitude per category (one series: no legend, the heading names it). Value at the bar tip in
 * text ink; hover/focus shows the share. Suppressed cells (fewer than 5) show "<5" without a bar.
 */
export function BarList({ title, data, unit }: { title: string; data: BarDatum[]; unit: string }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.n ?? 0));
  const total = data.reduce((s, d) => s + (d.n ?? 0), 0);
  const id = useId();
  return (
    <figure className="diagram stack-2" aria-labelledby={id}>
      <figcaption id={id} className="t-rubrik-4">{title}</figcaption>
      <ul className="stapellista" role="list">
        {data.map((d) => {
          const tip = d.n === null ? t("charts.suppressed") : t("charts.share", { n: fmt(d.n), unit, pct: Math.round((d.n / Math.max(total, 1)) * 100) });
          return (
            <li key={d.key} className={hover === d.key ? "is-aktiv" : undefined} tabIndex={0} aria-label={`${d.label}: ${d.n === null ? "<5" : fmt(d.n)} ${unit}`}
              onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}>
              <span className="stapel-etikett">{d.label}</span>
              <span className="stapel-spar" aria-hidden="true">
                {d.n !== null && d.n > 0 && <span className="stapel" style={{ width: `${(d.n / max) * 100}%` }} />}
                <span className="stapel-varde">{d.n === null ? "<5" : fmt(d.n)}</span>
              </span>
              {hover === d.key && <span className="diagram-tips" role="tooltip">{tip}</span>}
            </li>
          );
        })}
      </ul>
      <TableView caption={title} head={[t("charts.category"), unit]} rows={data.map((d) => [d.label, d.n === null ? "<5" : fmt(d.n)])} />
    </figure>
  );
}

/**
 * Columns over time (one series). Labels only the latest and the highest column; every value is in the tooltip and the
 * table. One baseline, hairline, columns ≤ 24 px with a rounded top.
 */
export function ColumnChart({ title, data, unit }: { title: string; data: { key: string; label: string; n: number }[]; unit: string }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.n));
  const peak = data.reduce((best, d, i) => (d.n > data[best]!.n ? i : best), 0);
  const id = useId();
  return (
    <figure className="diagram stack-2" aria-labelledby={id}>
      <figcaption id={id} className="t-rubrik-4">{title}</figcaption>
      <div className="stolpar" role="list">
        {data.map((d, i) => (
          <div key={d.key} role="listitem" className={`stolpe-kolumn${hover === i ? " is-aktiv" : ""}`} tabIndex={0} aria-label={`${d.label}: ${fmt(d.n)} ${unit}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
            <div className="stolpe-yta">
              {(i === data.length - 1 || i === peak) && <span className="stolpe-varde" aria-hidden="true">{fmt(d.n)}</span>}
              <div className="stolpe" style={{ height: `${(d.n / max) * 100}%` }} aria-hidden="true" />
            </div>
            <span className="stolpe-etikett" aria-hidden="true">{d.label}</span>
            {hover === i && <span className="diagram-tips" role="tooltip">{d.label}: {fmt(d.n)} {unit}</span>}
          </div>
        ))}
      </div>
      <TableView caption={title} head={[t("charts.month"), unit]} rows={data.map((d) => [d.label, fmt(d.n)])} />
    </figure>
  );
}
