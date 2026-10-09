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
  Route.useLoaderData() as GameCard[];
  return (
    <Shell>
      <section className="mx-auto max-w-xl text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl text-neon" aria-hidden="true">🪺</span>
          <h1 className="text-5xl font-extrabold text-ivory">العش</h1>
        </div>
        <div className="mx-auto mt-6 h-px w-full bg-gradient-to-l from-transparent via-neon/50 to-transparent" />
        <p className="mt-3 text-sm font-extrabold text-neon">ألعاب مجانية بالكامل</p>
        <h2 className="mt-6 text-5xl font-extrabold leading-tight text-sand">اختاروا لعبتكم</h2>
        <p className="mt-4 text-lg text-ivory/70">لعب جماعي بسيط، ممتع، وجاهز في ثواني.</p>
        <div className="mx-auto mt-5 h-px w-40 bg-neon/40" />
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/join" className="inline-flex min-h-14 items-center gap-2 rounded-full border border-neon/40 px-6 font-extrabold">انضم</Link>
          <Link to="/play" search={{ game: "" }} className="inline-flex min-h-14 items-center gap-2 rounded-full bg-neon px-7 font-extrabold text-night">العب الآن</Link>
        </div>
      </section>
      <section className="mx-auto mt-12 max-w-xl">
        <div className="mb-4 flex items-center justify-between">
          <span className="grid size-8 place-items-center rounded-full border border-neon/40 text-sm">؟</span>
          <h2 className="text-2xl font-extrabold">كيف تلعب؟</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["1", "أنشئوا الغرفة", "استضف غرفة أو انضم إلى غرفة أصدقائك."],
            ["2", "اختاروا اللعبة", "اختاروا من مجموعة الألعاب الجماعية المفضلة لديكم."],
            ["3", "العبوا واستمتعوا", "لعبوا معاً، تنافسوا واصنعوا أجمل اللحظات."],
          ].map(([n, title, body]) => (
            <article key={n} className="neon-card relative rounded-3xl p-4 text-center">
              <span className="absolute end-3 top-3 grid size-7 place-items-center rounded-full bg-neon text-xs font-extrabold text-night">{n}</span>
              <h3 className="mt-8 text-lg font-extrabold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ivory/65">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
