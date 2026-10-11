import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { ShareSite } from "@/components/share";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { CodeCells, Egg, GameIcon, Glyph, MoonArc, playersText } from "@/components/brand";

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
  /** "min-max" players. Shown in words: «من 2 إلى 12 لاعبًا». */
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
    players: "1-10",
    category: "words",
    blurb: "كلمة خماسية في ست محاولات، والجميع يتابع النتيجة على الشاشة.",
    live: false,
  },
  {
    id: "outsider",
    title: "برة السالفة",
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
    players: "4-10",
    category: "strategy",
    blurb: "فريقان يتنافسان بتلميحات كلمة واحدة لكشف الكلمات.",
    live: false,
  },
  {
    id: "one-word",
    title: "كلمة واحدة",
    players: "3-8",
    category: "words",
    blurb: "تلميح واحد فقط لكل كلمة، وإذا تكررت التلميحات تُلغى.",
    live: false,
  },
  {
    id: "social-mafia",
    title: "المافيا",
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

const STEPS = [
  {
    title: "أنشئوا غرفة",
    text: "اختاروا اللعبة، وتظهر شاشة المضيف مع رمز الغرفة.",
  },
  {
    title: "انضموا من جوالاتكم",
    text: "امسحوا رمز QR أو اكتبوا رمز الغرفة، بدون تسجيل.",
  },
  {
    title: "ابدأوا السهرة",
    text: "كل لاعب يلعب من جواله، والنتيجة على الشاشة الكبيرة.",
  },
];

function range(game: GameCard) {
  const [min, max] = game.players.split("-").map((n) => Number(n));
  return { min, max };
}

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

/** Join by code. On the phone this is the first thing on the page. */
function JoinByCode({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) {
      setError("الرمز يتكون من 5 حروف أو أرقام، مثل K7Q4M.");
      return;
    }
    setError(null);
    navigate({ to: "/join/$code", params: { code: normalized } });
  }

  const inputId = compact ? "join-code-row" : "join-code";
  const describedBy = error ? `${inputId}-error` : `${inputId}-hint`;

  if (compact) {
    return (
      <form onSubmit={submit} noValidate className="inline-flex flex-wrap items-center gap-3 rounded-full border border-line bg-deep py-2.5 ps-5 pe-2.5">
        <label htmlFor={inputId} className="text-[15px] font-semibold text-ivory">
          عندكم رمز؟
        </label>
        <CodeCells
          id={inputId}
          compact
          value={code}
          onChange={(next) => {
            setCode(next);
            if (error) setError(null);
          }}
          invalid={!!error}
          describedBy={describedBy}
        />
        <Button type="submit" tone="secondary">
          انضم
        </Button>
        {error ? (
          <p id={`${inputId}-error`} role="alert" className="basis-full text-[13px] font-semibold text-wrong">
            {error}
          </p>
        ) : (
          <span id={`${inputId}-hint`} className="sr-only">
            الرمز يظهر على شاشة المضيف.
          </span>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 rounded-[28px] border border-line bg-deep p-4">
      <label htmlFor={inputId} className="text-[15px] font-semibold text-ivory">
        عندكم رمز غرفة؟
      </label>
      <div className="flex justify-center">
        <CodeCells
          id={inputId}
          value={code}
          onChange={(next) => {
            setCode(next);
            if (error) setError(null);
          }}
          invalid={!!error}
          describedBy={describedBy}
        />
      </div>
      <Button type="submit" tone="primary" className="min-h-16 w-full text-[19px]">
        انضم
      </Button>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-wrong">
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : (
        <p id={`${inputId}-hint`} className="text-center text-[13px] leading-[22px] text-mist">
          الرمز على شاشة المضيف، أو امسحوا رمز QR.
        </p>
      )}
    </form>
  );
}

/** Home hero figure: one TV in the middle, phones around it on the hilal. */
function NestScene() {
  const tiles = "hhhhhaaxddaxxxxxxdxxxxxdx".split("");
  const phones: Array<[string, number]> = [
    ["سارة", 2],
    ["فهد", 3],
    ["نورة", 4],
    ["خالد", 5],
  ];
  return (
    <div className="scene" role="img" aria-label="تلفزيون في الوسط وأربعة جوالات حوله على هلال العش">
      <div className="scene-tv">
        {tiles.map((c, i) => (
          <i key={i} className={c === "h" ? "h" : i === 7 ? "a" : c === "d" ? "d" : ""} />
        ))}
      </div>
      <div className="scene-stand" />
      <MoonArc className="scene-moon" />
      <div className="scene-phones">
        {phones.map(([name, index]) => (
          <div key={name} className="scene-phone">
            <Egg name={name} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}

const TAGS = ["بدون تسجيل", "بدون تحميل", "حتى 14 لاعبًا", "مجانًا"];

/**
 * The device decides the first action: on the phone a guest is usually joining,
 * on a computer a host is usually creating a room.
 */
function Hero() {
  return (
    <section className="grid gap-6 pt-2 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:pt-12">
      <div className="grid gap-4">
        <h1 className="text-[38px] leading-[48px] lg:text-[56px] lg:leading-[68px]">حيث تلتقي التحديات بالمتعة الجماعية</h1>
        <p className="max-w-xl text-[17px] leading-[31px] text-mist lg:text-[19px] lg:leading-[34px]">
          تلفزيون واحد في الوسط، وجوالاتكم حواليه. بدون تسجيل وبدون تحميل.
        </p>

        {/* Phone and tablet: join first, then create. */}
        <div className="grid gap-3 lg:hidden">
          <JoinByCode />
          <div className="flex items-center gap-3 text-[13px] text-faint before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            أو
          </div>
          <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("secondary"), "min-h-14 w-full text-[17px]")}>
            إنشاء غرفة
          </Link>
        </div>

        {/* Computer: create first, join as a slim row. */}
        <div className="hidden gap-4 lg:grid">
          <div className="flex flex-wrap gap-3">
            <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-14 px-7 text-[17px]")}>
              إنشاء غرفة
            </Link>
            <a href="#games" className={cx(buttonBase, buttonTone("outline"), "min-h-14 px-7 text-[17px]")}>
              استعرضوا الألعاب
            </a>
          </div>
          <JoinByCode compact />
        </div>

        <ul className="flex flex-wrap gap-2">
          {TAGS.map((tag) => (
            <li key={tag} className="inline-flex min-h-[30px] items-center rounded-full border border-line px-3 text-[13px] text-mist">
              {tag}
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden sm:block">
        <NestScene />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="mt-12 scroll-mt-24 lg:mt-16">
      <h2 id="how-title" className="mb-5 text-2xl lg:text-[28px]">
        كيف تبدأ؟
      </h2>
      <ol className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {STEPS.map((step, index) => (
          <li key={step.title} className="step-line relative grid grid-cols-[40px_1fr] gap-3 lg:grid-cols-1">
            <span className="relative z-[1] grid size-10 place-items-center rounded-full border border-neon/40 bg-neon/12 text-base font-bold text-neon">
              {index + 1}
            </span>
            <div>
              <h3 className="mt-1.5 mb-1 text-[19px] leading-7">{step.title}</h3>
              <p className="text-[15px] leading-[27px] text-mist">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Games() {
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [sheetGame, setSheetGame] = useState<GameCard | null>(null);
  const liveCount = GAMES.filter((game) => game.live).length;
  const visible = GAMES.filter((game) => filter === "all" || game.category === filter).sort(
    (a, b) => Number(b.live) - Number(a.live),
  );

  return (
    <section id="games" aria-labelledby="games-title" className="mt-12 scroll-mt-24 lg:mt-16">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="games-title" className="text-2xl lg:text-[28px]">
          الألعاب
        </h2>
        <p className="text-[13px] text-mist">
          {liveCount} متاحة الآن، و{GAMES.length - liveCount} قريبًا
        </p>
      </div>

      <div role="group" aria-label="تصفية الألعاب" className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.key)}
              className={cx(
                "min-h-11 shrink-0 rounded-full border px-4 text-[15px] font-semibold transition",
                active ? "border-neon bg-neon/12 text-neon" : "border-line-strong text-mist hover:text-ivory",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Phone: rows that open the rules sheet. */}
      <div className="grid gap-2 sm:hidden">
        {visible.map((game) => (
          <GameRow key={game.id} game={game} onOpen={() => setSheetGame(game)} />
        ))}
      </div>

      {/* Tablet and computer: cards. */}
      <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((game) => (
          <GameTile key={game.id} game={game} onHowTo={() => setSheetGame(game)} />
        ))}
      </div>

      <HowToSheet game={sheetGame} onClose={() => setSheetGame(null)} />

      {visible.length === 0 ? <p className="mt-6 text-center text-[15px] text-mist">ما فيه ألعاب في هذا التصنيف بعد.</p> : null}
    </section>
  );
}

function GameMeta({ game }: { game: GameCard }) {
  const { min, max } = range(game);
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-[22px] text-mist">
      <span className="inline-flex items-center gap-1">
        <Glyph name="users" className="size-[15px]" />
        {playersText(min, max)}
      </span>
      {game.live && game.howTo ? (
        <span className="inline-flex items-center gap-1">
          <Glyph name="clock" className="size-[15px]" />
          {game.howTo.minutes}
        </span>
      ) : (
        <span>قريبًا</span>
      )}
    </span>
  );
}

function GameRow({ game, onOpen }: { game: GameCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={game.live ? onOpen : undefined}
      aria-disabled={game.live ? undefined : true}
      className={cx(
        "flex min-h-[76px] w-full items-center gap-3 rounded-[14px] border px-4 py-3 text-start",
        game.live ? "border-line bg-glass hover:bg-glass-strong" : "cursor-default border-dashed border-line-strong",
      )}
    >
      <GameIcon id={game.id} size="sm" soon={!game.live} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cx("font-display text-[17px] font-semibold leading-[26px]", game.live ? "text-ivory" : "text-mist")}>{game.title}</span>
        <GameMeta game={game} />
      </span>
      {game.live ? <Glyph name="chevron" className="size-5 text-faint" /> : null}
    </button>
  );
}

function GameTile({ game, onHowTo }: { game: GameCard; onHowTo: () => void }) {
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-[20px] border p-6",
        game.live ? "border-line bg-deep" : "border-dashed border-line-strong",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <GameIcon id={game.id} soon={!game.live} />
        {game.live ? null : (
          <span className="inline-flex min-h-7 items-center rounded-full border border-dashed border-line-strong px-2.5 text-[13px] text-mist">قريبًا</span>
        )}
      </div>
      <h3 className={cx("text-[21px] leading-[30px] font-semibold", game.live ? "text-ivory" : "text-mist")}>{game.title}</h3>
      <GameMeta game={game} />
      <p className="flex-1 text-[15px] leading-[27px] text-mist">{game.blurb}</p>
      {game.live ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Button tone="quiet" onClick={onHowTo} className="w-full px-3">
            كيف تُلعب؟
          </Button>
          <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, buttonTone("secondary"), "w-full px-3")}>
            ابدأ الغرفة
          </Link>
        </div>
      ) : null}
    </article>
  );
}

/** Bottom sheet on the phone, a centred window from 640px. Closes on Escape or a tap outside. */
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/70 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(event) => event.stopPropagation()}
        className="sheet-up max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] border border-b-0 border-line bg-deep px-6 pt-2.5 pb-[max(24px,env(safe-area-inset-bottom))] shadow-lift sm:max-w-lg sm:rounded-[28px] sm:border-b sm:pt-6"
      >
        <div aria-hidden="true" className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center gap-3">
          <GameIcon id={game.id} size="sm" />
          <h3 id="howto-title" className="text-2xl">
            {game.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="ms-auto grid size-12 place-items-center rounded-full border border-line bg-glass text-ivory hover:border-line-strong"
          >
            <Glyph name="x" />
          </button>
        </div>

        <p className="mt-4 text-base leading-[29px] text-ivory">{rules.goal}</p>
        <p className="mt-1 text-[13px] text-mist">
          المدة التقريبية: <span className="font-semibold text-ivory">{rules.minutes}</span>
        </p>

        <ol className="mt-4 grid gap-3">
          {rules.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-[15px] leading-[27px] text-mist">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-neon/12 text-[13px] font-bold text-neon">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, buttonTone("primary"), "mt-6 min-h-14 w-full text-[17px]")}>
          ابدأ الغرفة
        </Link>
      </div>
    </div>
  );
}

function CallToAction() {
  return (
    <section className="mt-12 grid justify-items-center gap-3 rounded-[28px] border border-line bg-deep px-4 py-8 text-center lg:mt-16">
      <h2 className="text-2xl lg:text-[28px]">جاهزون للسهرة؟</h2>
      <p className="text-[17px] leading-[31px] text-mist">أنشئوا الغرفة الآن، وشاركوا الرمز مع أصدقائكم.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-14 px-7 text-[17px]")}>
          إنشاء غرفة
        </Link>
        <ShareSite className="min-h-14 px-7 text-[17px]" />
      </div>
    </section>
  );
}
