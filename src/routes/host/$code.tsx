import { createFileRoute, redirect } from "@tanstack/react-router";

/** Host screen with controls. Short link for a «الكذابون» room: forwards to the arena's host view. */
export const Route = createFileRoute("/host/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/games/liars/arena",
      search: { code: params.code.trim().toUpperCase().slice(0, 8), view: "host" },
      replace: true,
    });
  },
});
