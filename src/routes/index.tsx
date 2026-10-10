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

type GameCard = {
  id: string;
  title: string;
  icon: string;
  players: string;
  category: "words" | "talk" | "strategy" | "classic";
  blurb: string;
  /** Only published games link to a room. The rest show as "قريبًا". */
  live: boolean;
};

/** Game catalogue for the home grid. Add a game here and set live to true once its room is ready. */
const GAMES: GameCard[] = [
  {
    id: "liars",
    title: "الكذابون",
    icon: "🎲",
    players: "2-14",
    category: "classic",
    blurb: "لوحة أسئلة على الشاشة الكبيرة. اختاروا التصنيفات وتنافسوا على النقاط.",
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
    live: false,
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
    id: "mafia",
    title: "المافيا",
    icon: "🔪",
    players: "4-15",
    category: "strategy",
    blurb: "المواطنون ضد المافيا. من يكذب ومن يصدق؟",
    live: false,
  },
];

const FILTERS: Array<{ key: "all" | GameCard["category"]; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "words", label: "كلمات" },
  { key: "talk", label: "حوار وتخمين" },
  { key: "strategy", label: "استراتيجية" },
  { key: "classic", label: "كلاسيكية" },
];

function Home() {
  return (
    <Shell>
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-10">
        <h1 className="sr-only">العش</h1>
        <Logo size="lg" />
        <p className="mt-4 text-sm font-bold text-violet">حيث تلتقي التحديات بالمتعة الجماعية</p>
        <p className="mt-4 text-base leading-8 text-muted">
          تلفزيون واحد في الوسط، وجوالاتكم حواليه. بدون تسجيل وبدون تحميل، افتحوا الغرفة وابدأوا السهرة.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/play" search={{ game: "" }}>
            <Button tone="primary">إنشاء غرفة</Button>
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-white/10 px-3 py-1">بدون تسجيل</span>
          <span className="rounded-full border border-white/10 px-3 py-1">بدون تحميل</span>
          <span className="rounded-full border border-white/10 px-3 py-1">حتى 14 لاعب</span>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-5xl">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-xl font-extrabold text-ivory">الألعاب</h2>
          <p className="text-sm text-muted">{GAMES.filter((g) => g.live).length} متاحة الآن</p>
        </div>

        <GameGrid />
      </section>
    </Shell>
  );
}

function GameGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {GAMES.map((game) => (
        <GameTile key={game.id} game={game} />
      ))}
    </div>
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
        <span className="text-3xl" aria-hidden="true">{game.icon}</span>
        <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs font-bold text-muted">
          👥 {game.players} لاعب
        </span>
      </div>
      <h3 className="text-lg font-extrabold text-ivory">{game.title}</h3>
      <p className="flex-1 text-sm leading-7 text-muted">{game.blurb}</p>
      {game.live ? (
        <Link to="/play" search={{ game: game.id }} className="mt-1">
          <Button tone="violet" className="w-full">ابدأ الغرفة</Button>
        </Link>
      ) : (
        <span className="mt-1 inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 text-sm font-bold text-muted">
          قريبًا
        </span>
      )}
    </article>
  );
}
