import { createFileRoute, Link } from "@tanstack/react-router";
import { CategoryCards, GameTile } from "@/components/game-tile";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/")({
  loader: () => listGames(),
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "اختاروا لعبتكم، اقرأوا القوانين، وافتحوا غرفة. التلفزيون يعرض والجوال يتحكم." },
    ],
  }),
  component: Home,
});

function Home() {
  const games = Route.useLoaderData() as GameCard[];
  const { t } = useI18n();
  const featured = games.filter((game) => game.tier === "free").slice(0, 6);
  return (
    <Shell>
      <section className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-extrabold tracking-[0.28em] text-neon">{t("hero.kicker")}</p>
        <h1 className="mt-4 text-4xl font-extrabold leading-[1.2] sm:text-6xl">{t("hero.title")}</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-ivory/70">{t("hero.subtitle")}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/play" search={{ game: "" }}><Button type="button">{t("hero.start")}</Button></Link>
          <Link to="/join"><Button type="button" tone="glass">{t("hero.join")}</Button></Link>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-extrabold">{t("browse.title")}</h2>
        <div className="mt-4">
          <CategoryCards />
        </div>
      </section>

      <section id="how" className="mt-14 grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <article key={n} className="neon-card rounded-3xl p-5">
            <p className="text-xs font-extrabold text-neon">0{n}</p>
            <h2 className="mt-2 text-lg">{t(`how.${n}t`)}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ivory/65">{t(`how.${n}d`)}</p>
          </article>
        ))}
      </section>

      {featured.length ? (
        <section className="mt-14">
          <h2 className="text-2xl font-extrabold">{t("browse.freeShelf")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((game) => <GameTile key={game.id} game={game} />)}
          </div>
        </section>
      ) : null}
    </Shell>
  );
}
