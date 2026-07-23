"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "pprl-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled -- the toggle still works for
      // this page load, it just won't be remembered on the next visit.
    }
  }

  // The inline script in <head> already set the real theme on <html>
  // before paint; this only covers the one tick before React hydrates,
  // so the icon doesn't flash the wrong state.
  if (theme === null) {
    return <button className="button theme-toggle" type="button" aria-label="Toggle color theme" disabled />;
  }

  return (
    <button
      className="button theme-toggle"
      onClick={toggle}
      type="button"
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="theme-toggle-icons">
        <Sun size={16} className="theme-toggle-icon" data-active={theme === "light"} />
        <Moon size={16} className="theme-toggle-icon" data-active={theme === "dark"} />
      </span>
    </button>
  );
}
