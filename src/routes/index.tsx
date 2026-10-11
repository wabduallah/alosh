import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Logo } from "@/components/logo";
import { Button, cx } from "@/components/ui";

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
  },
  {
    id: "bluff-master",
    title: "سيد الخداع",
    icon: "🎭",
    players: "3-8",
    category: "strategy",
    blurb: "اكتبوا إجابات مزيفة مقنعة، وصوّتوا على الإجابة الحقيقية. من يخدع أكثر يكسب.",
    live: true,
  },
  {
    id: "heads-up",
    title: "هل تعرف",
    icon: "🧠",
    players: "2-10",
    category: "words",
    blurb: "اختاروا فريقين. مخمِّن يتوسط الفريق، وزملاؤه يصفون الكلمة دون أن يقولوها.",
    live: true,
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

function Games() {
  const [filter, setFilter] = useState<"all" | Category>("all");
  const liveCount = GAMES.filter((game) => game.live).length;
  const visible = GAMES.filter((game) => filter === "all" || game.category === filter).sort(
    (a, b) => Number(b.live) - Number(a.live),
  );

  return (
    <section id="games" aria-labelledby="games-title" className="mx-auto mt-14 max-w-5xl scroll-mt-6">
      <div className="mb-4 px-1">
        <h2 id="games-title" className="text-xl font-extrabold text-ivory">
          الألعاب
        </h2>
        <p className="mt-1 text-sm text-muted">
          {liveCount} متاحة الآن · {GAMES.length - liveCount} قريبًا
        </p>
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
          <GameTile key={game.id} game={game} />
        ))}
      </div>

      {visible.length === 0 ? <p className="mt-6 text-center text-sm text-muted">لا توجد ألعاب في هذا التصنيف بعد.</p> : null}
    </section>
  );
}

function GameTile({ game }: { game: GameCard }) {
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
        <Link to="/play" search={{ game: game.id }} className="mt-1">
          <Button tone="violet" className="w-full">
            ابدأ الغرفة
          </Button>
        </Link>
      ) : (
        <span className="mt-1 inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 text-sm font-bold text-muted">
          قريبًا
        </span>
      )}
    </article>
  );
}

function CallToAction() {
  return (
    <section className="mx-auto mt-16 max-w-3xl rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center sm:p-8">
      <h2 className="text-xl font-extrabold text-ivory">جاهزون للسهرة؟</h2>
      <p className="mt-2 text-sm leading-7 text-muted">أنشئوا الغرفة الآن، وشاركوا الرمز مع أصدقائكم.</p>
      <Link to="/play" search={{ game: "" }} className="mt-5 inline-block">
        <Button tone="primary">إنشاء غرفة</Button>
      </Link>
    </section>
  );
}
