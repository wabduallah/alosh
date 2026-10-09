import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CategoryCards, GameTile } from "@/components/game-tile";
import { Shell } from "@/components/shell";
import { CATALOG } from "@/lib/lamma/catalog";
import { useI18n } from "@/lib/i18n";
import { listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/games/")({
  validateSearch: (search: Record<string, unknown>) => ({
    cat: typeof search.cat === "string" ? search.cat : "",
  }),
  loader: () => listGames(),
  head: () => ({
    meta: [
      { title: "الألعاب — العش" },
      { name: "description", content: "تصنيفات ألعاب العش: جوال، تنافس، كلمات، عائلة، وأسئلة." },
    ],
  }),
  component: GamesPage,
});

function overlaps(game: GameCard, band: string) {
  if (band === "2-4") return game.minPlayers <= 4 && game.maxPlayers >= 2;
  if (band === "5-8") return game.minPlayers <= 8 && game.maxPlayers >= 5;
  if (band === "9-14") return game.maxPlayers >= 9;
  return true;
}

function GamesPage() {
  const games = Route.useLoaderData() as GameCard[];
  const { cat } = Route.useSearch();
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"all" | "free" | "premium">("all");
  const [shelf, setShelf] = useState(cat);
  const [band, setBand] = useState("all");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return games.filter((game) => {
      if (tier !== "all" && game.tier !== tier) return false;
      if (shelf && shelf !== "all" && shelf !== "mobile" && game.category !== shelf && game.playMode !== shelf) return false;
      if (!overlaps(game, band)) return false;
      if (!query) return true;
      const blob = `${game.nameAr} ${game.nameEn} ${game.descriptionAr} ${game.descriptionEn} ${game.category}`.toLowerCase();
      return blob.includes(query);
    });
  }, [games, q, tier, shelf, band]);
  const browsing = Boolean(q.trim() || tier !== "all" || shelf || band !== "all");
  const shelves = browsing
    ? [{ title: t("browse.all"), items: filtered }]
    : [
        { title: t("browse.all"), items: games },
        { title: t("browse.hot"), items: [...games].sort((a, b) => b.plays - a.plays).slice(0, 6) },
        { title: t("browse.newest"), items: [...games].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 6) },
        { title: t("browse.big"), items: games.filter((game) => game.maxPlayers >= 10) },
      ];
  return (
    <Shell>
      <p className="text-sm font-extrabold text-[#E5C158]">مكتبة العش</p>
      <h1 className="mt-1 text-4xl font-extrabold">الألعاب</h1>
      <p className="mt-2 max-w-2xl text-[#A89F91]">اختَر لعبة، ثم أنشئ غرفة أو ابدأ فردياً. كل الألعاب مجانية.</p>
      <label className="mt-6 block">
        <span className="sr-only">{t("browse.search")}</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("browse.search")}
          className="min-h-12 w-full rounded-full border border-[#3D352B] bg-[#171513] px-5 text-ivory outline-none placeholder:text-[#A89F91]"
        />
      </label>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {[
          ["all", t("browse.all")],
          ...CATALOG.map((item) => [item.id, lang === "en" ? item.en : item.ar] as const),
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === "free" || id === "premium") {
                setTier(id);
                setShelf("");
              } else if (id === "all") {
                setTier("all");
                setShelf("");
              } else {
                setShelf(id);
                setTier("all");
              }
            }}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-extrabold ${
              (id === tier || id === shelf || (id === "all" && tier === "all" && !shelf))
                ? "bg-neon text-night"
                : "border border-white/15 text-ivory/75"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {["all", "2-4", "5-8", "9-14"].map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setBand(id)}
            className={`min-h-10 rounded-full px-4 text-sm font-extrabold ${band === id ? "bg-ivory text-night" : "border border-white/15 text-ivory/70"}`}
          >
            {id === "all" ? t("browse.players", { min: 2, max: 14 }) : id}
          </button>
        ))}
      </div>
      <div className="mt-8">
        <CategoryCards active={shelf} />
      </div>
      {shelves.map((shelfBlock) => (
        <section key={shelfBlock.title} className="mt-10">
          <h2 className="text-2xl font-extrabold">{shelfBlock.title}</h2>
          {shelfBlock.items.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shelfBlock.items.map((game) => <GameTile key={`${shelfBlock.title}-${game.id}`} game={game} />)}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ivory/55">{t("browse.soon")}</p>
          )}
        </section>
      ))}
    </Shell>
  );
}
