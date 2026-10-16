import { createFileRoute } from "@tanstack/react-router";

/**
 * Better Auth endpoint left over from the project template. The site does not use it: players
 * sign in anonymously and admins sign in by email, both through Supabase. Left open, anyone could
 * create accounts here in the template's own tables, so it answers 404 unless a deployment turns
 * it on on purpose with LEGACY_BETTER_AUTH=on (server-only variable).
 */
const enabled = () => process.env.LEGACY_BETTER_AUTH?.trim() === "on";
const notFound = () => new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });

async function handle(request: Request) {
  if (!enabled()) return notFound();
  const { auth } = await import("@/lib/auth/server");
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
