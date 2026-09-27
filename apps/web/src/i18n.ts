import sv from "@maskinid/shared/i18n/sv.json" with { type: "json" };
import type { Locale } from "@maskinid/shared/i18n/index.ts";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const KEY = "maskinid.lang";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "sv" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  // Swedish is the default (SPEC §0); English only when chosen.
  return "sv";
}

// Only Swedish is bundled up front. Both dictionaries are ~160 kB each, and shipping the pair put ~300 kB of JSON
// on the critical path of every page, which is most of what the Lighthouse budget was failing on. English is
// fetched the first time someone actually asks for it.
async function ensureLocale(lng: string): Promise<void> {
  if (lng !== "en" || i18n.hasResourceBundle("en", "translation")) return;
  const { default: en } = await import("@maskinid/shared/i18n/en.json", { with: { type: "json" } });
  i18n.addResourceBundle("en", "translation", en);
}

void i18n.use(initReactI18next).init({
  resources: { sv: { translation: sv } },
  lng: "sv",
  fallbackLng: "sv",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Wrap changeLanguage rather than loading at each call site, so no caller can switch to a locale whose dictionary
// has not arrived yet (AuthProvider, the language button and the PDF generator all switch language).
const changeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = (async (lng?: string, ...rest) => {
  if (lng) await ensureLocale(lng);
  return changeLanguage(lng, ...rest);
}) as typeof i18n.changeLanguage;

// The stored preference is applied after init, so a returning English user loads that dictionary on start-up.
if (initialLocale() === "en") void i18n.changeLanguage("en");

i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    /* ignore */
  }
});
if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export default i18n;
export const currentLocale = (): Locale => (i18n.language === "en" ? "en" : "sv");
