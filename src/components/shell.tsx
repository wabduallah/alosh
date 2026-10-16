import { Link, useRouterState } from "@tanstack/react-router";
import { AnnouncementBar } from "@/components/announcement";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n, type Lang } from "@/lib/i18n";
import { buttonBase, buttonTone, cx } from "@/components/ui";
import { Glyph, Lockup } from "@/components/brand";
import { infoLinks, useSiteSettings } from "@/lib/site-settings";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Page frame.
 *  - default: header (pill nav on computers, compact bar + menu on phones), content, footer,
 *    and a bottom tab bar on phones and tablets.
 *  - play: the game owns the screen (player pad, host console): a compact bar with back and home, no tab bar.
 *  - paper: light surface for printable pages.
 *  - wide: a wider column on TV-size screens (from 1600px), for pages shown on the big screen.
 */
export function Shell({ children, paper = false, play = false, wide = false }: { children: ReactNode; paper?: boolean; play?: boolean; wide?: boolean }) {
  const { t, lang, setLang, bundle } = useI18n();
  const brand = lang === "en" ? bundle.brand.en : bundle.brand.ar;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={cx(paper ? "min-h-screen bg-ivory text-ink" : "nest game-shell min-h-screen", !paper && !play && "pb-tabbar lg:pb-0")}>
      {play ? <PlayBar /> : <SiteHeader t={t} lang={lang} setLang={setLang} paper={paper} onMenu={() => setMenuOpen(true)} />}
      <div className={cx("mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8", play ? "pt-4 pb-[max(24px,env(safe-area-inset-bottom))]" : "py-5 lg:py-6", (play || wide) && "tv:max-w-[1520px]")}>
        {play || paper ? null : <AnnouncementBar />}
        {play ? null : <PageBack />}
        {children}
      </div>
      {paper ? null : <SiteFooter brand={brand} t={t} />}
      {paper || play ? null : <TabBar t={t} />}
      {menuOpen ? <MenuSheet t={t} lang={lang} setLang={setLang} onClose={() => setMenuOpen(false)} /> : null}
    </div>
  );
}

function usePath() {
  return useRouterState({ select: (state) => state.location.pathname });
}

const backClass = "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong/70 bg-deep-2/50 px-4 text-[15px] font-semibold text-mist transition hover:border-glow hover:text-ivory";
const homeClass = "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-gold/60 px-4 text-[15px] font-semibold text-gold transition hover:bg-gold/10";

/** Back and home, on every page but the homepage. */
function PageBack() {
  const path = usePath();
  if (path === "/") return null;
  return (
    <div className="mb-4 flex gap-2">
      <button type="button" className={backClass} onClick={() => window.history.back()}>
        <Glyph name="back" className="size-[18px]" />
        رجوع
      </button>
      <Link to="/" className={homeClass}>
        <Glyph name="home" className="size-[18px]" />
        الرئيسية
      </Link>
    </div>
  );
}

type RoutePath = "/" | "/games" | "/join" | "/settings";
/** Main links. The question bank and the leaderboard stay reachable by URL but leave the menus until they have content. */
const NAV: Array<{ to: RoutePath; key: string; icon: string }> = [
  { to: "/", key: "nav.home", icon: "home" },
  { to: "/games", key: "nav.games", icon: "gamepad" },
  { to: "/join", key: "nav.joinTab", icon: "phone" },
  { to: "/settings", key: "nav.settings", icon: "gear" },
];

/** A tab is active on its own page and, for the games tab, on every game page. */
const isActive = (to: RoutePath, path: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));

