import { useEffect } from "react";
import { applyMotion } from "@/lib/prefs";
import { applyTheme, loadSiteSettings, type ThemeSettings } from "@/lib/site-settings";

const THEME_KEY = "al3sh.theme";

/** Applies the visitor's saved preferences once the page is running (motion), and the admin's site colors. */
export function PrefsBoot() {
  useEffect(() => {
    applyMotion();
    // Last-known colors first (no flash on the next visit), then the current ones from the database.
    try {
      const cached = window.localStorage.getItem(THEME_KEY);
      if (cached) applyTheme(JSON.parse(cached) as ThemeSettings);
    } catch {
      // Private mode or bad JSON: the built-in colors stay.
    }
    void loadSiteSettings().then((s) => {
      applyTheme(s.theme);
      try {
        if (s.theme) window.localStorage.setItem(THEME_KEY, JSON.stringify(s.theme));
        else window.localStorage.removeItem(THEME_KEY);
      } catch {
        // ignore
      }
    });
  }, []);
  return null;
}
