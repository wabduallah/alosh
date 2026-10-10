import { createFileRoute, redirect } from "@tanstack/react-router";

/** TV / big screen (display only). Short link for a «الكذابون» room: forwards to the arena's tv view. */
export const Route = createFileRoute("/tv/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/games/liars/arena",
      search: { code: params.code.trim().toUpperCase().slice(0, 8), view: "tv" },
      replace: true,
    });
  },
});
