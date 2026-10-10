import { createFileRoute, redirect } from "@tanstack/react-router";

/** Player phone. Short link for a «الكذابون» room: forwards to the arena's pad view. */
export const Route = createFileRoute("/pad/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/games/liars/arena",
      search: { code: params.code.trim().toUpperCase().slice(0, 8), view: "pad" },
      replace: true,
    });
  },
});
