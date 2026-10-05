import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useI18n } from "@/lib/i18n";
import { getGame, getProfile, toggleFavorite } from "@/lib/lamma/rpc";

export const Route = createFileRoute("/games/$slug")({
  loader: ({ params }) => getGame({ data: { id: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.nameAr} — العش` : "العش" },
      { name: "description", content: loaderData?.descriptionAr ?? "" },
    ],
  }),
  component: GamePage,
});

function lines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function GamePage() {
  const game = Route.useLoaderData();
  const { t, lang } = useI18n();
  const { user } = useCurrentUserState();
  const [premium, setPremium] = useState(false);
  useEffect(() => {
    if (!user) return;
    void getProfile().then((result) => {
      if (result.ok) setPremium(result.profile.premium || result.profile.role === "admin");
    });
  }, [user]);
  if (!game) {
    return (
      <Shell>
        <p>{t("err.GAME")}</p>
      </Shell>
    );
  }
  const name = lang === "en" ? game.nameEn : game.nameAr;
  const desc = lang === "en" ? game.descriptionEn : game.descriptionAr;
  const rules = lines(lang === "en" ? game.rulesEn : game.rulesAr);
  const how = lines(lang === "en" ? game.howEn : game.howAr);
  const locked = game.tier === "premium" && !premium;
  return (
    <Shell>
      <article className="mx-auto max-w-3xl">
        <p className="text-sm text-neon">{t(`cat.${game.category}`)}</p>
        <div className="mt-4 flex items-center gap-4">
          <span className={`grid size-16 place-items-center rounded-2xl ${game.tier === "premium" ? "bg-gold/15 text-gold" : "bg-neon/15 text-neon"}`}>
            <GameIcon name={game.icon} className="size-8" />
          </span>
          <div>
            <h1 className="text-4xl font-extrabold">{name}</h1>
            <p className="mt-1 text-sm text-ivory/60">{game.tier === "premium" ? t("tier.premium") : t("tier.free")}</p>
          </div>
        </div>
        <p className="mt-5 text-lg leading-relaxed text-ivory/75">{desc}</p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            [t("create.players"), t("browse.players", { min: game.minPlayers, max: game.maxPlayers })],
            [t("browse.minutes", { min: game.durationMin, max: game.durationMax }), t(`mode.${game.playMode}`)],
          ].map(([label, value]) => (
            <div key={label} className="neon-card rounded-2xl px-4 py-3">
              <dt className="text-xs text-ivory/50">{label}</dt>
              <dd className="mt-1 font-extrabold">{value}</dd>
            </div>
          ))}
        </dl>
        <section className="mt-8">
          <h2 className="text-2xl font-extrabold">{t("browse.how")}</h2>
          <ol className="mt-3 space-y-2 text-ivory/80">
            {how.map((line, index) => <li key={line}>{index + 1}. {line}</li>)}
          </ol>
        </section>
        <section className="mt-8">
          <h2 className="text-2xl font-extrabold">{t("browse.rules")}</h2>
          <ul className="mt-3 space-y-2 text-ivory/80">
            {rules.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <section className="neon-card mt-8 rounded-3xl p-5">
          <h2 className="text-xl font-extrabold">{t("browse.setup")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ivory/70">{t("how.2d")}</p>
        </section>
        <div className="mt-6 flex flex-wrap gap-3">
          {locked ? (
            <Link to="/premium"><Button type="button" tone="bronze">{t("browse.subscribe")}</Button></Link>
          ) : (
            <Link to="/play" search={{ game: game.id }}><Button type="button">{t("hero.start")}</Button></Link>
          )}
          <Link to="/games" search={{ cat: "" }}><Button type="button" tone="glass">{t("browse.back")}</Button></Link>
          {user ? (
            <Button type="button" tone="glass" onClick={() => void toggleFavorite({ data: { gameId: game.id } })}>
              {t("profile.favorites")}
            </Button>
          ) : null}
        </div>
        {locked ? <p className="mt-4 text-gold">{t("browse.locked")}</p> : null}
      </article>
    </Shell>
  );
}
