import { useEffect, useState, type FormEvent } from "react";
import { RejoinCard } from "@/components/rejoin";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { ShareSite } from "@/components/share";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { CodeCells, GameIcon, Glyph, GlyphBadge, HeroArt, Mark, Wordmark, gameStyle, gameVars } from "@/components/brand";


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
    id: "alhalba",
    title: "الحلبة",
    icon: "🥊",
    players: "2-10",
    category: "talk",
    blurb: "تحدي المواجهة المباشرة والمزايدة! أجب أسرع وخاطر بنقاطك لتسيطر على الحلبة وتطيح بخصومك.",
    live: true,
    howTo: {
      goal: "زايد على عدد الإجابات التي تقدر تذكرها، وأثبتها قبل ما يخلص الوقت. لكل لاعب محاولات، ومن تخلص محاولاته يخرج من الحلبة.",
      minutes: "15 إلى 30 دقيقة",
      steps: [
        "المضيف يقدر يلعب معكم أو يكون حَكَمًا فقط، ويختار طريقة اللعب (فردي أو فريقان) والتصنيفات وعدد المحاولات والجولات.",
        "يظهر موضوع، مثل «دول تبدأ بحرف الميم». زايدوا من جوالاتكم: كم إجابة تقدر تذكر؟",
        "أي لاعب يضغط «تحدي!» على صاحب أعلى مزايدة، أو ينتهي وقت المزايدة.",
        "صاحب المزايدة يكتب إجاباته في جواله أو يقولها بصوت عالٍ، والحَكَم يقبل الصحيحة. الإجابة المكررة تُرفض، ويفوز فورًا إذا وصل للعدد.",
        "إذا نجح يكسب النقاط من المتحدّي، وإذا فشل يخسرها ويخسر محاولة.",
        "لكل لاعب ثلاث أوراق، كل ورقة مرة في المباراة: «مضاعفة» لنقاط الجولة، «تبديل الموضوع» أثناء المزايدة، و«سرقة» يكمل فيها المتحدّي الباقي إذا فشل صاحب المزايدة.",
        "من هو خارج النزال يتوقع: ينجح أو يفشل؟ والتوقع الصحيح يعطي نقاط تشجيع.",
        "يفوز آخر من يبقى في الحلبة، أو صاحب أعلى نقاط بعد آخر جولة.",
      ],
    },
  },
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
        "يحصل كل لاعب على دور سري يظهر على جواله فقط، وتحتاجون 5 لاعبين على الأقل. المضيف هو الراوي، ويختار عدد المافيا والأدوار الإضافية ومؤقت النهار.",
        "في الليل: المافيا تختار ضحية، والطبيب يحمي لاعبًا، والمحقق يكشف لاعبًا. اغمضوا أعينكم.",
        "في النهار: يناقش الجميع ويتهم بعضهم بعضًا، ثم يصوّتون لإقصاء لاعب. عند التعادل تُعاد الجولة بين المتعادلين، وبعدها تظهر الأصوات للجميع.",
        "أدوار إضافية اختيارية: المهرّج يفوز إذا أقصوه، والعمدة صوته بصوتين، والحارس يموت بدلًا ممن يحرسه، والقنّاص له رصاصة واحدة في النهار، والعرّافة تعرف دور لاعب خرج مرة واحدة.",
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

/** The four promises of the original hero chips, shown as the feature bar. */
const FEATURES = [
  { icon: "shield", label: "بدون تسجيل" },
  { icon: "phone", label: "بدون تحميل" },
  { icon: "users", label: "حتى 14 لاعبًا" },
  { icon: "heart", label: "مجانًا" },
];

function Home() {
  return (
    <Shell>
      <RejoinCard />
      <Hero />
      <HowItWorks />
      <Games />
      <CallToAction />
    </Shell>
  );
}

