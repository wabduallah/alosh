import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { GameIcon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { Button, Field, inputClass } from "@/components/ui";
import { CATALOG } from "@/lib/lamma/catalog";
import { useI18n } from "@/lib/i18n";
import { createRoom, listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

export const Route = createFileRoute("/play")({
  validateSearch: (search: Record<string, unknown>) => ({
    game: typeof search.game === "string" ? search.game : "",
  }),
  loader: () => listGames(),
  head: () => ({ meta: [{ title: "إنشاء لعبة — العش" }] }),
  component: CreatePage,
});

function CreatePage() {
  const games = Route.useLoaderData() as GameCard[];
  const search = Route.useSearch();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const picked = games.find((game) => game.id === search.game) ?? games[0];
  const [hostName, setHostName] = useState("");
  const [gameId, setGameId] = useState(picked?.id ?? "");
  const [shelf, setShelf] = useState(picked?.category || "words");
  const [rounds, setRounds] = useState(picked?.rounds ?? 6);
  const [seconds, setSeconds] = useState(picked?.seconds ?? 30);
  const [maxPlayers, setMaxPlayers] = useState(picked?.maxPlayers ?? 14);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [sound, setSound] = useState(true);
  const [music, setMusic] = useState(false);
  const [promo, setPromo] = useState("");
  const [hostMode, setHostMode] = useState<"player" | "narrator">("player");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = games.find((game) => game.id === gameId);
  const shelves = useMemo(
    () => CATALOG.filter((cat) => games.some((game) => game.category === cat.id)),
    [games],
  );
  const shown = games
    .filter((game) => game.category === shelf)
    .sort((a, b) => Number(a.tier === "premium") - Number(b.tier === "premium"));

  function choose(game: GameCard) {
    setGameId(game.id);
    setSeconds(game.seconds);
    setRounds(game.rounds);
    setMaxPlayers(game.maxPlayers);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await createRoom({
      data: { gameId, rounds, seconds, difficulty, sound, music, maxPlayers, locale: lang, promo: promo || undefined, hostName, hostMode },
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(`err.${res.error}`));
      return;
    }
    sessionStorage.setItem(`lamma:host:${res.code}`, res.hostToken);
    if (res.playerToken) sessionStorage.setItem(`lamma:player:${res.code}`, res.playerToken);
    void navigate({ to: "/host/$code", params: { code: res.code } });
  }

  return (
    <Shell>
      <h1 className="text-4xl font-extrabold sm:text-5xl">{t("create.title")}</h1>
      <p className="mt-3 max-w-2xl text-ivory/70">{t("create.lead")}</p>
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {shelves.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setShelf(cat.id)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-extrabold ${shelf === cat.id ? "bg-neon text-night" : "border border-white/15 text-ivory/80"}`}
          >
            <GameIcon name={cat.icon} className="size-4" />
            {lang === "en" ? cat.en : cat.ar}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.map((game) => {
            const active = gameId === game.id;
            const premium = game.tier === "premium";
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => choose(game)}
                className={`neon-card flex items-center gap-3 rounded-2xl px-3 py-3 text-start ${active ? "border-neon" : ""} ${premium ? "gold-card" : ""}`}
              >
                <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${premium ? "bg-gold/15 text-gold" : "bg-neon/15 text-neon"}`}>
                  <GameIcon name={game.icon} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-extrabold">{lang === "en" ? game.nameEn : game.nameAr}</span>
                  <span className="block text-xs text-ivory/60">
                    {t("browse.players", { min: game.minPlayers, max: game.maxPlayers })} · {premium ? t("tier.premium") : t("tier.free")}
                  </span>
                </span>
              </button>
            );
          })}
          {shown.length === 0 ? <p className="text-sm text-ivory/60">{t("browse.soon")}</p> : null}
        </div>
        <form
          className="neon-card space-y-4 rounded-3xl p-5 lg:sticky lg:top-24 lg:self-start"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-lg font-extrabold">{selected ? (lang === "en" ? selected.nameEn : selected.nameAr) : t("create.game")}</p>
          {selected ? (
            <p className="text-sm text-ivory/65">
              {t(`mode.${selected.playMode}`)} · {t("browse.minutes", { min: selected.durationMin, max: selected.durationMax })}
            </p>
          ) : null}
          <Field label={t("create.hostName")}>
            <input className={inputClass} value={hostName} onChange={(e) => setHostName(e.target.value)} required minLength={2} maxLength={16} />
          </Field>
          <Field label={t("create.players")}>
            <input className={inputClass} type="number" min={selected?.minPlayers ?? 2} max={14} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
          </Field>
          <Field label={t("create.diff")}>
            <select className={inputClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
              {(["mixed", "easy", "medium", "hard"] as const).map((item) => (
                <option key={item} value={item}>{t(`diff.${item}`)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("create.time")}>
            <input className={inputClass} type="number" min={8} max={180} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          </Field>
          <Field label={t("create.rounds")}>
            <input className={inputClass} type="number" min={1} max={15} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
          </Field>
          <label className="flex items-center justify-between text-sm">
            {t("create.sfx")}
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-sm">
            {t("create.music")}
            <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
          </label>
          <Field label="وضع المضيف">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`min-h-11 rounded-2xl font-extrabold ${hostMode === "player" ? "bg-neon text-night" : "border border-white/15"}`} onClick={() => setHostMode("player")}>{t("hostMode.player")}</button>
              <button type="button" className={`min-h-11 rounded-2xl font-extrabold ${hostMode === "narrator" ? "bg-neon text-night" : "border border-white/15"}`} onClick={() => setHostMode("narrator")}>{t("hostMode.narrator")}</button>
            </div>
          </Field>
          <Field label={t("create.promo")}>
            <input className={inputClass} value={promo} onChange={(e) => setPromo(e.target.value)} />
          </Field>
          {error ? <p className="text-sm text-gold">{error}</p> : null}
          <Button type="submit" disabled={busy || !gameId || hostName.trim().length < 2}>{t("create.submit")}</Button>
        </form>
      </div>
    </Shell>
  );
}
