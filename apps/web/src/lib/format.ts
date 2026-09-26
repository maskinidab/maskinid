/**
 * Format enligt den grafiska profilens tonalitet:
 * - datum "26 sep 2026" i löptext och "2026-09-26" i tabeller
 * - tid "kl. 14.05"
 * - belopp "1 250 000 kr" med hårt mellanslag
 */

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const NBSP = " ";
const TZ = "Europe/Stockholm";

function parts(iso: string) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: p.year,
    month: Number(p.month),
    day: Number(p.day),
    hour: p.hour === "24" ? "00" : p.hour,
    minute: p.minute,
  };
}

/** "26 sep 2026" */
export function formatDate(iso: string): string {
  const p = parts(iso);
  return `${p.day}${NBSP}${MONTHS[p.month - 1]}${NBSP}${p.year}`;
}

/** "2026-09-26" – för tabeller. */
export function formatDateIso(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "kl. 14.05" */
export function formatTime(iso: string): string {
  const p = parts(iso);
  return `kl.${NBSP}${p.hour}.${p.minute}`;
}

/** "26 sep 2026 kl. 14.05" */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/** "1 250 000 kr" */
export function formatSek(amount: number): string {
  const digits = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${digits}${NBSP}kr`;
}
