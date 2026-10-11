import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Logo } from "@/components/logo";
import { ShareSite } from "@/components/share";
import { supabase } from "@/lib/supabase";
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

type Category = "words" | "talk" | "strategy" | "classic";

type GameCard = {
  id: string;
  title: string;
  icon: string;
  players: string;
  category: Category;
  blurb: string;
  /** Only published games link to a room. The rest show as "قريبًا". */
  live: boolean;
  /** Short rules shown in the "كيف تُلعب؟" sheet. Only live games have them. */
  howTo?: { goal: string; minutes: string; steps: string[] };
};

/** Game catalogue for the home grid. Add a game here and set live to true once its room is ready. */
const GAMES: GameCard[] = [
  {
    id: "tactical-grid",
    title: "تحديات العش",
    icon: "🎲",
    players: "2-12",
    category: "classic",
    blurb: "لوحة أسئلة على الشاشة الكبيرة. اختاروا التصنيفات وتنافسوا على النقاط.",
    live: true,
    howTo: {
      goal: "اجمعوا أكبر عدد من النقاط بالإجابة على أسئلة التصنيفات.",
      minutes: "20 إلى 40 دقيقة",
      steps: [
        "اختاروا التصنيفات التي تريدون اللعب بها.",
        "يختار المضيف سؤالًا من اللوحة، ويظهر على الشاشة الكبيرة.",
        "أول من يضغط الجرس يجيب، والمضيف يحكم على الإجابة.",
        "تنتهي اللعبة عند انتهاء الأسئلة، ويفوز صاحب أعلى نقاط.",
      ],
    },
  },
  {
    id: "bluff-master",
    title: "سيد الخداع",
    icon: "🎭",
    players: "3-8",
    category: "strategy",
    blurb: "اكتبوا إجابات مزيفة مقنعة، وصوّتوا على الإجابة الحقيقية. من يخدع أكثر يكسب.",
    live: true,
    howTo: {
      goal: "اكتبوا إجابات مزيفة مقنعة، وصوّتوا على الإجابة الحقيقية.",
      minutes: "15 إلى 25 دقيقة",
      steps: [
        "يظهر سؤال على الشاشة، وكل لاعب يكتب إجابة مزيفة من جواله.",
        "تظهر الإجابات كلها مختلطة مع الإجابة الحقيقية، فصوّتوا على ما تظنونه صحيحًا.",
        "تكسبون نقاطًا عندما تختارون الإجابة الصحيحة، وتكسبون أيضًا عندما يصوّت غيركم لإجابتكم المزيفة.",
        "يتكرر الدور بأسئلة جديدة، ويفوز من يجمع أكثر النقاط.",
      ],
    },
  },
  {
    id: "heads-up",
    title: "هل تعرف",
    icon: "🧠",
    players: "2-10",
    category: "words",
    blurb: "اختاروا فريقين. مخمِّن يتوسط الفريق، وزملاؤه يصفون الكلمة دون أن يقولوها.",
    live: true,
    howTo: {
      goal: "مخمِّن يتوسط فريقه، وزملاؤه يصفون الكلمة دون أن يقولوها.",
      minutes: "15 إلى 30 دقيقة",
      steps: [
        "تُقسَم الغرفة إلى فريقين، ويختار المضيف التصنيفات قبل البداية.",
        "يمسك المخمِّن الجوال على جبهته، أو يمسكه زميله، فلا يرى الكلمة.",
        "يصف زملاؤه الكلمة الظاهرة على جوالاتهم دون أن يقولوها.",
        "عند الإجابة الصحيحة يكسب فريق المخمِّن نقطة، ويمكن تخطي الكلمة. لكل دور 60 ثانية.",
        "يفوز الفريق الأعلى نقاطًا قبل انتهاء الكلمات.",
      ],
    },
  },
  {
    id: "word-guess",
    title: "خمّن الكلمة",
    icon: "🔠",
    players: "1-10",
    category: "words",
    blurb: "كلمة خماسية في ست محاولات، والجميع يتابع النتيجة على الشاشة.",
    live: false,
  },
  {
    id: "outsider",
    title: "برة السالفة",
    icon: "👀",
    players: "3-8",
    category: "talk",
    blurb: "لاعب واحد لا يعرف الموضوع. هل تكشفه قبل أن يكشف نفسه؟",
    live: true,
    howTo: {
      goal: "لاعب واحد لا يعرف الموضوع. هل تكشفونه قبل أن يكشف نفسه؟",
      minutes: "10 إلى 20 دقيقة",
      steps: [
        "يحصل كل لاعب على الموضوع والكلمة، إلا لاعبًا واحدًا هو برة السالفة.",
        "يصف الجميع الكلمة بتلميحات، وبرة السالفة يحاول أن يتظاهر بأنه يعرفها.",
        "صوّتوا على من تظنونه برة السالفة.",
        "إن انكشف، يحاول أن يخمّن الكلمة ليفوز. وإن لم ينكشف، يكسب نقاطه.",
      ],
    },
  },
  {
    id: "secret-code",
    title: "الأسماء السرية",
    icon: "🕵️",
    players: "4-10",
    category: "strategy",
    blurb: "فريقان يتنافسان بتلميحات كلمة واحدة لكشف الكلمات.",
    live: false,
  },
  {
    id: "one-word",
    title: "كلمة واحدة",
    icon: "🤝",
    players: "3-8",
    category: "words",
    blurb: "تلميح واحد فقط لكل كلمة، وإذا تكررت التلميحات تُلغى.",
    live: false,
  },
  {
    id: "social-mafia",
    title: "المافيا",
    icon: "🔪",
    players: "5-14",
    category: "strategy",
    blurb: "المواطنون ضد المافيا. من يكذب ومن يصدق؟",
    live: true,
    howTo: {
      goal: "المواطنون ضد المافيا. من يكذب ومن يصدق؟",
      minutes: "20 إلى 35 دقيقة",
      steps: [
        "يحصل كل لاعب على دور سري يظهر على جواله فقط، وتحتاجون 5 لاعبين على الأقل.",
        "في الليل: المافيا تختار ضحية، والطبيب يحمي لاعبًا، والمحقق يكشف لاعبًا. اغمضوا أعينكم.",
        "في النهار: يناقش الجميع ويتهم بعضهم بعضًا، ثم يصوّتون لإقصاء لاعب.",
        "يفوز المواطنون إذا أُقصيت كل المافيا، وتفوز المافيا إذا تساوى عددها مع الباقين.",
      ],
    },
  },
];

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

