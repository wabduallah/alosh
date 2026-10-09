import { createFileRoute, Link } from "@tanstack/react-router";
import { GameIcon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { getGame } from "@/lib/lamma/rpc";

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
  return (
    <Shell>
      <article className="mx-auto max-w-3xl">
        <p className="text-sm font-extrabold text-[#67e8f9]">{t(`cat.${game.category}`)}</p>
        <div className="mt-4 flex items-center gap-4 rounded-3xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] p-4">
          <span className="grid size-16 place-items-center rounded-2xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] text-[#67e8f9]">
            <GameIcon name={game.icon} className="size-8" />
          </span>
          <div>
            <h1 className="text-4xl font-extrabold">{name}</h1>
            <p className="mt-1 text-sm text-[#94a3b8]">{game.minPlayers}–{game.maxPlayers} لاعبين</p>
          </div>
        </div>
        <p className="mt-5 text-lg leading-relaxed text-ivory/75">{desc}</p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            [t("create.players"), t("browse.players", { min: game.minPlayers, max: game.maxPlayers })],
            [t("browse.minutes", { min: game.durationMin, max: game.durationMax }), t(`mode.${game.playMode}`)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] px-4 py-3">
              <dt className="text-xs text-[#94a3b8]">{label}</dt>
              <dd className="mt-1 font-extrabold text-[#67e8f9]">{value}</dd>
            </div>
          ))}
        </dl>
        <section className="mt-8 rounded-3xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] p-5">
          <h2 className="text-2xl font-extrabold">{t("browse.how")}</h2>
          <ol className="mt-3 space-y-2 text-ivory/80">
            {how.map((line, index) => <li key={line}>{index + 1}. {line}</li>)}
          </ol>
        </section>
        <section className="mt-4 rounded-3xl border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.03)] p-5">
          <h2 className="text-2xl font-extrabold">{t("browse.rules")}</h2>
          <ul className="mt-3 space-y-2 text-ivory/80">
            {rules.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link to="/play" search={{ game: game.id }} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#06b6d4] font-extrabold text-black">إنشاء غرفة</Link>
          <Link to="/games" search={{ cat: "" }} className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#06b6d4] text-[#67e8f9]">العودة للألعاب</Link>
        </div>
      </article>
    </Shell>
  );
}
