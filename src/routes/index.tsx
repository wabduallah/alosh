import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Logo } from "@/components/logo";
import { ShareSite } from "@/components/share";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { rememberGame, readLastGame } from "@/lib/last-game";
import { getGame } from "@/lib/games";
import { NotifyForm } from "@/components/notify-form";
import {
  CATEGORY_LABELS,
  GAMES,
  fitsPlayers,
  type Category,
  type GameCard,
} from "@/lib/games";
import { Button, cx, inputClass } from "@/components/ui";

/** Room codes use this alphabet only (no I, O, 0, 1), matching the join page. */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "ألعاب جماعية تُلعب على شاشة واحدة وجوال لكل لاعب، مجانًا وبدون تسجيل." },
    ],
  }),
  component: Home,
});

const FILTERS: Array<{ key: "all" | Category; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "words", label: "كلمات" },
  { key: "talk", label: "حوار وتخمين" },
  { key: "strategy", label: "استراتيجية" },
  { key: "classic", label: "كلاسيكية" },
];

/** Player-count choices. The "8" choice means the game supports 8 players or more. */
const PLAYER_FILTERS: Array<{ key: "any" | 2 | 4 | 6 | 8; label: string }> = [
  { key: "any", label: "أي عدد" },
  { key: 2, label: "2 لاعبين" },
  { key: 4, label: "4 لاعبين" },
  { key: 6, label: "6 لاعبين" },
  { key: 8, label: "8 لاعبين أو أكثر" },
];

type OccasionKey = "family" | "quick4" | "friends" | "words";

/** Ready-made answers to "what should we play?". Each one narrows the list. */
const OCCASIONS: Array<{
  key: OccasionKey;
  label: string;
  hint: string;
  match: (game: GameCard) => boolean;
}> = [
  {
    key: "family",
    label: "سهرة عائلية",
    hint: "ألعاب مريحة للجميع، من الصغار إلى الكبار.",
    match: (game) => ["tactical-grid", "heads-up", "outsider"].includes(game.id),
  },
  {
    key: "quick4",
    label: "لعبة لـ 4",
    hint: "ألعاب متاحة الآن تناسب أربعة لاعبين.",
    match: (game) => game.live && fitsPlayers(game, 4),
  },
  {
    key: "friends",
    label: "للأصدقاء والتحدي",
    hint: "ألعاب تنافسية تحتاج خداعًا واستراتيجية.",
    match: (game) => ["tactical-grid", "bluff-master", "social-mafia"].includes(game.id),
  },
  {
    key: "words",
    label: "لعب بالكلمات",
    hint: "ألعاب تعتمد على الكلمات والوصف.",
    match: (game) => game.category === "words",
  },
];

const STEPS = [
  {
    title: "أنشئوا غرفة",
    text: "اختاروا اللعبة من الأسفل، وتظهر لكم شاشة المضيف مع رمز الغرفة.",
  },
  {
    title: "انضموا من جوالاتكم",
    text: "امسحوا رمز QR أو اكتبوا رمز الغرفة، ولا حاجة لتسجيل.",
  },
  {
    title: "ابدأوا السهرة",
    text: "كل لاعب يلعب من جواله، والنتيجة والوقت يظهران على الشاشة الكبيرة.",
  },
];

function Home() {
  return (
    <Shell>
      <div className="pb-24 md:pb-0">
        <Hero />
        <HowItWorks />
        <Games />
        <CallToAction />
      </div>
      <MobileActionBar />
    </Shell>
  );
}

/**
 * Fixed bar at the bottom of phones: create a room, or jump to the join-by-code
 * field. Hidden on wider screens, where the hero already shows both actions.
 */
function MobileActionBar() {
  function focusJoinField() {
    const input = document.getElementById("join-code");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => (input as HTMLInputElement | null)?.focus(), 300);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-night/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md gap-3">
        <Link to="/play" search={{ game: "" }} className="flex-1" onClick={() => trackEvent("create_room", "bar")}>
          <Button tone="primary" className="w-full">
            إنشاء غرفة
          </Button>
        </Link>
        <Button tone="glass" className="flex-1" onClick={focusJoinField}>
          انضم برمز
        </Button>
      </div>
    </div>
  );
}