/** Reads a range such as "3-8" as min 3 and max 8. */
function playerRange(players: string) {
  const [min, max] = players.split("-").map(Number);
  return { min, max: max ?? min };
}

function fitsPlayers(game: GameCard, key: "any" | 2 | 4 | 6 | 8) {
  if (key === "any") return true;
  const { min, max } = playerRange(game.players);
  if (key === 8) return max >= 8;
  return min <= key && key <= max;
}

const CATEGORY_LABELS: Record<Category, string> = {
  words: "كلمات",
  talk: "حوار وتخمين",
  strategy: "استراتيجية",
  classic: "كلاسيكية",
};

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
      <Hero />
      <HowItWorks />
      <Games />
      <CallToAction />
    </Shell>
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

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link to="/play" search={{ game: "" }}>
          <Button tone="primary">إنشاء غرفة</Button>
        </Link>
        <a
          href="#games"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 text-sm font-bold text-ivory transition hover:border-neon/60"
        >
          استعرض الألعاب
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
  const [query, setQuery] = useState("");
  const [sheetGame, setSheetGame] = useState<GameCard | null>(null);
  const liveCount = GAMES.filter((game) => game.live).length;
  const term = query.trim();
  const visible = GAMES.filter(
    (game) =>
      (filter === "all" || game.category === filter) &&
      fitsPlayers(game, players) &&
      (term === "" ||
        game.title.includes(term) ||
        game.blurb.includes(term) ||
        CATEGORY_LABELS[game.category].includes(term)),
  ).sort((a, b) => Number(b.live) - Number(a.live));
  const filtersActive = filter !== "all" || players !== "any" || term !== "";

  return (
    <section id="games" aria-labelledby="games-title" className="mx-auto mt-14 max-w-5xl scroll-mt-6">
      <div className="mb-4 px-1">
        <h2 id="games-title" className="text-xl font-extrabold text-ivory">
          الألعاب
        </h2>
        {liveRooms ? (
          <p className="mt-1 text-sm font-bold text-neon" aria-live="polite">
            {liveRooms.playing} لعبة جارية الآن · {liveRooms.today} غرفة اليوم
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

      <div role="group" aria-label="عدد اللاعبين" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {PLAYER_FILTERS.map((item) => {
          const active = players === item.key;
          return (
            <button
              key={String(item.key)}
              type="button"
              aria-pressed={active}
              onClick={() => setPlayers(item.key)}
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
              onClick={() => setFilter(item.key)}
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
      <h3 className="text-lg font-extrabold text-ivory">{game.title}</h3>
      <p className="flex-1 text-sm leading-7 text-muted">{game.blurb}</p>
      {game.live ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Button tone="glass" onClick={onHowTo} className="w-full px-3">
            كيف تُلعب؟
          </Button>
          <Link to="/play" search={{ game: game.id }}>
            <Button tone="violet" className="w-full px-3">
              ابدأ الغرفة
            </Button>
          </Link>
        </div>
      ) : (
        <span className="mt-1 inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 text-sm font-bold text-muted">
          قريبًا
        </span>
      )}
    </article>
  );
}

/** Bottom sheet with the short rules of one game. Closes on Escape or a tap outside. */
function HowToSheet({ game, onClose }: { game: GameCard | null; onClose: () => void }) {
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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night/70 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
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

        <Link to="/play" search={{ game: game.id }} className="mt-6 block">
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
      <p className="mt-2 text-sm leading-7 text-muted">أنشئوا الغرفة الآن، وشاركوا الرمز مع أصدقائكم.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link to="/play" search={{ game: "" }}>
          <Button tone="primary">إنشاء غرفة</Button>
        </Link>
        <ShareSite />
      </div>
    </section>
  );
}
