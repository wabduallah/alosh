import { createFileRoute } from "@tanstack/react-router";
import { CATALOG } from "@/lib/catalog";

/** Public pages worth finding in search: home, the games list, one page per game, and the join and create pages. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const urls = ["", "/games", ...CATALOG.map((g) => `/games/${g.id}`), "/play", "/duel", "/join", "/faq", "/privacy", "/copyright"];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n")}
</urlset>`;
        return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
      },
    },
  },
});
