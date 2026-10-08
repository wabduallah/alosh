import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/rank")({
  loader: () => listGames(),
  head: () => ({ meta: [{ title: "التصنيف — العش" }] }),
  component: RankPage,
});

function RankPage() {
  const games = [...(Route.useLoaderData() as GameCard[])].sort((a, b) => b.plays - a.plays);
  return (
    <Shell>
      <p className="text-xs font-extrabold tracking-[0.22em] text-neon">LEADERBOARD</p>
      <h1 className="mt-2 text-4xl font-extrabold">التصنيف</h1>
      <p className="mt-3 max-w-2xl text-ivory/70">ترتيب الألعاب حسب عدد الغرف التي فُتحت. نقاط اللاعبين تُحسب داخل كل غرفة ولا تُجمع علنًا إلا بعد انتهاء الجولة.</p>
      {!games.length ? <p className="mt-8 rounded-3xl border border-dashed border-white/15 p-6">لا توجد مباريات بعد.</p> : null}
      <ol className="mt-6 space-y-2">
        {games.map((game, index) => (
          <li key={game.id} className="neon-card flex items-center gap-3 rounded-3xl px-4 py-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-neon font-extrabold text-night">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <Link to="/games/$slug" params={{ slug: game.id }} className="font-extrabold">{game.nameAr}</Link>
              <p className="text-sm text-ivory/55">{game.playMode} · {game.minPlayers}–{game.maxPlayers}</p>
            </div>
            <span className="tabular-nums text-neon">{game.plays}</span>
          </li>
        ))}
      </ol>
    </Shell>
  );
}
