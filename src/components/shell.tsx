import { Link, useRouterState } from "@tanstack/react-router";
import { useI18n, type Lang } from "@/lib/i18n";
import { cx } from "@/components/ui";
import { Glyph, Lockup, Mark } from "@/components/brand";
import { ShareSite } from "@/components/share";
import type { ReactNode } from "react";

/**
 * Page frame.
 *  - default: slim sticky header, content, footer.
 *  - play: the game owns the screen (player pad, host console): a compact bar, no footer.
 *  - paper: light surface for printable pages.
 */
export function Shell({ children, paper = false, play = false }: { children: ReactNode; paper?: boolean; play?: boolean }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={paper ? "min-h-screen bg-ivory text-ink" : "nest game-shell min-h-screen"}>
      {play ? <PlayBar /> : <SiteHeader lang={lang} setLang={setLang} paper={paper} />}
      <div className={cx("mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8", play ? "pt-4 pb-[max(24px,env(safe-area-inset-bottom))]" : "py-6")}>
        {play ? null : <PageBack />}
        {children}
      </div>
      {paper || play ? null : <SiteFooter />}
    </div>
  );
}

function PageBack() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  if (path === "/") return null;
  return (
    <button
      type="button"
      className="mb-2 inline-flex min-h-11 items-center gap-1.5 px-1.5 text-[15px] font-semibold text-mist transition hover:text-ivory"
      onClick={() => window.history.back()}
    >
      <Glyph name="back" />
      رجوع
    </button>
  );
}

function SiteHeader({ lang, setLang, paper = false }: { lang: Lang; setLang: (lang: Lang) => void; paper?: boolean }) {
  const navLink = "rounded-full px-3.5 py-2.5 text-[15px] font-semibold text-mist transition hover:bg-glass hover:text-ivory";
  return (
    <header
      className={cx(
        "sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)] backdrop-blur-xl",
        paper ? "border-ink/10 bg-ivory/90" : "border-line bg-night/85",
      )}
    >
      <div className="mx-auto flex min-h-16 max-w-[1200px] items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <Link to="/" aria-label="العش — الرئيسية" className="inline-flex">
          <Lockup height={34} tone={paper ? "light" : "color"} />
        </Link>
        <nav aria-label="الرئيسية" className="ms-6 hidden items-center gap-1 lg:flex">
          <a href="/#games" className={navLink}>
            الألعاب
          </a>
          <a href="/#how" className={navLink}>
            كيف تبدأ
          </a>
          <Link to="/settings" className={navLink}>
            الإعدادات
          </Link>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <Link
            to="/join"
            className="hidden min-h-11 items-center rounded-full border border-line-strong px-4 text-[15px] font-semibold text-ivory transition hover:border-neon hover:text-neon lg:inline-flex"
          >
            انضم برمز
          </Link>
          <button
            type="button"
            className="grid min-h-11 min-w-11 place-items-center rounded-full border border-line-strong px-3 text-sm font-semibold text-ivory transition hover:border-neon"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
          >
            {lang === "ar" ? "EN" : "ع"}
          </button>
        </div>
      </div>
    </header>
  );
}

/** Compact bar for the game screens: the mark only, so the game owns the screen. */
function PlayBar() {
  return (
    <header className="border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex min-h-14 max-w-[1200px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="العش — الرئيسية" className="inline-flex">
          <Mark height={28} />
        </Link>
      </div>
    </header>
  );
}

function SiteFooter() {
  const link = "inline-flex min-h-11 items-center text-[15px] text-mist transition hover:text-neon";
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.4fr_1fr_auto] lg:px-8">
        <div className="space-y-3">
          <Lockup height={30} />
          <p className="max-w-xs text-[13px] leading-[22px] text-mist">ألعاب جماعية تُلعب على شاشة واحدة وجوال لكل لاعب. مجانية بالكامل.</p>
        </div>
        <nav aria-label="روابط" className="flex flex-wrap gap-x-5">
          <a href="/#games" className={link}>
            الألعاب
          </a>
          <a href="/#how" className={link}>
            كيف تبدأ
          </a>
          <Link to="/settings" className={link}>
            الإعدادات
          </Link>
        </nav>
        <div>
          <ShareSite />
        </div>
      </div>
    </footer>
  );
}
