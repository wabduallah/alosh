import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { cx, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { createRoom, listGames } from "@/lib/lamma/rpc";
import type { GameCard } from "@/lib/lamma/types";

/** Room size rules (mirrored on the server in engine.server.ts / rpc.ts). */
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 14;
const DEFAULT_PLAYERS = 2;

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
  const [rounds, setRounds] = useState(picked?.rounds ?? 6);
  const [seconds, setSeconds] = useState(picked?.seconds ?? 30);
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_PLAYERS);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [sound, setSound] = useState(true);
  const [music, setMusic] = useState(false);
  const [promo, setPromo] = useState("");
  const [pointsPerCorrect, setPointsPerCorrect] = useState(0);
  const [targetScore, setTargetScore] = useState(0);
  const [streakMultiplier, setStreakMultiplier] = useState(false);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [reactionBonus, setReactionBonus] = useState(false);
  const [majorityMode, setMajorityMode] = useState(false);
  const [hostIsPlayer, setHostIsPlayer] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = games.find((game) => game.id === gameId);
  // A game can require more seats than the global floor; never let the stepper go below it.
  const floor = Math.max(MIN_PLAYERS, selected?.minPlayers ?? MIN_PLAYERS);
  const shownCount = Math.min(MAX_PLAYERS, Math.max(floor, maxPlayers));

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await createRoom({
      data: {
        gameId,
        rounds,
        seconds,
        difficulty,
        sound,
        music,
        maxPlayers: shownCount,
        pointsPerCorrect,
        targetScore,
        streakMultiplier,
        eliminationMode,
        reactionBonus,
        majorityMode,
        locale: lang,
        promo: promo || undefined,
        hostName: hostIsPlayer ? hostName.trim() || undefined : undefined,
        hostIsPlayer,
        hostMode: hostIsPlayer ? "player" : "narrator",
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(`err.${res.error}`));
      return;
    }
    sessionStorage.setItem(`lamma:host:${res.code}`, res.hostToken);
    if (res.playerToken) sessionStorage.setItem(`lamma:player:${res.code}`, res.playerToken);
    void navigate({ to: "/room/$code", params: { code: res.code } });
  }

  const roundChoices = [10, 7, 5, 3];
  const timeChoices = [60, 20, 30, 10];
  const segment = (active: boolean) =>
    cx(
      "min-h-12 rounded-xl font-bold transition-all duration-150",
      active ? "bg-neon text-night shadow-[0_0_16px_rgb(6_182_212/0.35)]" : "text-muted hover:text-ivory",
    );
  const card = (active: boolean) =>
    cx(
      "min-h-14 rounded-2xl border font-bold transition-all duration-150",
      active ? "border-neon bg-neon text-night shadow-[0_0_16px_rgb(6_182_212/0.35)]" : "border-white/10 bg-white/[0.03] text-muted hover:border-neon/40 hover:text-ivory",
    );

  return (
    <Shell>
      <header className="mb-5">
        <h1 className="text-3xl font-extrabold text-neon">إنشاء غرفة</h1>
        <p className="mt-1 text-sm text-muted">مجانية بالكامل · من {MIN_PLAYERS} إلى {MAX_PLAYERS} لاعباً</p>
      </header>
      <form
        className="glass-card space-y-5 rounded-3xl p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <p className="mb-2 font-bold">نوع الغرفة</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={card(!hostIsPlayer)} onClick={() => setHostIsPlayer(false)}>
              المضيف يدير فقط
            </button>
            <button type="button" className={card(hostIsPlayer)} onClick={() => setHostIsPlayer(true)}>
              المضيف يشارك
            </button>
          </div>
          {hostIsPlayer ? (
            <label className="mt-3 block space-y-1">
              <span className="text-sm text-muted">اسمك في اللعبة (اختياري)</span>
              <input
                className={inputClass}
                value={hostName}
                maxLength={16}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="المضيف"
              />
            </label>
          ) : null}
        </div>
        <div>
          <p className="mb-2 font-bold">عدد الجولات</p>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
            {roundChoices.map((n) => (
              <button key={n} type="button" className={segment(rounds === n)} onClick={() => setRounds(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">الوقت لكل جولة</p>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
            {timeChoices.map((n) => (
              <button key={n} type="button" className={segment(seconds === n)} onClick={() => setSeconds(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">مستوى الصعوبة</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["medium", "متوسط"],
              ["hard", "صعب"],
              ["mixed", "مزيج"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" className={card(difficulty === id)} onClick={() => setDifficulty(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">مضاعف الإجابات المتتالية</p>
          <p className="mb-2 text-sm text-muted">إجابتان صحيحتان متتاليتان تضاعفان الإجابة التالية، وأربع تُثلّثانها (بحد أقصى ×3).</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={card(!streakMultiplier)} onClick={() => setStreakMultiplier(false)}>بدون</button>
            <button type="button" className={card(streakMultiplier)} onClick={() => setStreakMultiplier(true)}>تفعيل</button>
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">مكافأة سرعة الإجابة</p>
          <p className="mb-2 text-sm text-muted">الإجابة الفورية تضاعف النقاط (×2)، وتنخفض المكافأة كلما تأخرت.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={card(!reactionBonus)} onClick={() => setReactionBonus(false)}>بدون</button>
            <button type="button" className={card(reactionBonus)} onClick={() => setReactionBonus(true)}>تفعيل</button>
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">التخمين الجماعي</p>
          <p className="mb-2 text-sm text-muted">الإجابة التي اختارها أكثر اللاعبين هي الصحيحة، ويكسب من وافقها. التعادل لا يكسب أحد.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={card(!majorityMode)} onClick={() => setMajorityMode(false)}>بدون</button>
            <button type="button" className={card(majorityMode)} onClick={() => setMajorityMode(true)}>تفعيل</button>
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">الإقصاء السريع</p>
          <p className="mb-2 text-sm text-muted">في كل جولة يخرج من أخطأ أو لم يجب، إذا أجاب أحدهم صحيحاً. يفوز آخر لاعب باقٍ. يُناسب ألعاب الاختيار من متعدد.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={card(!eliminationMode)} onClick={() => setEliminationMode(false)}>بدون</button>
            <button type="button" className={card(eliminationMode)} onClick={() => setEliminationMode(true)}>تفعيل</button>
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">نقاط الإجابة الصحيحة</p>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
            {[0, 50, 100, 200].map((n) => (
              <button key={n} type="button" className={segment(pointsPerCorrect === n)} onClick={() => setPointsPerCorrect(n)}>
                {n === 0 ? "حسب اللعبة" : n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">حد النقاط للفوز</p>
          <p className="mb-2 text-sm text-muted">تنتهي اللعبة فور وصول أحد اللاعبين إلى الحد، أو عند آخر جولة أيهما أسبق.</p>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
            {[0, 300, 500, 1000].map((n) => (
              <button key={n} type="button" className={segment(targetScore === n)} onClick={() => setTargetScore(n)}>
                {n === 0 ? "بلا حد" : n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-bold">عدد اللاعبين</p>
          <div className="grid grid-cols-3 items-center rounded-2xl border border-white/10 bg-white/[0.02]">
            <button
              type="button"
              aria-label="تقليل عدد اللاعبين"
              disabled={shownCount <= floor}
              className="min-h-12 text-xl text-muted transition hover:text-ivory disabled:opacity-30"
              onClick={() => setMaxPlayers(Math.max(floor, shownCount - 1))}
            >
              −
            </button>
            <span className="text-center font-display text-3xl font-bold text-neon tabular-nums">{shownCount}</span>
            <button
              type="button"
              aria-label="زيادة عدد اللاعبين"
              disabled={shownCount >= MAX_PLAYERS}
              className="min-h-12 text-xl text-muted transition hover:text-ivory disabled:opacity-30"
              onClick={() => setMaxPlayers(Math.min(MAX_PLAYERS, shownCount + 1))}
            >
              +
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            {floor}–{MAX_PLAYERS} لاعباً{hostIsPlayer ? " · أنت أحد اللاعبين" : ""}
          </p>
        </div>
        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !gameId}
          className="min-h-12 w-full rounded-full bg-neon font-extrabold text-night shadow-[0_0_22px_rgb(6_182_212/0.35)] transition hover:brightness-110 disabled:opacity-40"
        >
          ابدأ
        </button>
      </form>
    </Shell>
  );
}
