import { createFileRoute } from "@tanstack/react-router";
import { HostScreen } from "@/components/arena";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

/** Shared display alias: the main board for a room on a TV or big screen. */
export const Route = createFileRoute("/tv/$code")({
  loader: () => listGames(),
  component: TvPage,
});

function TvPage() {
  const { code } = Route.useParams();
  const games = Route.useLoaderData() as GameCard[];
  return <HostScreen code={code.toUpperCase()} games={games} />;
}