/** Join by code: a compact row inside the hero on computers, a card under it on phones. */
function JoinByCode({ compact = false }: { compact?: boolean }) {
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

  const inputId = compact ? "join-code-row" : "join-code";
  return (
    <form
      onSubmit={submit}
      noValidate
      className={cx(
        "surface",
        compact ? "grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1 rounded-[22px] py-2.5 ps-5 pe-2.5" : "grid justify-items-center gap-3 rounded-[22px] p-4 text-center",
      )}
    >
      <label htmlFor={inputId} className="text-[15px] font-semibold text-ivory">
        عندكم رمز غرفة؟
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
        describedBy={error ? `${inputId}-error` : `${inputId}-hint`}
        placeholder="ABC23"
      />
      <Button type="submit" tone="violet" className={compact ? "min-h-11" : "w-full"}>
        انضم
      </Button>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className={cx("flex items-center gap-1.5 text-[13px] font-semibold text-wrong", compact && "col-span-3")}>
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : (
        <p id={`${inputId}-hint`} className={cx("text-[13px] text-mist", compact && "col-span-3")}>
          الرمز يظهر على شاشة المضيف، أو امسحوا رمز QR.
        </p>
      )}
    </form>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-title">
      <div className="forest-bg relative overflow-hidden rounded-[28px] border border-glow/30 shadow-glow-line">
        <div className="grid items-center gap-2 px-5 pt-4 pb-7 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-6 lg:px-14 lg:py-10">
          <div className="order-2 grid justify-items-center gap-4 text-center lg:order-1 lg:justify-items-start lg:text-start">
            <h1 id="hero-title" className="sr-only">
              العش
            </h1>
            <Wordmark height={104} className="lg:h-[150px]!" />
            <p className="font-display text-[26px] font-extrabold leading-[40px] text-balance text-ivory lg:text-[38px] lg:leading-[56px]">
              حيث تلتقي التحديات بالمتعة الجماعية
            </p>
            <p className="max-w-md rounded-2xl bg-night/40 px-4 py-3 text-[16px] leading-[29px] text-mist lg:bg-transparent lg:p-0 lg:text-[18px] lg:leading-8">
              تلفزيون واحد في الوسط، وجوالاتكم حواليه. بدون تسجيل وبدون تحميل، افتحوا الغرفة وابدأوا السهرة.
            </p>
            <div className="mt-1 grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap sm:justify-center lg:justify-start">
              <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-14 px-8 text-[17px]")}>
                <Glyph name="users" />
                إنشاء غرفة
              </Link>
              <a href="#games" className={cx(buttonBase, buttonTone("outline"), "min-h-14 px-8 text-[17px]")}>
                <Glyph name="gamepad" />
                استعرض الألعاب
              </a>
            </div>
            <div className="hidden lg:block">
              <JoinByCode compact />
            </div>
          </div>
          <div className="order-1 mx-auto w-full max-w-[300px] sm:max-w-[420px] lg:order-2 lg:max-w-[600px]">
            <HeroArt className="bob" />
          </div>
        </div>
      </div>

      <div className="mt-4 lg:hidden">
        <JoinByCode />
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-3 lg:surface lg:mt-6 lg:grid-cols-4 lg:gap-0 lg:rounded-[22px] lg:py-5">
        {FEATURES.map((f, i) => (
          <li
            key={f.label}
            className={cx(
              "surface grid justify-items-center gap-2.5 rounded-[18px] px-3 py-4 text-center lg:rounded-none lg:border-0 lg:bg-none lg:shadow-none",
              i > 0 && "lg:border-s lg:border-line",
            )}
          >
            <GlyphBadge name={f.icon} className="size-12 lg:size-14" />
            <span className="font-display text-[17px] font-bold leading-6 text-ivory lg:text-[19px]">{f.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionTitle({ id, icon, children }: { id: string; icon: string; children: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-[22px] leading-8 lg:text-[28px] lg:leading-10">
      <Glyph name={icon} className="size-7 text-gold" />
      {children}
    </h2>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mt-10 lg:mt-14">
      <div className="mb-5">
        <SectionTitle id="how-title" icon="question">
          كيف تبدأ؟
        </SectionTitle>
      </div>
      <ol className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {STEPS.map((step, index) => (
          <li key={step.title} className="step-line relative grid grid-cols-[48px_1fr] gap-3 lg:grid-cols-1">
            <span className="btn-gold relative z-[1] grid size-12 place-items-center rounded-full text-lg font-extrabold">{index + 1}</span>
            <div>
              <h3 className="mt-1 mb-1 text-[20px] leading-8">{step.title}</h3>
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
    <section id="games" aria-labelledby="games-title" className="mt-10 scroll-mt-28 lg:mt-14">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionTitle id="games-title" icon="gamepad">
          الألعاب
        </SectionTitle>
        <p className="text-[15px] text-mist">
          {liveCount} متاحة الآن · {GAMES.length - liveCount} قريبًا
        </p>
      </div>

      <div role="group" aria-label="تصفية الألعاب" className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((game, i) => (
          <GameTile key={game.id} game={game} index={i} onHowTo={() => setSheetGame(game)} />
        ))}
      </div>

      <HowToSheet game={sheetGame} onClose={() => setSheetGame(null)} />

      {visible.length === 0 ? <p className="mt-6 text-center text-[15px] text-mist">لا توجد ألعاب في هذا التصنيف بعد.</p> : null}
    </section>
  );
}

/** A game card in the game's own colours: icon, players, name, blurb, then the two actions (or «قريبًا»). */
function GameTile({ game, index, onHowTo }: { game: GameCard; index: number; onHowTo: () => void }) {
  const dark = gameStyle(game.id).ink === "dark";
  const ink = dark ? "text-on-gold" : "text-ivory";
  const soft = dark ? "text-on-gold/80" : "text-ivory/80";
  return (
    <article
      style={{ ...gameVars(game.id), animationDelay: `${index * 50}ms` }}
      className={cx("gcard rise relative flex flex-col gap-3 overflow-hidden rounded-[24px] p-4 sm:p-5", !game.live && "opacity-70 saturate-[.6]")}
    >
      <span aria-hidden="true" className="pointer-events-none absolute -top-10 -end-10 size-36 rounded-full bg-white/10 blur-2xl" />
      <div className="flex items-center gap-3">
        <span className="gcard-icon grid size-[72px] shrink-0 place-items-center rounded-full">
          <img src={`/brand/games/game-${game.id}.svg`} alt="" className="size-16" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h3 className={cx("text-[21px] leading-8", ink)}>{game.title}</h3>
          <span className={cx("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold", dark ? "bg-white/30" : "bg-black/25", ink)}>
            <Glyph name="users" className="size-[15px]" />
            {game.players} لاعب
          </span>
        </div>
      </div>
      <p className={cx("flex-1 text-[14px] leading-[25px]", soft)}>{game.blurb}</p>
      {game.live ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Button
            tone="glass"
            onClick={onHowTo}
            className={cx("w-full border-white/30 px-3", dark ? "bg-white/25 text-on-gold hover:bg-white/35" : "bg-black/20 text-ivory hover:bg-black/30")}
          >
            كيف تُلعب؟
          </Button>
          <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, "w-full bg-ivory px-3 font-bold text-ink shadow-[0_8px_20px_-8px_#0008] hover:brightness-95")}>
            ابدأ الغرفة
            <Glyph name="forward" className="size-[18px]" />
          </Link>
        </div>
      ) : (
        <span className={cx("mt-1 inline-flex min-h-11 items-center justify-center rounded-full border border-dashed border-white/40 text-[15px] font-semibold", soft)}>
          قريبًا
        </span>
      )}
    </article>
  );
}

/** Bottom sheet with the short rules of one game: a sheet on phones, a centred window from 640px. Closes on Escape or a tap outside. */
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
          <GameIcon id={game.id} />
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

        <Link to="/play" search={{ game: game.id }} className={cx(buttonBase, buttonTone("primary"), "mt-6 min-h-14 w-full text-[17px]")}>
          ابدأ الغرفة
        </Link>
      </div>
    </div>
  );
}

function CallToAction() {
  return (
    <section className="surface mt-10 grid justify-items-center gap-3 rounded-[28px] px-4 py-8 text-center lg:mt-14">
      <Mark height={96} className="bob" />
      <h2 className="text-[24px] lg:text-[30px]">جاهزون للسهرة؟</h2>
      <p className="text-[17px] leading-[31px] text-mist">أنشئوا الغرفة الآن، وشاركوا الرمز مع أصدقائكم.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "min-h-14 px-8 text-[17px]")}>
          <Glyph name="users" />
          إنشاء غرفة
        </Link>
        <ShareSite className="min-h-14 px-7 text-[17px]" />
      </div>
    </section>
  );
}
