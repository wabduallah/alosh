import { createFileRoute, Link } from "@tanstack/react-router";
import { GameIcon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/games/competitive")({
  loader: () => listGames(),
  head: () => ({ meta: [{ title: "ألعاب تنافسية — العش" }] }),
  component: CompetitivePage,
});

function CompetitivePage() {
  const games = (Route.useLoaderData() as GameCard[]).filter((game) => game.playMode !== "social" && game.category !== "act");
  return (
    <Shell>
      <h1 className="text-4xl font-extrabold text-[#67e8f9]">ألعاب تنافسية</h1>
      <p className="mt-2 text-[#94a3b8]">غرف جماعية. أنشئ غرفة وادعُ أصدقاءك.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <article key={game.id} className="flex flex-col rounded-3xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] p-4">
            <span className="grid size-12 place-items-center rounded-2xl border border-[rgb(255_255_255/0.08)] text-[#67e8f9]"><GameIcon name={game.icon} className="size-6" /></span>
            <h2 className="mt-3 text-lg font-extrabold">{game.nameAr}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-[#94a3b8]">{game.descriptionAr}</p>
            <p className="mt-2 text-sm text-[#67e8f9]">{game.minPlayers}–{game.maxPlayers} لاعبين</p>
            <Link to="/play" search={{ game: game.id }} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#06b6d4] font-extrabold text-black">إنشاء غرفة</Link>
          </article>
        ))}
      </div>
    </Shell>
  );
}
