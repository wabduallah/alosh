import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/questions")({
  loader: () => listGames(),
  head: () => ({ meta: [{ title: "بنك الأسئلة — العش" }, { name: "description", content: "فئات الأسئلة المرتبطة بكل لعبة. الإدارة تستورد وتراجع قبل النشر." }] }),
  component: QuestionsPage,
});

function QuestionsPage() {
  const games = Route.useLoaderData() as GameCard[];
  const groups = new Map<string, GameCard[]>();
  for (const game of games) {
    const list = groups.get(game.category) ?? [];
    list.push(game);
    groups.set(game.category, list);
  }
  return (
    <Shell>
      <p className="text-xs font-extrabold tracking-[0.22em] text-neon">بنك الأسئلة</p>
      <h1 className="mt-2 text-4xl font-extrabold">بنك الأسئلة</h1>
      <p className="mt-3 max-w-2xl text-ivory/70">الأسئلة لا تُعرض دفعة واحدة. كل لعبة تسحب سؤال الجولة من البنك المنشور فقط، والاستيراد والتوليد يمران بمراجعة المدير قبل الاعتماد.</p>
      {!games.length ? <p className="mt-8 rounded-3xl border border-white/10 p-6 text-ivory/60">لا توجد ألعاب منشورة بعد.</p> : null}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...groups.entries()].map(([cat, rows]) => (
          <article key={cat} className="rounded-3xl border border-[#3D352B] bg-[#171513] p-5">
            <h2 className="text-xl font-extrabold text-[#E5C158]">{cat}</h2>
            <p className="mt-1 text-sm text-[#A89F91]">{rows.length} ألعاب</p>
            <ul className="mt-3 space-y-2">
              {rows.map((game) => (
                <li key={game.id}>
                  <Link to="/games/$slug" params={{ slug: game.id }} className="block rounded-2xl border border-[#3D352B] px-3 py-3">{game.nameAr}</Link>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Shell>
  );
}
