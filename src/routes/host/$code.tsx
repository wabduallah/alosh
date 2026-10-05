import { createFileRoute } from "@tanstack/react-router";
import { HostScreen } from "@/components/arena";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/host/$code")({
  loader: () => listGames(),
  component: HostPage,
});

function HostPage() {
  const { code } = Route.useParams();
  const games = Route.useLoaderData() as GameCard[];
  return <HostScreen code={code.toUpperCase()} games={games} />;
}
