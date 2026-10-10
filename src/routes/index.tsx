import { createFileRoute, Link } from "@tanstack/react-router";
import { Swords, Users, Zap, type LucideIcon } from "lucide-react";
import { Shell } from "@/components/shell";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "اختاروا لعبتكم، اقرأوا القوانين، وافتحوا غرفة." },
    ],
  }),
  component: Home,
});

/** A hub either opens the create form preset to one game, or opens the Majlis builder. */
type Hub = {
  to: "/play" | "/majlis";
  game?: string;
  icon: LucideIcon;
  title: string;
  body: string;
  chips?: string[];
  glow: string;
};

/** The three game hubs. Each hub maps to an existing route; nothing else appears on the homepage. */
const HUBS: Hub[] = [
  {
    to: "/play",
    game: "bravo-party",
    icon: Swords,
    title: "تحدي برافو",
    body: "جولات سريعة بين الأصدقاء: تخمين، أسئلة جماعية، وتصويت وحذف سريع.",
    chips: ["سينما وأنيمي", "ألغاز وذكاء", "رياضة وكرة قدم", "ثقافة ومفاهيم عامة"],
    glow: "group-hover:shadow-[0_0_32px_rgb(6_182_212/0.28)]",
  },
  {
    to: "/play",
    game: "fastest",
    icon: Zap,
    title: "تحدي كلك",
    body: "أسئلة اختيار من متعدد بسباق على الوقت، مع مضاعف نقاط للإجابات المتتالية وقفل فوري.",
    glow: "group-hover:shadow-[0_0_32px_rgb(139_92_246/0.28)]",
  },
  {
    to: "/majlis",
    icon: Users,
    title: "تحدي المجالس",
    body: "غرفة خاصة لمجموعتك: من 2 إلى 14 لاعباً، واختر أن تشارك كلاعب أو تدير اللعبة فقط.",
    glow: "group-hover:shadow-[0_0_32px_rgb(6_182_212/0.28)]",
  },
];

function hubContent({ icon: Icon, title, body, chips }: Hub) {
  return (
    <>
      <span className="grid size-14 place-items-center rounded-2xl border border-neon/30 bg-neon/10 text-neon">
        <Icon className="size-7" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="block text-xl font-extrabold text-ivory">{title}</span>
      <span className="block text-sm leading-relaxed text-muted">{body}</span>
      {chips ? (
        <span className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span key={chip} className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-bold text-ivory/80">
              {chip}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}

function Home() {
  return (
    <Shell>
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-10">
        <h1 className="sr-only">العش</h1>
        <Logo size="lg" />
        <p className="mt-4 text-sm font-bold text-violet">حيث تلتقي التحديات بالمتعة الجماعية</p>
      </section>

      <section className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3">
        {HUBS.map((hub) => {
          const cardClass = `group glass-card flex flex-col gap-4 rounded-3xl p-6 text-start transition-all duration-200 hover:-translate-y-0.5 ${hub.glow}`;
          return hub.to === "/play" ? (
            <Link key={hub.title} to="/play" search={{ game: hub.game ?? "" }} className={cardClass}>
              {hubContent(hub)}
            </Link>
          ) : (
            <Link key={hub.title} to="/majlis" className={cardClass}>
              {hubContent(hub)}
            </Link>
          );
        })}
      </section>
    </Shell>
  );
}
