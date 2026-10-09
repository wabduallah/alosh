import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Swords, Target, type LucideIcon } from "lucide-react";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "اختاروا لعبتكم، اقرأوا القوانين، وافتحوا غرفة." },
    ],
  }),
  component: Home,
});

type CoreCard = {
  to: "/games/competitive" | "/questions" | "/games/single-player";
  icon: LucideIcon;
  title: string;
  body: string;
  glow: string;
};

/** The three primary entry points. Nothing else is shown on the homepage. */
const CORE_CARDS: CoreCard[] = [
  {
    to: "/games/competitive",
    icon: Swords,
    title: "تحديات تنافسية",
    body: "غرف جماعية، تحدي معلومات، وأسرع إجابة",
    glow: "group-hover:shadow-[0_0_32px_rgb(6_182_212/0.28)]",
  },
  {
    to: "/questions",
    icon: BookOpen,
    title: "بنك الأسئلة",
    body: "تصفح وشاهد الأسئلة حسب الفئات",
    glow: "group-hover:shadow-[0_0_32px_rgb(139_92_246/0.28)]",
  },
  {
    to: "/games/single-player",
    icon: Target,
    title: "لعب فردي",
    body: "تخمين الصورة والشخصية وأسئلة الذكاء بلا غرفة",
    glow: "group-hover:shadow-[0_0_32px_rgb(6_182_212/0.28)]",
  },
];

function Home() {
  return (
    <Shell>
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-10">
        <h1 className="bg-linear-to-l from-neon to-violet bg-clip-text text-5xl font-extrabold text-transparent sm:text-6xl">
          العش
        </h1>
        <p className="mt-3 text-sm font-bold text-violet">حيث تلتقي التحديات بالمتعة الجماعية</p>
      </section>

      <section className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3">
        {CORE_CARDS.map(({ to, icon: Icon, title, body, glow }) => (
          <Link
            key={to}
            to={to}
            className={`group glass-card flex flex-col gap-4 rounded-3xl p-6 text-start transition-all duration-200 hover:-translate-y-0.5 ${glow}`}
          >
            <span className="grid size-14 place-items-center rounded-2xl border border-neon/30 bg-neon/10 text-neon">
              <Icon className="size-7" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="block text-xl font-extrabold text-ivory">{title}</span>
            <span className="block text-sm leading-relaxed text-muted">{body}</span>
          </Link>
        ))}
      </section>
    </Shell>
  );
}
