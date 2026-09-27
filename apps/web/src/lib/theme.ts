import { useCallback, useEffect, useState } from "react";

/** Temana i tokens.json: "ljust" och "morkt". "auto" följer operativsystemet. */
export type Theme = "auto" | "ljust" | "morkt";
const KEY = "maskinid.tema";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "ljust" || v === "morkt" ? v : "auto";
  } catch {
    return "auto";
  }
}

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* ignoreras */
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const isDark = theme === "morkt" || (theme === "auto" && sysDark);
  const toggle = useCallback(() => setTheme(isDark ? "ljust" : "morkt"), [isDark]);
  return { theme, isDark, toggle };
}