function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) {
      setError("الرمز يتكون من 5 حروف أو أرقام، مثل ABC23.");
      return;
    }
    setError(null);
    trackEvent("join_code");
    navigate({ to: "/join/$code", params: { code: normalized } });
  }

  return (
    <form onSubmit={submit} noValidate className="glass-card mx-auto mt-8 max-w-md rounded-3xl p-4 text-right">
      <label htmlFor="join-code" className="block text-sm font-bold text-ivory">
        عندكم رمز غرفة؟
      </label>
      <div className="mt-3 flex gap-2">
        <input
          id="join-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            if (error) setError(null);
          }}
          maxLength={5}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC23"
          inputMode="text"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "join-code-error" : "join-code-hint"}
          className={cx(inputClass, "font-mono text-lg tracking-[0.3em] uppercase")}
        />
        <Button type="submit" tone="violet" className="shrink-0">
          انضم
        </Button>
      </div>
      {error ? (
        <p id="join-code-error" role="alert" className="mt-2 text-sm text-crimson">
          {error}
        </p>
      ) : (
        <p id="join-code-hint" className="mt-2 text-xs text-muted">
          الرمز يظهر على شاشة المضيف، أو امسحوا رمز QR.
        </p>
      )}
    </form>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-3xl pt-8 text-center sm:pt-14">
      <h1 className="sr-only">العش</h1>
      <Logo size="lg" />
      <p className="mt-6 text-lg font-extrabold text-ivory sm:text-2xl">حيث تلتقي التحديات بالمتعة الجماعية</p>
      <p className="mx-auto mt-3 max-w-xl text-base leading-8 text-muted">
        تلفزيون واحد في الوسط، وجوالاتكم حواليه. بدون تسجيل وبدون تحميل، افتحوا الغرفة وابدأوا السهرة.
      </p>

      <div className="mt-7 flex flex-col items-center gap-3">
        <Link to="/play" search={{ game: "" }} onClick={() => trackEvent("create_room", "hero")}>
          <Button tone="primary">إنشاء غرفة</Button>
        </Link>
        <a href="#games" className="inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-neon hover:underline">
          أو استعرض الألعاب ↓
        </a>
      </div>

      <JoinByCode />

      <ul className="mt-7 flex flex-wrap justify-center gap-2 text-xs text-muted">
        <li className="rounded-full border border-white/10 px-3 py-1">بدون تسجيل</li>
        <li className="rounded-full border border-white/10 px-3 py-1">بدون تحميل</li>
        <li className="rounded-full border border-white/10 px-3 py-1">حتى 14 لاعبًا</li>
        <li className="rounded-full border border-white/10 px-3 py-1">مجانًا</li>
      </ul>
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mx-auto mt-14 max-w-5xl">
      <h2 id="how-title" className="mb-4 px-1 text-xl font-extrabold text-ivory">
        كيف تبدأ؟
      </h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="glass-card rounded-3xl p-5">
            <span className="grid size-9 place-items-center rounded-full bg-neon/15 text-sm font-extrabold text-neon">
              {index + 1}
            </span>
            <h3 className="mt-4 text-base font-extrabold text-ivory">{step.title}</h3>
            <p className="mt-2 text-sm leading-7 text-muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Offers the game the visitor picked last, if it is open for play. */
function ResumeGame() {
  const [lastId, setLastId] = useState<string | null>(null);
  useEffect(() => {
    setLastId(readLastGame());
  }, []);

  const game = lastId ? getGame(lastId) : undefined;
  if (!game || !game.live) return null;

  return (
    <div className="glass-card mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">{game.icon}</span>
        <div>
          <p className="text-xs font-bold text-muted">استأنف آخر لعبة</p>
          <p className="font-extrabold text-ivory">{game.title}</p>
        </div>
      </div>
      <Link
        to="/play"
        search={{ game: game.id }}
        onClick={() => {
          trackEvent("resume_game", game.id);
          rememberGame(game.id);
        }}
      >
        <Button tone="violet">ابدأ الغرفة</Button>
      </Link>
    </div>
  );
}

/**
 * Live counts of rooms, shown as numbers only. Reads just the row count of
 * game_rooms, which is publicly readable, so no player data is touched.
 */
