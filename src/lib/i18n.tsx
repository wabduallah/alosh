import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import ar from "../translations/ar.json";
import en from "../translations/en.json";

export type Lang = "ar" | "en";

type Dict = Record<string, unknown>;
const tables: Record<Lang, Dict> = { ar, en };

type Bundle = {
  brand: { ar: string; en: string };
  ads: boolean;
  sounds: Record<string, string>;
  plans: {
    id: string;
    nameAr: string;
    nameEn: string;
    priceSar: number;
    interval: string;
    featuresAr: string[];
    featuresEn: string[];
  }[];
};

const emptyBundle: Bundle = {
  brand: { ar: "العش", en: "The Nest" },
  ads: false,
  sounds: {},
  plans: [],
};

type Ctx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  bundle: Bundle;
};

const I18nContext = createContext<Ctx | null>(null);

function lookup(obj: Dict, path: string): string | null {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Dict)) return (acc as Dict)[key];
    return undefined;
  }, obj);
  return typeof value === "string" ? value : null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  // Site config used to come from the old engine's settings table, which no longer exists.
  // The built-in defaults and translation files are the source of truth now.
  const bundle = emptyBundle;

  useEffect(() => {
    const saved = localStorage.getItem("lamma-lang");
    setLangState(saved === "en" ? "en" : "ar");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("lamma-lang", lang);
  }, [lang]);

  const value = useMemo<Ctx>(() => {
    const t = (key: string, vars?: Record<string, string | number>) => {
      let s = lookup(tables[lang], key) || lookup(tables.ar, key) || key;
      if (vars) {
        for (const [name, repl] of Object.entries(vars)) s = s.replaceAll(`{${name}}`, String(repl));
      }
      return s;
    };
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      setLang: setLangState,
      t,
      bundle,
    };
  }, [bundle, lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("i18n");
  return ctx;
}
