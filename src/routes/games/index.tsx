import { createFileRoute, redirect } from "@tanstack/react-router";

/** The game list lives on the home page. This keeps /games links working. */
export const Route = createFileRoute("/games/")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "games" });
  },
});