function useLiveRoomCounts() {
  const [counts, setCounts] = useState<{ playing: number; today: number } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;

    async function load() {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [playing, today] = await Promise.all([
        client.from("game_rooms").select("id", { count: "exact", head: true }).eq("status", "playing"),
        client
          .from("game_rooms")
          .select("id", { count: "exact", head: true })
          .gte("created_at", startOfDay.toISOString()),
      ]);
      if (cancelled || playing.error || today.error) return;
      setCounts({ playing: playing.count ?? 0, today: today.count ?? 0 });
    }

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return counts;
}

function Games() {
  const liveRooms = useLiveRoomCounts();
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [players, setPlayers] = useState<"any" | 2 | 4 | 6 | 8>("any");
  const [occasion, setOccasion] = useState<OccasionKey | null>(null);
  const [query, setQuery] = useState("");
  const [sheetGame, setSheetGame] = useState<GameCard | null>(null);
  const liveCount = GAMES.filter((game) => game.live).length;
  const term = query.trim();
  const activeOccasion = OCCASIONS.find((item) => item.key === occasion) ?? null;
  const visible = GAMES.filter(
    (game) =>
      (filter === "all" || game.category === filter) &&
      fitsPlayers(game, players) &&
      (activeOccasion === null || activeOccasion.match(game)) &&
      (term === "" ||
        game.title.includes(term) ||
        game.blurb.includes(term) ||
        CATEGORY_LABELS[game.category].includes(term)),
  ).sort((a, b) => Number(b.live) - Number(a.live));
  const filtersActive = filter !== "all" || players !== "any" || term !== "" || occasion !== null;

  // Search: count a search once the typing pauses, and whether it found anything.
  const resultCount = visible.length;
  useEffect(() => {
    if (term.length < 2) return;
    const timer = window.setTimeout(() => trackEvent("search", resultCount === 0 ? "none" : "found"), 800);
    return () => window.clearTimeout(timer);
    // Only the typed text should restart the timer, not each filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <section id="games" aria-labelledby="games-title" className="mx-auto mt-14 max-w-5xl scroll-mt-6">
      <ResumeGame />
      <div className="mb-4 px-1">
        <h2 id="games-title" className="text-xl font-extrabold text-ivory">
          الألعاب
        </h2>
        {liveRooms ? (
          <p className="mt-1 text-sm font-bold text-neon" aria-live="polite">
            {liveRooms.playing > 0
              ? [`${liveRooms.playing} لعبة جارية الآن`, liveRooms.today > 0 ? `${liveRooms.today} غرفة اليوم` : null]
                  .filter(Boolean)
                  .join(" · ")
              : liveRooms.today > 0
                ? `${liveRooms.today} غرفة اليوم`
                : "كن أول من يبدأ الليلة"}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-muted">
          {filtersActive
            ? `${visible.length} من ${GAMES.length} لعبة`
            : `${liveCount} متاحة الآن · ${GAMES.length - liveCount} قريبًا`}
        </p>
      </div>

      <div className="mb-3">
        <label htmlFor="game-search" className="sr-only">
          ابحث عن لعبة
        </label>
        <input
          id="game-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث باسم اللعبة أو التصنيف"
          className={inputClass}
        />
      </div>

      <div role="group" aria-label="اختر حسب المناسبة" className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {OCCASIONS.map((item) => {
          const active = occasion === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) trackEvent("occasion", item.key);
                setOccasion(active ? null : item.key);
              }}
              className={cx(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition",
                active ? "border-violet bg-violet/10 text-ivory" : "border-white/10 text-muted hover:text-ivory",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeOccasion ? <p className="mb-3 px-1 text-sm text-muted">{activeOccasion.hint}</p> : <div className="mb-3" />}

      <div role="group" aria-label="عدد اللاعبين" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {PLAYER_FILTERS.map((item) => {
          const active = players === item.key;
          return (
            <button
              key={String(item.key)}
              type="button"
              aria-pressed={active}
              onClick={() => {
                trackEvent("players", String(item.key));
                setPlayers(item.key);
              }}
              className={cx(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition",
                active ? "border-neon bg-neon/10 text-neon" : "border-white/10 text-muted hover:text-ivory",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div role="group" aria-label="تصفية الألعاب" className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                trackEvent("category", item.key);
                setFilter(item.key);
              }}
              className={cx(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition",
                active ? "border-neon bg-neon/10 text-neon" : "border-white/10 text-muted hover:text-ivory",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((game) => (
          <GameTile key={game.id} game={game} onHowTo={() => setSheetGame(game)} />
        ))}
      </div>

      <HowToSheet game={sheetGame} onClose={() => setSheetGame(null)} />

      {visible.length === 0 ? (
        <div className="mt-6 text-center text-sm text-muted">
          <p>لا توجد ألعاب تطابق اختياراتك.</p>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setPlayers("any");
                setOccasion(null);
                setQuery("");
              }}
              className="mt-3 min-h-11 rounded-full border border-white/10 px-5 font-bold text-ivory hover:border-neon/60"
            >
              مسح الفلاتر
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GameTile({ game, onHowTo }: { game: GameCard; onHowTo: () => void }) {
  return (
    <article
      className={cx(
        "glass-card flex flex-col gap-3 rounded-3xl p-5 transition",
        game.live ? "hover:border-neon/60" : "opacity-70",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-3xl" aria-hidden="true">
          {game.icon}
        </span>
        <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs font-bold text-muted">
          👥 {game.players} لاعب
        </span>
      </div>
      <h3 className="text-lg font-extrabold text-ivory">
        <Link to="/games/$slug" params={{ slug: game.id }} className="hover:text-neon">
          {game.title}
        </Link>
      </h3>
      <p className="flex-1 text-sm leading-7 text-muted">{game.blurb}</p>
      {game.live ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Button
            tone="glass"
            onClick={() => {
              trackEvent("rules_open", game.id);
              rememberGame(game.id);
              onHowTo();
            }}
            className="w-full px-3"
          >
            كيف تُلعب؟
          </Button>
          <Link to="/play" search={{ game: game.id }} onClick={() => {
            trackEvent("start_room", game.id);
            rememberGame(game.id);
          }}>
            <Button tone="violet" className="w-full px-3">
              ابدأ الغرفة
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-1 space-y-3">
          <span className="inline-flex min-h-9 items-center rounded-full border border-white/10 px-3 text-xs font-bold text-muted">
            قريبًا
          </span>
          <NotifyForm gameId={game.id} gameTitle={game.title} />
        </div>
      )}
    </article>
  );
}

/** Bottom sheet with the short rules of one game. Closes on Escape or a tap outside. */
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

function HowToSheet({ game, onClose }: { game: GameCard | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = Boolean(game?.howTo);

  // While open: focus moves into the dialog, Tab stays inside it, Escape closes it.
  // When it closes: focus returns to the element that opened it.
  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !active || !dialog.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo?.focus();
    };
  }, [open]);

  if (!game?.howTo) return null;
  const rules = game.howTo;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night/70 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(event) => event.stopPropagation()}
        className="glass-card max-h-[85vh] w-full overflow-y-auto rounded-t-3xl p-6 sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="howto-title" className="text-xl font-extrabold text-ivory">
            <span aria-hidden="true">{game.icon}</span> {game.title}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/10 text-ivory hover:border-neon/60"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-base leading-8 text-ivory">{rules.goal}</p>
        <p className="mt-2 text-sm text-muted">
          المدة التقريبية: <span className="font-bold text-ivory">{rules.minutes}</span>
        </p>

        <ol className="mt-5 grid gap-3">
          {rules.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-7 text-muted">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-neon/15 text-xs font-extrabold text-neon">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <Link to="/play" search={{ game: game.id }} className="mt-6 block" onClick={() => {
            trackEvent("start_room", game.id);
            rememberGame(game.id);
          }}>
          <Button tone="violet" className="w-full">
            ابدأ الغرفة
          </Button>
        </Link>
      </div>
    </div>
  );
}

function CallToAction() {
  return (
    <section className="mx-auto mt-16 max-w-3xl rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center sm:p-8">
      <h2 className="text-xl font-extrabold text-ivory">جاهزون للسهرة؟</h2>
      <p className="mt-2 text-sm leading-7 text-muted">شاركوا العش مع من سيلعب معكم.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <ShareSite />
      </div>
    </section>
  );
}
