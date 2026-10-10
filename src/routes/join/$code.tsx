import { createFileRoute, redirect } from "@tanstack/react-router";

/** Join link (QR codes and shared links). Short link for a «الكذابون» room: forwards to the arena's pad view. */
export const Route = createFileRoute("/join/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/games/liars/arena",
      search: { code: params.code.trim().toUpperCase().slice(0, 8), view: "pad" },
      replace: true,
    });
  },
});
