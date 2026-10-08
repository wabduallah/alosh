import { Link } from "@tanstack/react-router";
import { useI18n, type Lang } from "@/lib/i18n";
import type { ReactNode } from "react";

export function NestMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M5 21.5c2.2-6 6.2-9.2 11-9.2s8.8 3.2 11 9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7.5 19.2c1.8-4 4.4-6.2 8.5-6.2s6.7 2.2 8.5 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M4 22.2c3.2 1.4 6.6 2.2 12 2.2s8.8-.8 12-2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <ellipse cx="16" cy="16.6" rx="2.7" ry="3.5" fill="#FFF8F0" />
    </svg>
  );
}

export function Shell({ children, paper = false }: { children: ReactNode; paper?: boolean }) {
  const { t, lang, setLang, bundle } = useI18n();
  const brand = lang === "en" ? bundle.brand.en : bundle.brand.ar;
  return (
    <div className={paper ? "min-h-screen bg-sand text-ink" : "nest game-shell min-h-screen"}>
      <SiteHeader brand={brand} lang={lang} setLang={setLang} t={t} paper={paper} />
      {bundle.ads ? (
        <div className="border-b border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-ivory/70">{t("ads")}</div>
      ) : null}
      <div className="mx-auto max-w-6xl px-4 py-8 pb-28 lg:pb-8">{children}</div>
      {paper ? null : <MobileDock />}
      {paper ? null : (
        <footer className="mt-10 border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg font-extrabold text-neon">{brand}</p>
            <p className="text-sm text-ivory/55">{t("footer")}</p>
            <Link to="/admin" className="text-sm text-ivory/45">{t("nav.admin")}</Link>
          </div>
        </footer>
      )}
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
    <header className={`sticky top-0 z-20 border-b backdrop-blur ${paper ? "border-ink/10 bg-ivory/90" : "border-white/10 bg-night/80"}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
        <Link to="/" className={`flex items-center gap-2 text-lg font-extrabold ${paper ? "text-forest" : "text-ivory"}`}>
          <span className="grid size-9 place-items-center rounded-2xl bg-neon text-night shadow-[0_0_18px_color-mix(in_srgb,var(--color-neon)_45%,transparent)]">
            <NestMark className="size-7" />
          </span>
          <span>
            {brand}
            {paper ? null : <span className="ms-2 hidden text-[10px] font-bold tracking-[0.22em] text-neon sm:inline">THE NEST</span>}
          </span>
        </Link>
        <nav className="ms-auto hidden items-center gap-1 text-sm sm:gap-2 lg:flex">
          <Link to="/" className={`min-h-11 items-center px-2 lg:inline-flex ${paper ? "" : "text-ivory/75"}`}>{t("nav.home")}</Link>
          <Link to="/games" search={{ cat: "" }} className={`min-h-11 items-center px-2 lg:inline-flex ${paper ? "" : "text-ivory/75"}`}>{t("nav.games")}</Link>
          <Link to="/questions" className={`min-h-11 items-center px-2 lg:inline-flex ${paper ? "" : "text-ivory/75"}`}>{t("nav.questions")}</Link>
          <Link to="/rank" className={`min-h-11 items-center px-2 lg:inline-flex ${paper ? "" : "text-ivory/75"}`}>{t("nav.rank")}</Link>
          <Link to="/premium" className={`min-h-11 items-center px-2 lg:inline-flex ${paper ? "" : "text-gold"}`}>{t("nav.premium")}</Link>
          <Link to="/join" className={`min-h-11 items-center px-2 lg:inline-flex ${paper ? "" : "text-ivory/75"}`}>{t("nav.join")}</Link>
          <Link to="/play" search={{ game: "" }} className="inline-flex min-h-11 items-center rounded-full bg-neon px-4 font-extrabold text-night">{t("nav.play")}</Link>
          <Link to="/admin" className="inline-flex min-h-11 items-center rounded-full border border-neon/40 px-4 font-extrabold text-neon">لوحة التحكم</Link>
          <button
            type="button"
            className={`min-h-11 rounded-full px-3 font-extrabold ${paper ? "border border-ink/15" : "border border-white/15 text-ivory"}`}
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          >
            {lang === "ar" ? "EN" : "ع"}
          </button>
        </nav>
      </div>
    </header>
  );
}


function MobileDock() {
  const { t } = useI18n();
  return (
    <nav className="dock" aria-label="main">
      <Link to="/admin"><span aria-hidden="true">▦</span><span>الإدارة</span></Link>
      <Link to="/rank"><span aria-hidden="true">🏆</span><span>{t("nav.rank")}</span></Link>
      <Link to="/"><span aria-hidden="true">🏠</span><span>{t("nav.home")}</span></Link>
      <Link to="/questions"><span aria-hidden="true">💬</span><span>{t("nav.questions")}</span></Link>
      <Link to="/games" search={{ cat: "" }}><span aria-hidden="true">🎮</span><span>{t("nav.games")}</span></Link>
    </nav>
  );
}

export function LangTitle({ ar, en }: { ar: string; en: string }) {
  const { lang } = useI18n();
  return <>{lang === "en" ? en : ar}</>;
}