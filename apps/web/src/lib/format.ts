/**
 * Formats following the graphic profile's tone (Swedish): "26 sep 2026" in running text, "2026-09-26" in tables,
 * "kl. 14.05". English: "26 Sep 2026", "14:05". Registration numbers: XXX-XXXX in monospace (RegNumber component).
 */
import { formatRegNumber } from "@maskinid/shared/regnr.ts";
import { currentLocale } from "../i18n";

const MONTHS = {
  sv: ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const NBSP = " ";
const TZ = "Europe/Stockholm";

function parts(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : iso;
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: p.year, month: Number(p.month), day: Number(p.day), hour: p.hour === "24" ? "00" : p.hour, minute: p.minute };
}

/** "26 sep 2026" */
export function formatDate(iso: string | Date | null | undefined, locale = currentLocale()): string {
  if (!iso) return "";
  const p = parts(iso);
  return `${p.day}${NBSP}${MONTHS[locale][p.month - 1]}${NBSP}${p.year}`;
}

/** "2027-09" – "Besiktigad t.o.m. YYYY-MM" (SPEC §7.1). */
export function formatMonth(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const p = parts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** "september 2026" – headings. */
export function formatMonthName(iso: string | Date | null | undefined, locale = currentLocale()): string {
  if (!iso) return "";
  const p = parts(iso);
  const names = locale === "en"
    ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    : ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
  return `${names[p.month - 1]} ${p.year}`;
}

/** "2026-09-26" – tables and forms. */
export function formatDateIso(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const p = parts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "kl. 14.05" / "14:05" */
export function formatTime(iso: string | Date, locale = currentLocale()): string {
  const p = parts(iso);
  return locale === "sv" ? `kl.${NBSP}${p.hour}.${p.minute}` : `${p.hour}:${p.minute}`;
}

export function formatDateTime(iso: string | Date | null | undefined, locale = currentLocale()): string {
  if (!iso) return "";
  return `${formatDate(iso, locale)} ${formatTime(iso, locale)}`;
}

/** "2 450" with a non-breaking thin grouping. */
export function formatNumber(n: number | null | undefined, locale = currentLocale()): string {
  if (n === null || n === undefined) return "";
  return new Intl.NumberFormat(locale === "sv" ? "sv-SE" : "en-GB").format(n);
}

/** Prices for our own services (never register amounts): "1 250 kr". */
export function formatSek(amount: number, locale = currentLocale()): string {
  return `${formatNumber(Math.round(amount), locale)}${NBSP}kr`;
}

export const formatReg = (reg: string | null | undefined) => (reg ? formatRegNumber(reg) : "");

/** Today as YYYY-MM-DD in Swedish time. */
export function todayIso(): string {
  return formatDateIso(new Date());
}

export function daysFromNow(days: number): string {
  return formatDateIso(new Date(Date.now() + days * 86_400_000));
}
