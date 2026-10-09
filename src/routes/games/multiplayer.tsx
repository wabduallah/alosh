import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/games/multiplayer")({
  loader: () => listGames(),
  head: () => ({ meta: [{ title: "ألعاب تنافسية — العش" }] }),
  component: MultiPage,
});

function MultiPage() {
  const games = (Route.useLoaderData() as GameCard[]).filter((game) => game.playMode === "competitive" || game.playMode === "teams" || game.category === "competitive");
  return (
    <Shell>
      <h1 className="text-4xl font-extrabold text-[#E5C158]">ألعاب تنافسية</h1>
      <p className="mt-2 text-[#A89F91]">هذه الألعاب تفتح غرفة وتحتاج أصدقاء.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {games.map((game) => (
          <Link key={game.id} to="/play" search={{ game: game.id }} className="rounded-3xl border border-[#3D352B] bg-[#1B1917] p-4">
            <span className="block text-lg font-extrabold">{game.nameAr}</span>
            <span className="mt-1 block text-sm text-[#A89F91]">{game.descriptionAr}</span>
            <span className="mt-3 inline-flex rounded-full bg-neon px-4 py-2 text-sm font-extrabold text-night">إنشاء غرفة</span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
