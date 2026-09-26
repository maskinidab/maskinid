import { resources, type Locale } from "@maskinid/shared/i18n/index.ts";
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

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: "sv",
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    /* ignore */
  }
});
if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export default i18n;
export const currentLocale = (): Locale => (i18n.language === "en" ? "en" : "sv");
