import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HostScreen, PadScreen } from "@/components/arena";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

/**
 * One room route for everyone. The browser that created the room holds the host token
 * (sessionStorage), so it opens the host screen; every other device opens the player pad.
 */
export const Route = createFileRoute("/room/$code")({
  loader: () => listGames(),
  component: RoomPage,
});

function RoomPage() {
  const { code } = Route.useParams();
  const games = Route.useLoaderData() as GameCard[];
  const roomCode = code.toUpperCase();
  // Decide on the client only: sessionStorage does not exist during server rendering.
  const [role, setRole] = useState<"host" | "player" | null>(null);

  useEffect(() => {
    try {
      setRole(sessionStorage.getItem(`lamma:host:${roomCode}`) ? "host" : "player");
    } catch {
      setRole("player");
    }
  }, [roomCode]);

  if (role === null) return <p className="py-16 text-center text-muted">جارٍ فتح الغرفة…</p>;
  if (role === "host") return <HostScreen code={roomCode} games={games} />;
  return <PadScreen code={roomCode} />;
}
