import { Link, useRouterState } from "@tanstack/react-router";
import { useI18n, type Lang } from "@/lib/i18n";
import { cx } from "@/components/ui";
import type { ReactNode } from "react";

export function NestMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M8 40c6-16 14-24 24-24s18 8 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 36c4-10 9-15 18-15s14 5 18 15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 42c8 4 14 6 22 6s14-2 22-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="32" cy="30" rx="5" ry="7" fill="#e8eefb" />
      <circle cx="46" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M46 12.5v7M42.5 16h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Shell({ children, paper = false }: { children: ReactNode; paper?: boolean }) {
  const { t, lang, setLang, bundle } = useI18n();
  const brand = lang === "en" ? bundle.brand.en : bundle.brand.ar;
  return (
    <div className={paper ? "min-h-screen bg-ivory text-ink" : "nest game-shell min-h-screen"}>
      <SiteHeader brand={brand} lang={lang} setLang={setLang} t={t} paper={paper} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <PageBack />
        {children}
      </div>
      {paper ? null : (
        <footer className="mt-10 border-t border-white/10">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-3">
            <div>
              <p className="text-lg font-extrabold text-neon">{brand}</p>
              <p className="mt-1 text-sm text-muted">العب، نافس، وابتكر. ألعاب مجانية بالكامل.</p>
            </div>
            <nav className="text-sm text-ivory/70">
              <Link to="/questions" className="block py-1 hover:text-neon">بنك الأسئلة</Link>
              <Link to="/rank" className="block py-1 hover:text-neon">{t("nav.rank")}</Link>
            </nav>
            <p className="text-sm text-muted">الحالة: متصل بالخادم عند فتح غرفة.</p>
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
      <button
        type="button"
        className="min-h-10 rounded-full border border-white/10 px-4 text-sm font-bold text-muted transition hover:border-neon/50 hover:text-ivory"
        onClick={() => window.history.back()}
      >
        رجوع
      </button>
      <Link
        to="/"
        className="inline-flex min-h-10 items-center rounded-full border border-neon/50 px-4 text-sm font-bold text-neon transition hover:bg-neon/10"
      >
        الرئيسية
      </Link>
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
  const navLink = "shrink-0 rounded-full border border-white/10 px-3 py-2 text-sm font-bold text-ivory/80 transition hover:border-neon/50 hover:text-ivory";
  return (
    <header className={cx("sticky top-0 z-20 border-b backdrop-blur-xl", paper ? "border-ink/10 bg-ivory/90" : "border-white/10 bg-night/80")}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link to="/" className={cx("flex items-center gap-2 text-lg font-extrabold", paper ? "text-ink" : "text-ivory")}>
          <span className="grid size-11 place-items-center rounded-2xl bg-neon text-night shadow-[0_0_22px_rgb(6_182_212/0.45)]">
            <NestMark className="size-8" />
          </span>
          <span>
            {brand}
            <span className="mt-0.5 block text-[10px] font-bold tracking-wide text-neon">حيث تلتقي التحديات بالمتعة الجماعية</span>
          </span>
        </Link>
        <button
          type="button"
          className="ms-auto min-h-10 rounded-full border border-white/15 px-3 text-sm font-bold text-ivory transition hover:border-neon/50"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
        >
          {lang === "ar" ? "EN" : "ع"}
        </button>
      </div>
      <nav className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 pb-3" aria-label="Main">
        <Link to="/" className={navLink}>{t("nav.home")}</Link>
        <Link to="/settings" className={navLink}>{t("nav.settings")}</Link>
      </nav>
    </header>
  );
}
