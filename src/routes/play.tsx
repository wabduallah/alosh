import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  const [maxPlayers, setMaxPlayers] = useState(2);
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
    setMaxPlayers(Math.min(14, Math.max(2, game.minPlayers || 2)));
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

  const roundChoices = [10, 7, 5, 3];
  const timeChoices = [60, 20, 30, 10];
  return (
    <Shell>
      <header className="mb-5">
        <h1 className="text-3xl font-extrabold text-[#06b6d4]">إنشاء غرفة</h1>
        <p className="mt-1 text-sm text-[#A89F91]">مجانية بالكامل · حتى 14 لاعباً</p>
      </header>
      <form
        className="space-y-5 rounded-3xl border border-[#3D352B] bg-[#171513] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input className="sr-only" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="اسم المضيف" />
        <div>
          <p className="mb-2 font-extrabold">نوع الغرفة</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`min-h-14 rounded-2xl border font-extrabold ${hostMode === "narrator" ? "border-[#06b6d4] bg-[#06b6d4] text-black" : "border-[#3D352B] text-[#A89F91]"}`} onClick={() => setHostMode("narrator")}>المضيف يدير فقط</button>
            <button type="button" className={`min-h-14 rounded-2xl border font-extrabold ${hostMode === "player" ? "border-[#06b6d4] bg-[#06b6d4] text-black" : "border-[#3D352B] text-[#A89F91]"}`} onClick={() => setHostMode("player")}>المضيف يشارك</button>
          </div>
        </div>
        <div>
          <p className="mb-2 font-extrabold">عدد الجولات</p>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-[#3D352B] p-1">
            {roundChoices.map((n) => (
              <button key={n} type="button" className={`min-h-12 rounded-xl font-extrabold ${rounds === n ? "bg-[#06b6d4] text-black" : "text-[#A89F91]"}`} onClick={() => setRounds(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-extrabold">الوقت لكل جولة</p>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-[#3D352B] p-1">
            {timeChoices.map((n) => (
              <button key={n} type="button" className={`min-h-12 rounded-xl font-extrabold ${seconds === n ? "bg-[#06b6d4] text-black" : "text-[#A89F91]"}`} onClick={() => setSeconds(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-extrabold">مستوى الصعوبة</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["medium", "متوسط"],
              ["hard", "صعب"],
              ["mixed", "مزيج"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" className={`min-h-12 rounded-2xl border font-extrabold ${difficulty === id ? "border-[#06b6d4] bg-[#06b6d4] text-black" : "border-[#3D352B] text-[#A89F91]"}`} onClick={() => setDifficulty(id)}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-extrabold">عدد اللاعبين</p>
          <div className="grid grid-cols-3 items-center rounded-2xl border border-[#3D352B]">
            <button type="button" className="min-h-12 text-xl" onClick={() => setMaxPlayers((n) => Math.max(selected?.minPlayers ?? 2, n - 1))}>−</button>
            <span className="text-center text-2xl font-extrabold text-[#06b6d4]">{maxPlayers}</span>
            <button type="button" className="min-h-12 text-xl" onClick={() => setMaxPlayers((n) => Math.min(14, n + 1))}>+</button>
          </div>
          <p className="mt-2 text-sm text-[#A89F91]">{selected?.minPlayers ?? 2}–14 لاعباً</p>
        </div>
        {error ? <p className="text-sm text-[#06b6d4]">{error}</p> : null}
        <button type="submit" disabled={busy || !gameId} className="min-h-12 w-full rounded-full bg-[#06b6d4] font-extrabold text-black disabled:opacity-40">ابدأ</button>
      </form>
    </Shell>
  );
}
