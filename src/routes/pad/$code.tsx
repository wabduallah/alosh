import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old short link (/pad/CODE). No game uses it now, so it returns to the homepage. */
export const Route = createFileRoute("/pad/$code")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
