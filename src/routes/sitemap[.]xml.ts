import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { listGamesNow } = await import("@/lib/lamma/engine.server");
        const origin = new URL(request.url).origin;
        const games = await listGamesNow().catch(() => []);
        const urls = ["", "/games", "/play", "/join", "/premium", ...games.map((game) => `/games/${game.id}`)];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n")}
</urlset>`;
        return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
      },
    },
  },
});
