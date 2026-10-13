import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { GameArt, GameIcon, Glyph, gameStyle, gameVars } from "@/components/brand";
import { FILTERS, useGames, type Category, type GameEntry } from "@/lib/catalog";

/**
 * The games section shared by the home page and /games: playable games as cards,
 * the «قريبًا» ones as a short row of chips, a category filter, and the rules sheet.
 */
export function GamesGrid({ titleAs = "h2" }: { titleAs?: "h1" | "h2" }) {
  const games = useGames();
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [sheetGame, setSheetGame] = useState<GameEntry | null>(null);
  const inFilter = (g: GameEntry) => filter === "all" || g.category === filter;
  const live = games.filter((g) => !g.soon);
  const soon = games.filter((g) => g.soon);
  const shownLive = live.filter(inFilter);
  const shownSoon = soon.filter(inFilter);
  const Title = titleAs;

  return (
    <section id="games" aria-labelledby="games-title" className="scroll-mt-28">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Title id="games-title" className="flex items-center gap-2 text-[22px] leading-8 lg:text-[28px] lg:leading-10">
          <Glyph name="gamepad" className="size-7 text-gold" />
          الألعاب
        </Title>
        <p className="text-[15px] text-mist">
          {live.length} متاحة الآن{soon.length ? ` · ${soon.length} قريبًا` : ""}
        </p>
      </div>

      <div role="group" aria-label="تصفية الألعاب" className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.key)}
              className={cx(
                "min-h-11 shrink-0 rounded-full border px-5 text-[15px] font-semibold transition",
                active ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:border-glow hover:text-ivory",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {shownLive.map((game, i) => (
          <GameTile key={game.id} game={game} index={i} onHowTo={() => setSheetGame(game)} />
        ))}
      </div>
      {shownLive.length === 0 ? <p className="mt-2 text-[15px] text-mist">لا توجد ألعاب متاحة في هذا التصنيف بعد.</p> : null}

      {shownSoon.length ? (
        <div className="mt-6">
          <h3 className="mb-3 text-[17px] text-mist">قريبًا</h3>
          <ul className="flex flex-wrap gap-2">
            {shownSoon.map((game) => (
              <li key={game.id}>
                <Link
                  to="/games/$slug"
                  params={{ slug: game.id }}
                  className="inline-flex min-h-12 items-center gap-2.5 rounded-full border border-line-strong/70 bg-deep-2/50 py-1.5 ps-1.5 pe-4 text-[15px] font-semibold text-mist transition hover:border-glow hover:text-ivory"
                >
                  <GameIcon id={game.id} icon={game.icon} size="sm" soon className="size-9! rounded-full!" />
                  {game.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <HowToSheet game={sheetGame} onClose={() => setSheetGame(null)} />
    </section>
  );
}

/** A playable game in its own colours: icon, name (links to its page), players, blurb, then the two actions. */
function GameTile({ game, index, onHowTo }: { game: GameEntry; index: number; onHowTo: () => void }) {
  const dark = gameStyle(game.id).ink === "dark";
  const ink = dark ? "text-on-gold" : "text-ivory";
  const soft = dark ? "text-on-gold/80" : "text-ivory/80";
  return (
    <article
      style={{ ...gameVars(game.id), animationDelay: `${index * 50}ms` }}
      className="gcard rise relative flex flex-col gap-2.5 overflow-hidden rounded-[22px] p-3.5 sm:gap-3 sm:rounded-[24px] sm:p-5"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -top-10 -end-10 size-36 rounded-full bg-white/10 blur-2xl" />
      <div className="flex items-center gap-3">
        <span className="gcard-icon grid size-14 shrink-0 place-items-center rounded-full sm:size-[72px]">
          <GameArt id={game.id} icon={game.icon} className="size-12 text-[22px] sm:size-16 sm:text-[28px]" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h3 className={cx("text-[19px] leading-7 sm:text-[21px] sm:leading-8", ink)}>
            <Link to="/games/$slug" params={{ slug: game.id }} className="hover:underline">
              {game.title}
            </Link>
          </h3>
          <span className={cx("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold", dark ? "bg-white/30" : "bg-black/25", ink)}>
            <Glyph name="users" className="size-[15px]" />
            {game.players} لاعب
          </span>
        </div>
      </div>
      <p className={cx("line-clamp-2 flex-1 text-[14px] leading-[24px] sm:line-clamp-none sm:leading-[25px]", soft)}>{game.blurb}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          tone="glass"
          onClick={onHowTo}
          className={cx("min-h-11 w-full border-white/30 px-3", dark ? "bg-white/25 text-on-gold hover:bg-white/35" : "bg-black/20 text-ivory hover:bg-black/30")}
        >
          كيف تُلعب؟
        </Button>
        <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, "min-h-11 w-full bg-ivory px-3 font-bold text-ink shadow-[0_8px_20px_-8px_#0008] hover:brightness-95")}>
          ابدأ الغرفة
          <Glyph name="forward" className="size-[18px]" />
        </Link>
      </div>
    </article>
  );
}

/** The short rules of one game: a sheet on phones, a centred window from 640px. Closes on Escape or a tap outside. */
function HowToSheet({ game, onClose }: { game: GameEntry | null; onClose: () => void }) {
  useEffect(() => {
    if (!game) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, onClose]);

  if (!game?.howTo) return null;
  const rules = game.howTo;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/75 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(event) => event.stopPropagation()}
        className="surface sheet-up max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] px-6 pt-2.5 pb-[max(24px,env(safe-area-inset-bottom))] shadow-lift sm:max-w-lg sm:rounded-[28px] sm:pt-6"
      >
        <div aria-hidden="true" className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center gap-3">
          <GameIcon id={game.id} icon={game.icon} />
          <h3 id="howto-title" className="min-w-0 text-2xl leading-9">
            {game.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="ms-auto grid size-12 shrink-0 place-items-center rounded-full border border-line-strong/70 bg-deep-2/60 text-ivory hover:border-glow"
          >
            <Glyph name="x" />
          </button>
        </div>

        <p className="mt-4 text-base leading-[29px] text-ivory">{rules.goal}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[15px] text-mist">
          <Glyph name="clock" className="size-[18px] text-gold" />
          المدة التقريبية: <span className="font-semibold text-ivory">{rules.minutes}</span>
        </p>

        <ol className="mt-4 grid gap-3">
          {rules.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-[15px] leading-[27px] text-mist">
              <span className="btn-gold grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, buttonTone("primary"), "min-h-14 w-full text-[17px]")}>
            ابدأ الغرفة
          </Link>
          <Link to="/games/$slug" params={{ slug: game.id }} className={cx(buttonBase, buttonTone("quiet"), "min-h-14 w-full")}>
            صفحة اللعبة
          </Link>
        </div>
      </div>
    </div>
  );
}
