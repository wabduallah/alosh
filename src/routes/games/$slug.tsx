import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Button, cx } from "@/components/ui";
import { CATEGORY_LABELS, SITE_URL, getGame, playerRange } from "@/lib/games";
import { trackEvent } from "@/lib/analytics";

export const Route = createFileRoute("/games/$slug")({
  head: ({ params }) => {
    const game = getGame(params.slug);
    if (!game) return { meta: [{ title: "لعبة غير موجودة — العش" }] };
    const { min, max } = playerRange(game.players);
    // Structured data for search engines. Only this page gets it; the site-wide
    // shell stays untouched.
    const structured = {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: game.title,
      description: game.blurb,
      url: `${SITE_URL}/games/${game.id}`,
      inLanguage: "ar",
      gamePlatform: "Web browser",
      numberOfPlayers: { "@type": "QuantitativeValue", minValue: min, maxValue: max },
      offers: { "@type": "Offer", price: "0", priceCurrency: "SAR" },
    };
    return {
      meta: [
        { title: `${game.title} — العش` },
        { name: "description", content: game.blurb },
      ],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(structured) }],
    };
  },
  component: GamePage,
});

function GamePage() {
  const { slug } = Route.useParams();
  const game = getGame(slug);

  if (!game) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl text-center">
          <h1 className="text-3xl font-extrabold text-ivory">هذه اللعبة غير موجودة</h1>
          <p className="mt-3 text-muted">ربما تغيّر الرابط. تفضّل بالألعاب المتاحة.</p>
          <Link to="/" hash="games" className="mt-6 inline-flex">
            <Button tone="primary">إلى الألعاب</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  async function share() {
    trackEvent("share_game", game!.id);
    const url = window.location.href;
    const text = `${game!.title} على العش: ${game!.blurb}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: game!.title, text, url });
        return;
      } catch {
        // The user closed the share sheet. Nothing else to do.
        return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
  }

  return (
    <Shell>
      <nav aria-label="مسار الصفحة" className="mx-auto max-w-3xl text-sm text-muted">
        <Link to="/" className="hover:text-neon">الرئيسية</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <Link to="/" hash="games" className="hover:text-neon">الألعاب</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-ivory">{game.title}</span>
      </nav>

      <article className="mx-auto mt-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="text-4xl" aria-hidden="true">{game.icon}</span>
          <div>
            <h1 className="text-3xl font-extrabold text-ivory">{game.title}</h1>
            <p className="mt-1 text-sm text-muted">
              👥 {game.players} لاعب · {CATEGORY_LABELS[game.category]}
            </p>
          </div>
        </div>

        <div className="mt-6 aspect-video overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          {game.image ? (
            <img src={game.image} alt={`لقطة من ${game.title}`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-6xl" aria-hidden="true">
              {game.icon}
            </div>
          )}
        </div>

        <p className="mt-6 text-lg leading-8 text-ivory/90">{game.blurb}</p>

        {game.howTo ? (
          <section aria-labelledby="rules-title" className="glass-card mt-6 rounded-3xl p-5 sm:p-6">
            <h2 id="rules-title" className="text-xl font-extrabold text-ivory">كيف تُلعب؟</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              <span className="font-bold text-ivory">الهدف:</span> {game.howTo.goal}
            </p>
            <p className="mt-1 text-sm leading-7 text-muted">
              <span className="font-bold text-ivory">المدة التقريبية:</span> {game.howTo.minutes}
            </p>
            <ol className="mt-4 space-y-3">
              {game.howTo.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-7 text-ivory/85">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neon/15 font-bold text-neon">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <div className={cx("mt-8 flex flex-wrap gap-3", !game.live && "items-center")}>
          {game.live ? (
            <Link to="/play" search={{ game: game.id }} onClick={() => trackEvent("start_room", game.id)}>
              <Button tone="violet">ابدأ الغرفة</Button>
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-full border border-white/10 px-5 text-sm font-bold text-muted">
              قريبًا
            </span>
          )}
          <Button tone="glass" onClick={share}>
            شارك اللعبة
          </Button>
        </div>
      </article>
    </Shell>
  );
}
