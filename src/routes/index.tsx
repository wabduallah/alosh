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
  return (
    <Shell>
      <section className="mx-auto max-w-xl text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl text-neon" aria-hidden="true">🪺</span>
          <h1 className="text-5xl font-extrabold text-ivory">العش</h1>
        </div>
        <p className="mt-3 text-sm font-extrabold text-neon">ألعاب مجانية بالكامل</p>
        <h2 className="mt-6 text-4xl font-extrabold leading-tight">ابدأ التحدي</h2>
        <div className="mt-8 grid gap-3">
          <Link to="/play" search={{ game: "" }} className="inline-flex min-h-14 items-center justify-center rounded-full bg-[#D4AF37] px-7 font-extrabold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)]">إنشاء غرفة</Link>
          <Link to="/join" className="inline-flex min-h-14 items-center justify-center rounded-full border border-[#D4AF37] bg-[#171513] px-6 font-extrabold text-[#E5C158]">انضمام إلى غرفة</Link>
        </div>
      </section>
      <section className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-3">
        <Link to="/games/multiplayer" className="rounded-3xl border border-[#3D352B] bg-[#1B1917] p-5 text-start">
          <span className="block text-lg font-extrabold text-[#E5C158]">ألعاب تنافسية</span>
          <span className="mt-1 block text-sm text-[#A89F91]">غرف جماعية: فرق، تحدي معلومات، وأسرع إجابة</span>
        </Link>
        <Link to="/games/single-player" className="rounded-3xl border border-[#3D352B] bg-[#1B1917] p-5 text-start">
          <span className="block text-lg font-extrabold text-[#E5C158]">ألعاب فردية</span>
          <span className="mt-1 block text-sm text-[#A89F91]">خمن الصورة والشخصية وأسئلة الذكاء بلا غرفة</span>
        </Link>
        <Link to="/questions" className="rounded-3xl border border-[#3D352B] bg-[#1B1917] p-5 text-start">
          <span className="block text-lg font-extrabold text-[#E5C158]">بنك الأسئلة</span>
          <span className="mt-1 block text-sm text-[#A89F91]">تصفح الأسئلة حسب الفئات</span>
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
