import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/")({
  loader: () => listGames(),
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "اختاروا لعبتكم، اقرأوا القوانين، وافتحوا غرفة." },
    ],
  }),
  component: Home,
});

function Home() {
  const games = (Route.useLoaderData() as GameCard[]).slice(0, 6);
  return (
    <Shell>
      <section className="mx-auto max-w-xl text-center">
        <h1 className="text-5xl font-extrabold text-[#00f2fe]">العش</h1>
        <p className="mt-3 text-sm font-extrabold text-[#8b5cf6]">حيث تلتقي التحديات بالمتعة الجماعية</p>
        <h2 className="mt-6 text-4xl font-extrabold leading-tight">ابدأ التحدي</h2>
        <div className="mt-8 grid gap-3">
          <Link to="/play" search={{ game: "" }} className="inline-flex min-h-14 items-center justify-center rounded-full bg-[#06b6d4] px-7 font-extrabold text-[#090d16] shadow-[0_0_24px_rgba(6,182,212,0.35)]">إنشاء غرفة</Link>
          <Link to="/join" className="inline-flex min-h-14 items-center justify-center rounded-full border border-[#8b5cf6] bg-[#131b2e] px-6 font-extrabold text-white">انضمام إلى غرفة</Link>
        </div>
      </section>
      <section className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-3">
        <Link to="/games/competitive" className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-start shadow-[0_0_20px_rgba(6,182,212,0.18)]">
          <span className="block text-lg font-extrabold text-[#06b6d4]">تحديات تنافسية</span>
          <span className="mt-1 block text-sm text-white/60">غرف جماعية، تحدي معلومات، وأسرع إجابة</span>
        </Link>
        <Link to="/questions" className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-start">
          <span className="block text-lg font-extrabold text-[#06b6d4]">بنك الأسئلة</span>
          <span className="mt-1 block text-sm text-white/60">تصفح وشاهد الأسئلة حسب الفئات</span>
        </Link>
        <Link to="/games/single-player" className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-start">
          <span className="block text-lg font-extrabold text-[#06b6d4]">لعب فردي</span>
          <span className="mt-1 block text-sm text-white/60">تخمين الصورة والشخصية وأسئلة الذكاء بلا غرفة</span>
        </Link>
      </section>
      <section className="mx-auto mt-12 max-w-xl">
        <h2 className="mb-4 text-2xl font-extrabold">كيف تلعب؟</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["1", "أنشئوا الغرفة", "للتنافس الجماعي فقط."],
            ["2", "اختاروا اللعبة", "أو ابدأ لعبة فردية مباشرة."],
            ["3", "العبوا واستمتعوا", "بلا انتظار في الوضع الفردي."],
          ].map(([n, title, body]) => (
            <article key={n} className="neon-card relative rounded-3xl p-4 text-center">
              <span className="absolute end-3 top-3 grid size-7 place-items-center rounded-full bg-neon text-xs font-extrabold text-night">{n}</span>
              <h3 className="mt-8 text-lg font-extrabold">{title}</h3>
              <p className="mt-2 text-sm text-ivory/65">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
