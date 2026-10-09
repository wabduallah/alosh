import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/games/single-player")({
  loader: () => listGames(),
  head: () => ({ meta: [{ title: "ألعاب فردية — العش" }] }),
  component: SoloPage,
});

function SoloPage() {
  const games = (Route.useLoaderData() as GameCard[]).filter((game) => game.category === "act" || game.category === "trivia" || game.category === "words");
  return (
    <Shell>
      <h1 className="text-4xl font-extrabold text-[#E5C158]">ألعاب فردية</h1>
      <p className="mt-2 text-[#A89F91]">تبدأ فوراً بدون غرفة وبدون انتظار لاعبين.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {games.map((game) => (
          <Link key={game.id} to="/solo/$id" params={{ id: game.id }} className="rounded-3xl border border-[#3D352B] bg-[#1B1917] p-4">
            <span className="block text-lg font-extrabold">{game.nameAr}</span>
            <span className="mt-1 block text-sm text-[#A89F91]">{game.descriptionAr}</span>
            <span className="mt-3 inline-flex rounded-full bg-neon px-4 py-2 text-sm font-extrabold text-night">العب الآن</span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
