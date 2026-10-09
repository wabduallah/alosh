import { Link, useRouterState } from "@tanstack/react-router";
import { useI18n, type Lang } from "@/lib/i18n";
import type { ReactNode } from "react";

export function NestMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M8 40c6-16 14-24 24-24s18 8 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 36c4-10 9-15 18-15s14 5 18 15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 42c8 4 14 6 22 6s14-2 22-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="32" cy="30" rx="5" ry="7" fill="#FFF6E6" />
      <circle cx="46" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M46 12.5v7M42.5 16h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Shell({ children, paper = false }: { children: ReactNode; paper?: boolean }) {
  const { t, lang, setLang, bundle } = useI18n();
  const brand = lang === "en" ? bundle.brand.en : bundle.brand.ar;
  return (
    <div className={paper ? "min-h-screen bg-sand text-ink" : "nest game-shell min-h-screen"}>
      <SiteHeader brand={brand} lang={lang} setLang={setLang} t={t} paper={paper} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <PageBack />
        {children}
      </div>
      {paper ? null : (
        <footer className="mt-10 border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg font-extrabold text-neon">{brand}</p>
            <p className="text-sm text-ivory/55">ألعاب مجانية بالكامل</p>
          </div>
        </footer>
      )}
    </div>
  );
}

function PageBack() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  if (path === "/") return null;
  return (
    <div className="mb-4 flex gap-2">
      <button type="button" className="min-h-10 rounded-full border border-[#3D352B] px-4 text-sm font-extrabold text-[#A89F91]" onClick={() => window.history.back()}>رجوع</button>
      <Link to="/" className="inline-flex min-h-10 items-center rounded-full border border-[#D4AF37] px-4 text-sm font-extrabold text-[#E5C158]">الرئيسية</Link>
    </div>
  );
}

function SiteHeader({
  brand,
  lang,
  setLang,
  t,
  paper = false,
}: {
  brand: string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  paper?: boolean;
}) {
  return (
    <header className={`sticky top-0 z-20 border-b backdrop-blur ${paper ? "border-ink/10 bg-ivory/90" : "border-white/10 bg-night/85"}`}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link to="/" className={`flex items-center gap-2 text-lg font-extrabold ${paper ? "text-forest" : "text-ivory"}`}>
          <span className="grid size-11 place-items-center rounded-2xl bg-neon text-night shadow-[0_0_22px_color-mix(in_srgb,var(--color-neon)_45%,transparent)]">
            <NestMark className="size-8" />
          </span>
          <span>
            {brand}
            <span className="mt-0.5 block text-[10px] font-bold tracking-wide text-neon">ألعاب مجانية بالكامل</span>
          </span>
        </Link>
        <button
          type="button"
          className="ms-auto min-h-10 rounded-full border border-white/15 px-3 text-sm font-extrabold"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        >
          {lang === "ar" ? "EN" : "ع"}
        </button>
      </div>
      <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3 text-sm">
        <Link to="/" className="shrink-0 rounded-full border border-white/10 px-3 py-2">{t("nav.home")}</Link>
        <Link to="/games" search={{ cat: "" }} className="shrink-0 rounded-full border border-white/10 px-3 py-2">{t("nav.games")}</Link>
        <Link to="/questions" className="shrink-0 rounded-full border border-white/10 px-3 py-2">{t("nav.questions")}</Link>
        <Link to="/rank" className="shrink-0 rounded-full border border-white/10 px-3 py-2">{t("nav.rank")}</Link>
        <Link to="/settings" className="shrink-0 rounded-full border border-white/10 px-3 py-2">{t("nav.settings")}</Link>
        <Link to="/play" search={{ game: "" }} className="shrink-0 rounded-full bg-neon px-3 py-2 font-extrabold text-night">{t("nav.play")}</Link>
      </nav>
    </header>
  );
}
