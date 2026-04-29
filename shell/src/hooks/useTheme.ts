import { useEffect, useState } from "react";
import type { AppTheme } from "../types";

const STORAGE_KEY = "commandops_theme";

function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<AppTheme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as AppTheme | null;
    return stored ?? "dark";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return { theme, toggle };
}
