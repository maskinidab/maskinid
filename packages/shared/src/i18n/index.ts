import en from "./en.json" with { type: "json" };
import sv from "./sv.json" with { type: "json" };

export const LOCALES = ["sv", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const resources = { sv: { translation: sv }, en: { translation: en } } as const;
export { en, sv };

/** Flattens a nested resource object to "a.b.c" keys (used by tests, e-mail templates and the PDF generator). */
export function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

/** Minimal translator for non-React code (Edge Functions, PDFs): t("errors.FORBIDDEN", { holder: "X" }). */
export function translator(locale: Locale) {
  const dict = flatten((locale === "en" ? en : sv) as Record<string, unknown>);
  const fallback = flatten(sv as Record<string, unknown>);
  return (key: string, vars: Record<string, unknown> = {}): string => {
    // i18next-style plurals: key_one / key_other chosen by vars.count.
    const plural = typeof vars.count === "number" ? `${key}_${vars.count === 1 ? "one" : "other"}` : null;
    const s = (plural && (dict[plural] ?? fallback[plural])) ?? dict[key] ?? fallback[key] ?? key;
    return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
      const v = path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), vars);
      return v === undefined || v === null ? "" : String(v);
    });
  };
}
