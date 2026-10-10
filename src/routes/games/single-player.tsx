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
      <h1 className="text-4xl font-extrabold text-[#67e8f9]">ألعاب فردية</h1>
      <p className="mt-2 text-[#94a3b8]">تبدأ فوراً بدون غرفة وبدون انتظار لاعبين.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <Link key={game.id} to="/solo/$id" params={{ id: game.id }} className="flex flex-col rounded-3xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] p-4">
            <span className="text-lg font-extrabold">{game.nameAr}</span>
            <span className="mt-1 line-clamp-2 text-sm text-[#94a3b8]">{game.descriptionAr}</span>
            <span className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-[#06b6d4] text-sm font-extrabold text-black">العب الآن</span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
