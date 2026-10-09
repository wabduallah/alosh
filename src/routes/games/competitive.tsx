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
      <h1 className="text-4xl font-extrabold text-[#E5C158]">ألعاب تنافسية</h1>
      <p className="mt-2 text-[#A89F91]">غرف جماعية. أنشئ غرفة وادعُ أصدقاءك.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <article key={game.id} className="flex flex-col rounded-3xl border border-[#3D352B] bg-[#171513] p-4">
            <span className="grid size-12 place-items-center rounded-2xl border border-[#3D352B] text-[#E5C158]"><GameIcon name={game.icon} className="size-6" /></span>
            <h2 className="mt-3 text-lg font-extrabold">{game.nameAr}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-[#A89F91]">{game.descriptionAr}</p>
            <p className="mt-2 text-sm text-[#E5C158]">{game.minPlayers}–{game.maxPlayers} لاعبين</p>
            <Link to="/play" search={{ game: game.id }} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#D4AF37] font-extrabold text-black">إنشاء غرفة</Link>
          </article>
        ))}
      </div>
    </Shell>
  );
}
