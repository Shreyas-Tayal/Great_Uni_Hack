// Terminal (dark) or paper (light) theme: remembers the choice, defaults to terminal.
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function initial(): Theme {
  try {
    const saved = localStorage.getItem("fs-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage blocked */ }
  return "dark"; // the terminal look is the default; "paper" (light) is one click away
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("fs-theme", theme); } catch { /* storage blocked */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
