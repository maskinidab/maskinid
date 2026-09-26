/**
 * Reading and writing tabular files for import/export (SPEC §6.5): CSV with ; , or tab (auto-detected, quotes per
 * RFC 4180, UTF-8 with or without BOM), pasted text, and XLSX (first sheet).
 */
export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

export function detectDelimiter(line: string): string {
  const counts = [";", ",", "\t"].map((d) => [d, line.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ";";
}

/** Parses CSV text into rows of cells. */
export function parseCsvCells(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? detectDelimiter(firstLine);
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}

/** First non-empty row is the header; duplicate/empty headers get a suffix so every column stays addressable. */
export function cellsToTable(cells: string[][]): Table {
  const [head = [], ...body] = cells;
  const seen = new Map<string, number>();
  const headers = head.map((h, i) => {
    const base = String(h ?? "").trim() || `Kolumn ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
  return { headers, rows };
}

export function parseCsv(text: string): Table {
  return cellsToTable(parseCsvCells(text));
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function readTabularFile(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const { readSheet } = await import("read-excel-file/browser");
    const data = await readSheet(file);
    return cellsToTable(data.map((r) => r.map(cellToString)));
  }
  return parseCsv(await file.text());
}

/** CSV for download: semicolon (Swedish Excel), quotes where needed, BOM so Excel reads UTF-8. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(q).join(";")).join("\r\n") + "\r\n";
}