function NavLink({ item, active, className, children }: { item: (typeof NAV)[number]; active: boolean; className?: string; children: ReactNode }) {
  return (
    <Link to={item.to} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

function LangToggle({ lang, setLang, className }: { lang: Lang; setLang: (lang: Lang) => void; className?: string }) {
  return (
    <button
      type="button"
      className={cx("min-h-11 min-w-11 place-items-center rounded-full border border-line-strong/70 px-3 text-sm font-semibold text-ivory transition hover:border-gold", className)}
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
    >
      {lang === "ar" ? "EN" : "ع"}
    </button>
  );
}

function SiteHeader({ t, lang, setLang, paper = false, onMenu }: { t: T; lang: Lang; setLang: (lang: Lang) => void; paper?: boolean; onMenu: () => void }) {
  const path = usePath();
  return (
    <header className="sticky top-0 z-30 px-3 pt-[max(10px,env(safe-area-inset-top))] pb-2 sm:px-6 lg:px-8">
      <div
        className={cx(
          "mx-auto flex min-h-16 max-w-[1240px] items-center gap-3 rounded-[20px] px-3 py-2 backdrop-blur-xl lg:min-h-[72px] lg:px-5",
          paper ? "border border-ink/10 bg-ivory/90" : "surface",
        )}
      >
        <Link to="/" aria-label="العش — الرئيسية" className="inline-flex">
          <Lockup height={44} tone={paper ? "light" : "color"} className="lg:h-[50px]!" />
        </Link>

        <nav aria-label="Main" className="mx-auto hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = isActive(item.to, path);
            return (
              <NavLink
                key={item.to}
                item={item}
                active={active}
                className={cx(
                  "relative inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold transition",
                  active ? "text-gold" : "text-mist hover:text-ivory",
                )}
              >
                <Glyph name={item.icon} className="size-[18px]" />
                {t(item.key)}
                {active ? <span aria-hidden="true" className="absolute inset-x-3 -bottom-0.5 h-[3px] rounded-full bg-gold shadow-[0_0_10px_#ffa53a]" /> : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <LangToggle lang={lang} setLang={setLang} className="hidden lg:grid" />
          <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-11 px-4 lg:px-5")}>
            <Glyph name="users" className="size-[18px]" />
            {t("nav.play")}
          </Link>
          <button
            type="button"
            onClick={onMenu}
            aria-label="القائمة"
            className="grid size-12 place-items-center rounded-2xl text-ivory transition hover:bg-glass-strong lg:hidden"
          >
            <Glyph name="menu" className="size-7" />
          </button>
        </div>
      </div>
    </header>
  );
}

/** Phone and tablet menu: every link, joining with a code, and the language. */
function MenuSheet({ t, lang, setLang, onClose }: { t: T; lang: Lang; setLang: (lang: Lang) => void; onClose: () => void }) {
  const path = usePath();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const row = "flex min-h-12 items-center gap-3 rounded-[14px] px-3 text-base font-semibold transition hover:bg-glass-strong";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/75 lg:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="القائمة"
        onClick={(e) => e.stopPropagation()}
        className="surface sheet-up w-full max-w-xl rounded-t-[28px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div aria-hidden="true" className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-line-strong" />
        <nav aria-label="Main" className="grid gap-1" onClick={onClose}>
          {NAV.map((item) => {
            const active = isActive(item.to, path);
            return (
              <NavLink key={item.to} item={item} active={active} className={cx(row, active ? "text-gold" : "text-ivory")}>
                <Glyph name={item.icon} className="size-5" />
                {t(item.key)}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-4">
          <LangToggle lang={lang} setLang={setLang} className="grid" />
          <Link to="/play" search={{ game: "" }} onClick={onClose} className={cx(buttonBase, buttonTone("primary"), "ms-auto")}>
            <Glyph name="users" className="size-[18px]" />
            {t("nav.play")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Bottom tab bar on phones and tablets, within thumb reach and clear of the iPhone home bar. */
function TabBar({ t }: { t: T }) {
  const path = usePath();
  return (
    <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden">
      <div className="surface mx-auto flex max-w-xl items-stretch gap-1 rounded-[22px] p-1.5 backdrop-blur-xl">
        {NAV.map((item) => {
          const active = isActive(item.to, path);
          return (
            <NavLink
              key={item.to}
              item={item}
              active={active}
              className={cx(
                "relative grid min-h-14 flex-1 place-items-center content-center gap-1 rounded-2xl text-[11px] font-semibold transition",
                active ? "bg-gold/12 text-gold" : "text-mist",
              )}
            >
              <Glyph name={item.icon} className="size-6" />
              {t(item.key)}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

/** Compact bar for the game screens: the logo, back and home, so the game owns the screen. */
function PlayBar() {
  return (
    <header className="border-b border-line bg-night/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 max-w-[1240px] items-center gap-2 px-4 sm:px-6 lg:px-8 tv:max-w-[1520px]">
        <Link to="/" aria-label="العش — الرئيسية" className="me-auto inline-flex">
          <Lockup height={38} className="tv:h-[48px]!" />
        </Link>
        <button type="button" className={cx(backClass, "min-h-10 px-3")} onClick={() => window.history.back()}>
          <Glyph name="back" className="size-[18px]" />
          رجوع
        </button>
        <Link to="/" className={cx(homeClass, "min-h-10 px-3")}>
          <Glyph name="home" className="size-[18px]" />
          الرئيسية
        </Link>
      </div>
    </header>
  );
}

function SiteFooter({ brand, t }: { brand: string; t: T }) {
  const link = "inline-flex min-h-11 items-center text-[15px] text-mist transition hover:text-gold";
  const settings = useSiteSettings();
  const social = infoLinks(settings?.info);
  const motto = settings?.home?.footer_text?.trim() || "حيث تلتقي التحديات بالمتعة الجماعية";
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-[1240px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr] lg:items-center lg:px-8">
        <div className="space-y-3">
          <Lockup height={52} />
          <p className="sr-only">{brand}</p>
          <p className="max-w-xs text-[14px] leading-[24px] text-mist">العب، نافس، وابتكر. ألعاب مجانية بالكامل.</p>
        </div>
        <nav aria-label="روابط" className="flex flex-wrap gap-x-6 lg:col-span-2 lg:justify-end">
          <Link to="/games" className={link}>
            {t("nav.games")}
          </Link>
          <Link to="/join" className={link}>
            {t("nav.join")}
          </Link>
          <Link to="/play" search={{ game: "" }} className={link}>
            {t("nav.play")}
          </Link>
          <Link to="/settings" className={link}>
            {t("nav.settings")}
          </Link>
          <Link to="/faq" className={link}>
            الأسئلة الشائعة
          </Link>
          <Link to="/privacy" className={link}>
            الخصوصية
          </Link>
          <Link to="/copyright" className={link}>
            حقوق الملكية
          </Link>
        </nav>
        {social.length ? (
          <ul aria-label="تواصل معنا" className="flex flex-wrap gap-2 lg:col-span-3 lg:justify-end">
            {social.map((s) => (
              <li key={s.key}>
                <a
                  href={s.href}
                  {...(s.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line-strong/70 px-3.5 text-[14px] text-mist transition hover:border-gold/60 hover:text-gold"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-4 text-center font-display text-[15px] font-bold text-ivory">
        {motto}
        <Glyph name="heart" className="size-4 text-gold" />
      </p>
    </footer>
  );
}
