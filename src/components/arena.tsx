import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Flame, Heart, Laugh, Sparkles, X, type LucideIcon } from "lucide-react";
import { GameIcon, PictureIcons } from "@/components/icons";
import { QrCode } from "@/components/qr-code";
import { Button, cx, inputClass, joinLink } from "@/components/ui";
import { LETTER_CATS, type LetterCat } from "@/games/score";
import { useI18n } from "@/lib/i18n";
import { getSnapshot, hostAction, sendCheer, submitAnswer } from "@/lib/lamma/rpc";
import { watchRoom } from "@/lib/lamma/live";
import type { Cheer, CheerKind, GameCard, Reveal, Snapshot } from "@/lib/lamma/types";
import { CHEER_KINDS } from "@/lib/lamma/types";
import { lobbyPulse, playCue, unlockAudio } from "@/lib/sfx";

const EMPTY_FIELDS: Record<LetterCat, string> = { boy: "", girl: "", animal: "", object: "", country: "" };
const NON_CHOICE_ENGINES = new Set(["letter", "text", "feud", "vote"]);
const NESTS = ["عش النسور", "عش الصقور", "عش الشواهين", "عش الفرسان"];

/** Answer-tile states. Moonhem palette: emerald = correct, crimson = wrong, cyan = your pick. */
const TILE = {
  idle: "border-white/10 bg-white/[0.03] text-ivory hover:border-neon/60 hover:bg-neon/5",
  picked: "border-neon bg-neon/15 text-ivory shadow-[0_0_22px_rgb(6_182_212/0.3)]",
  ok: "border-emerald bg-emerald/15 text-ivory shadow-[0_0_26px_rgb(16_185_129/0.4)]",
  bad: "border-crimson bg-crimson/15 text-ivory shadow-[0_0_22px_rgb(239_68_68/0.35)]",
  dim: "border-white/5 bg-white/[0.02] text-ivory/40",
} as const;

type TileState = keyof typeof TILE;

/** What this device picked in a given round. Lives in the screen (not the surface) so it survives phase changes. */
type Pick = { round: number; key: string };

function readToken(code: string, role: "host" | "player") {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(`lamma:${role}:${code}`) ?? "";
  } catch {
    return "";
  }
}

function hasChoices(snap: Snapshot) {
  return Boolean(snap.room.question) && !NON_CHOICE_ENGINES.has(snap.room.engine);
}

function pickedFor(pick: Pick | null, round: number) {
  return pick && pick.round === round ? pick.key : null;
}

/**
 * Single-flight room poller.
 * - One chain only. Realtime pushes call `refresh()`, which cancels the pending timer and runs now;
 *   if a request is already in flight the refresh is queued, never duplicated (no poll-chain pile-up).
 * - Identical snapshots are not re-stored, so idle polls don't re-render the whole screen.
 */
export function useRoom(code: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState({ host: "", player: "" });
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    setTokens({ host: readToken(code, "host"), player: readToken(code, "player") });
  }, [code]);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    let inFlight = false;
    let queued = false;
    let lastJson = "";

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stop) timer = window.setTimeout(run, ms);
    };

    async function run() {
      window.clearTimeout(timer);
      if (stop) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      let delay = 2500;
      try {
        const res = await getSnapshot({
          data: {
            code,
            hostToken: tokens.host || undefined,
            playerToken: tokens.player || undefined,
          },
        });
        if (stop) return;
        if (!res.ok) {
          setError(res.error);
        } else {
          setError(null);
          const json = JSON.stringify(res);
          if (json !== lastJson) {
            lastJson = json;
            setSnap(res);
          }
          const live = res.room.status !== "CLOSED" && res.room.status !== "FINISHED";
          delay = live ? 1200 : 2500;
        }
      } catch {
        if (!stop) setError("SERVER");
        delay = 3000;
      } finally {
        inFlight = false;
      }
      if (stop) return;
      const again = queued;
      queued = false;
      schedule(again ? 0 : document.hidden ? Math.max(delay, 4000) : delay);
    }

    refreshRef.current = () => {
      void run();
    };
    void run();
    const unwatch = watchRoom(code, () => {
      void run();
    });
    return () => {
      stop = true;
      window.clearTimeout(timer);
      unwatch();
    };
  }, [code, tokens.host, tokens.player]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { snap, error, tokens, setTokens, refresh };
}

/** Plays the result sound on a player's own pad, once per round. */
function useRoundCue(snap: Snapshot | null) {
  const { bundle } = useI18n();
  const fired = useRef("");
  useEffect(() => {
    if (!snap || snap.room.status !== "ROUND_END") return;
    const key = String(snap.room.round);
    if (fired.current === key) return;
    fired.current = key;
    if (!snap.room.sound || !snap.yourId) return;
    const mine = snap.room.reveal?.answers?.find((a) => a.playerId === snap.yourId);
    if (!mine) return;
    if (mine.correct) playCue("correct", bundle.sounds.correct);
    else playCue("wrong");
  }, [snap, bundle.sounds]);
}

function Countdown({ endsAt, total }: { endsAt: string | null; total: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);
  const left = endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000)) : total;
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const pct = total > 0 ? left / total : 0;
  return (
    <div className="relative grid size-28 place-items-center">
      <svg viewBox="0 0 96 96" className="absolute size-28 -rotate-90" aria-hidden="true">
        <circle cx="48" cy="48" r={radius} className="fill-none stroke-white/10" strokeWidth="6" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          className="fill-none stroke-neon"
          strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-5xl text-ivory tabular-nums">{left}</span>
    </div>
  );
}

function promptOf(snap: Snapshot, lang: "ar" | "en") {
  const q = snap.room.question;
  if (!q) return "";
  return lang === "en" ? q.promptEn : q.promptAr;
}

/** Auto-advance indicator: the server moves on 2.5s after the reveal; this bar shows that countdown. */
function NextBar({ roundKey }: { roundKey: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div key={roundKey} className="drain h-full bg-neon shadow-[0_0_12px_rgb(6_182_212/0.8)]" />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Answer surface: shared by the player pad and the host's own player pad.
 * ------------------------------------------------------------------------- */

function AnswerSurface({
  snap,
  code,
  playerToken,
  picked,
  onPick,
  onRoundClosed,
}: {
  snap: Snapshot;
  code: string;
  playerToken: string;
  picked: string | null;
  onPick: (key: string | null) => void;
  onRoundClosed: () => void;
}) {
  const { t, lang, bundle } = useI18n();
  const [fields, setFields] = useState<Record<LetterCat, string>>(EMPTY_FIELDS);
  const [text, setText] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  // Synchronous guard: a double tap can never send two answers, and the lock doesn't wait for a render.
  const lockRef = useRef(false);

  const playing = snap.room.status === "PLAYING";
  const locked = Boolean(picked) || snap.yourAnswered || !playing;
  const reveal: Reveal | null = snap.room.reveal;
  const correctId = snap.room.status === "ROUND_END" ? reveal?.correctId : undefined;
  const engine = snap.room.engine;
  const q = snap.room.question;

  async function submit(payload: Record<string, unknown>, key: string) {
    if (lockRef.current || !playing || snap.yourAnswered) return;
    lockRef.current = true;
    onPick(key);
    setLocalErr(null);
    unlockAudio();
    if (snap.room.sound) playCue("click", bundle.sounds.click);
    const res = await submitAnswer({
      data: { code, playerToken, round: snap.room.round, payload },
    });
    if (!res.ok) {
      lockRef.current = false;
      onPick(null);
      setLocalErr(res.error);
      return;
    }
    // The server closed the round on this answer: pull the reveal now instead of waiting for the next poll.
    if (res.roundClosed) onRoundClosed();
  }

  function tileState(id: string): TileState {
    if (correctId) {
      if (id === correctId) return "ok";
      if (id === picked) return "bad";
      return "dim";
    }
    return picked === id ? "picked" : "idle";
  }

  const sentLabel = locked ? t("pad.locked") : t("pad.send");

  return (
    <div className="space-y-3">
      {localErr ? (
        <p role="alert" className="rounded-xl border border-crimson/40 bg-crimson/10 px-3 py-2 text-sm text-red-200">
          {t(`err.${localErr}`)}
        </p>
      ) : null}

      {engine === "letter" ? (
        <>
          <p className="font-display text-6xl text-neon">{snap.room.letter}</p>
          {LETTER_CATS.map((cat) => (
            <label key={cat} className="block space-y-1">
              <span className="text-sm text-muted">{t(`letter.${cat}`)}</span>
              <input
                className={inputClass}
                disabled={locked}
                value={fields[cat]}
                onChange={(e) => setFields({ ...fields, [cat]: e.target.value })}
              />
            </label>
          ))}
          <Button type="button" disabled={locked} onClick={() => void submit({ fields }, "fields")} className="w-full">
            {sentLabel}
          </Button>
        </>
      ) : null}

      {engine === "text" || engine === "feud" ? (
        <>
          <h2 className="text-2xl font-bold">{promptOf(snap, lang)}</h2>
          <input className={inputClass} disabled={locked} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="button" disabled={locked || !text.trim()} onClick={() => void submit({ text }, "text")} className="w-full">
            {sentLabel}
          </Button>
        </>
      ) : null}

      {engine === "vote" ? (
        <div className="grid gap-2">
          {snap.players
            .filter((p) => p.id !== snap.yourId)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={locked}
                onClick={() => void submit({ playerId: p.id }, p.id)}
                className={cx(
                  "min-h-12 rounded-2xl border px-4 text-start font-bold transition-all duration-150 disabled:cursor-default",
                  TILE[tileState(p.id)],
                )}
              >
                {p.name}
              </button>
            ))}
        </div>
      ) : null}

      {q && hasChoices(snap) ? (
        <>
          <h2 className="text-2xl font-bold">{promptOf(snap, lang)}</h2>
          {snap.yourId && snap.room.subjectId === snap.yourId ? <p className="text-sm text-muted">{t("pad.subject")}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {q.choices.map((choice) => {
              const state = tileState(choice.id);
              const Mark = state === "ok" ? Check : state === "bad" ? X : null;
              return (
                <button
                  key={choice.id}
                  type="button"
                  disabled={locked}
                  onClick={() => void submit(engine === "truth" ? { side: choice.id } : { choiceId: choice.id }, choice.id)}
                  className={cx(
                    "flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-4 text-start font-bold transition-all duration-150 active:scale-[0.99] disabled:cursor-default",
                    TILE[state],
                  )}
                >
                  <span>{lang === "en" ? choice.en : choice.ar}</span>
                  {Mark ? <Mark className={cx("size-5 shrink-0", state === "ok" ? "text-emerald" : "text-crimson")} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Host screen (TV / host device). Also renders the Player Pad when hostIsPlayer is set.
 * ------------------------------------------------------------------------- */

export function HostScreen({ code, games }: { code: string; games: GameCard[] }) {
  const { t, lang, bundle } = useI18n();
  const { snap, error, tokens, refresh } = useRoom(code);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);
  const switchTimer = useRef<number | null>(null);
  const prev = useRef<Snapshot | null>(null);
  const navigate = useNavigate();
  const link = joinLink(code);

  useEffect(() => {
    if (!snap) return;
    const before = prev.current;
    if (before) {
      const known = new Set(before.players.map((p) => p.id));
      for (const player of snap.players) {
        if (!known.has(player.id)) {
          setNote(t("toast.joined", { name: player.name }));
          if (snap.room.sound) playCue("click", bundle.sounds.click);
        }
      }
      if (before.room.status !== "PLAYING" && snap.room.status === "PLAYING") {
        setNote(t("toast.started"));
        if (snap.room.sound) playCue("round", bundle.sounds.round);
      }
      if (before.room.status === "PLAYING" && snap.room.status === "ROUND_END") {
        setNote(t("toast.roundEnd"));
        if (snap.room.sound) playCue("correct", bundle.sounds.correct);
      }
      if (before.room.status !== "FINISHED" && snap.room.status === "FINISHED" && snap.room.sound) {
        playCue("victory", bundle.sounds.victory);
      }
    }
    prev.current = snap;
    if (snap.room.music && snap.room.status === "WAITING") lobbyPulse(true, bundle.sounds.lobby);
  }, [bundle.sounds, snap, t]);

  // Round advancement is owned by the server: closeRound -> autoAt (2.5s) -> advanceIfDue.
  // The host client no longer runs its own timer; that timer was cancelled on every poll.

  useEffect(() => () => {
    if (switchTimer.current) window.clearTimeout(switchTimer.current);
  }, []);

  function handleSelectGame(gameId: string) {
    setSelectedId(gameId);
    if (switchTimer.current) window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => {
      void act("switchGame", { gameId });
    }, 180);
  }

  function leaveHome() {
    void act("close");
    void navigate({ to: "/" });
  }

  async function act(action: string, extra?: Record<string, unknown>) {
    unlockAudio();
    const res = await hostAction({ data: { code, hostToken: tokens.host, action, extra } });
    if (res && "ok" in res && res.ok === false) setNote(t(`err.${res.error}`));
    refresh();
  }

  if (!snap) {
    return (
      <main className="grid min-h-screen place-items-center bg-night text-ivory">
        {error ? t(`err.${error}`) : t("common.loading")}
      </main>
    );
  }

  const name = lang === "en" ? snap.room.nameEn : snap.room.nameAr;
  const answered = snap.players.filter((p) => p.answered).length;
  const needed = Math.max(2, snap.room.minPlayers);
  const hostPlays = snap.youAreHost && snap.room.hostIsPlayer && Boolean(snap.yourId);
  const pickedKey = pickedFor(pick, snap.room.round);
  const onPick = (key: string | null) => setPick(key === null ? null : { round: snap.room.round, key });

  return (
    <main className="stage relative min-h-screen text-ivory" onPointerDown={unlockAudio}>
      <CheerRain cheers={snap.cheers ?? []} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-neon">{name}</p>
            <h1 className="font-display text-5xl tracking-wide sm:text-7xl">{code}</h1>
          </div>
          <div className="text-end">
            <p className="text-sm text-muted">
              {t("host.round", { n: Math.max(snap.room.round, 1) })} / {snap.room.rounds}
            </p>
            <p className="text-lg tabular-nums">
              {t("host.answered")} {answered}/{snap.players.length}
            </p>
          </div>
        </header>

        {note ? <p className="rise self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm">{note}</p> : null}
        {!snap.youAreHost ? <p className="text-sm text-muted">{t("host.spectator")}</p> : null}
        {snap.youAreHost && snap.room.hostMode === "narrator" ? (
          <p className="rounded-2xl border border-neon/30 bg-neon/10 px-4 py-3 text-sm">
            وضع الراوي: اللاعبون لا يرون الإجابة.{" "}
            {snap.room.hostAnswer ? `الإجابة: ${snap.room.hostAnswer}` : "ابدأ الجولة لرؤية الإجابة."}
          </p>
        ) : null}

        {snap.room.status === "WAITING" ? (
          <section className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
            <div className="glass-card space-y-4 rounded-3xl p-5 text-center">
              <p className="text-xs font-bold tracking-wide text-muted">{t("host.ready")}</p>
              <p className="font-display text-4xl tracking-[0.35em] text-ivory">{code}</p>
              <p className="text-sm text-muted">{t("host.count", { n: snap.players.length, max: snap.room.maxPlayers })}</p>
              <div className="mx-auto w-fit">
                <QrCode text={link} />
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {snap.players.map((player) => (
                  <div
                    key={player.id}
                    className={cx(
                      "rounded-2xl border px-3 py-3",
                      player.id === snap.yourId ? "border-neon/60 bg-neon/10" : "border-white/10 bg-white/[0.03]",
                    )}
                  >
                    <p className="font-bold">{player.name}</p>
                    <p className="text-xs text-neon">
                      {snap.room.playMode === "teams"
                        ? NESTS[snap.players.findIndex((p) => p.id === player.id) % 4]
                        : player.id === snap.yourId
                          ? "أنت"
                          : "جاهز"}
                    </p>
                  </div>
                ))}
              </div>
              <GamePicker games={games} currentId={selectedId} disabled={!snap.youAreHost} onPick={handleSelectGame} />
              <div className="grid gap-2">
                <Button
                  type="button"
                  onClick={() => void act("start")}
                  disabled={!snap.youAreHost || !selectedId || snap.players.length < needed}
                  className="w-full"
                >
                  {t("host.start")}
                </Button>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" tone="glass" onClick={() => void copy(link, setCopied)}>
                    {copied ? t("host.copied") : t("host.copy")}
                  </Button>
                  <a
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 font-bold text-neon transition hover:border-neon/60"
                    href={`https://wa.me/?text=${encodeURIComponent(link)}`}
                  >
                    {t("host.whatsapp")}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={leaveHome}
                  className="w-full rounded-full border border-white/10 bg-transparent py-3 font-medium text-muted transition-all hover:border-neon/50 hover:text-ivory"
                >
                  العودة إلى القائمة الرئيسية
                </button>
              </div>
              {snap.players.length < needed ? <p className="text-sm text-crimson">{t("host.needMin", { n: needed })}</p> : null}
            </div>
          </section>
        ) : null}

        {snap.room.status === "PLAYING" ? (
          <section className="space-y-4">
            <article className="glass-card rounded-3xl p-6 text-center">
              <h2 className="font-display text-4xl text-neon sm:text-6xl">
                {snap.room.engine === "letter" ? snap.room.letter : promptOf(snap, lang)}
              </h2>
              <div className="mt-4">
                <QuestionVisual snap={snap} />
              </div>
              <div className="mt-4 flex justify-center">
                <Countdown endsAt={snap.room.endsAt} total={snap.room.seconds} />
              </div>
              <div className="mt-4">
                <GuestsStrip snap={snap} />
              </div>
            </article>
            {hostPlays ? (
              <HostPad
                snap={snap}
                code={code}
                playerToken={tokens.player}
                picked={pickedKey}
                onPick={onPick}
                onRoundClosed={refresh}
              />
            ) : null}
            {snap.youAreHost ? (
              <div className="flex justify-start">
                <Button type="button" tone="glass" onClick={() => void act("endRound")}>
                  {t("host.end")}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {snap.room.status === "ROUND_END" ? (
          <section className="space-y-4">
            {hostPlays ? (
              <HostPad
                snap={snap}
                code={code}
                playerToken={tokens.player}
                picked={pickedKey}
                onPick={onPick}
                onRoundClosed={refresh}
              />
            ) : null}
            <RevealBoard snap={snap} lang={lang} host={snap.youAreHost} onAct={act} />
          </section>
        ) : null}

        {snap.room.status === "FINISHED" ? (
          <div className="space-y-6">
            <Standings players={snap.players} yourId={snap.yourId} />
            <div className="grid gap-2">
              {snap.youAreHost ? (
                <Button type="button" onClick={() => void act("start")} className="w-full">
                  اللعب من جديد
                </Button>
              ) : null}
              {snap.youAreHost ? (
                <Button type="button" tone="glass" onClick={() => void act("restart")} className="w-full">
                  تغيير اللعبة
                </Button>
              ) : (
                <p className="text-sm text-muted">اللاعبون باقون في الغرفة. المضيف يختار اللعبة التالية.</p>
              )}
            </div>
            {snap.youAreHost ? (
              <section className="space-y-3">
                <h3 className="text-xl font-bold">{t("host.switch")}</h3>
                <p className="text-sm text-muted">{t("host.switchLead")}</p>
                <GamePicker games={games} currentId={snap.room.gameId} onPick={(gameId) => void act("switchGame", { gameId, start: true })} />
              </section>
            ) : null}
          </div>
        ) : null}
        {snap.room.status === "CLOSED" ? <p className="text-2xl">{t("err.ROOM_NOT_FOUND")}</p> : null}

        <PlayerRail snap={snap} host={snap.youAreHost} onKick={(playerId) => void act("kick", { playerId })} />
      </div>
    </main>
  );
}

/** The host's own answer pad (hostIsPlayer). Same answer logic as a player's phone. */
function HostPad({
  snap,
  code,
  playerToken,
  picked,
  onPick,
  onRoundClosed,
}: {
  snap: Snapshot;
  code: string;
  playerToken: string;
  picked: string | null;
  onPick: (key: string | null) => void;
  onRoundClosed: () => void;
}) {
  const { t } = useI18n();
  const me = snap.players.find((p) => p.id === snap.yourId);
  const playing = snap.room.status === "PLAYING";
  return (
    <section className="glass-card rounded-3xl p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wide text-neon">أنت تلعب</p>
          <p className="text-sm text-muted">{t("host.playAs")}</p>
        </div>
        <div className="text-end">
          <p className="text-sm text-muted">{me?.name}</p>
          <p className="font-display text-4xl tabular-nums text-ivory">{me?.score ?? 0}</p>
        </div>
      </div>
      {playing || hasChoices(snap) ? (
        <AnswerSurface
          key={snap.room.round}
          snap={snap}
          code={code}
          playerToken={playerToken}
          picked={picked}
          onPick={onPick}
          onRoundClosed={onRoundClosed}
        />
      ) : (
        <p className="font-display text-3xl">{t("pad.points", { n: snap.yourRoundScore })}</p>
      )}
    </section>
  );
}

function RevealBoard({
  snap,
  lang,
  host,
  onAct,
}: {
  snap: Snapshot;
  lang: "ar" | "en";
  host: boolean;
  onAct: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const reveal: Reveal | null = snap.room.reveal;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {host ? (
          <Button type="button" tone={snap.room.auto ? "glass" : "primary"} onClick={() => void onAct("next")}>
            {snap.room.round >= snap.room.rounds ? t("host.finish") : t("host.next")}
          </Button>
        ) : null}
        {snap.room.auto ? <p className="text-sm text-muted">{t("host.autoNext")}</p> : null}
      </div>
      {snap.room.auto ? <NextBar roundKey={snap.room.round} /> : null}
      {reveal?.correctAr ? (
        <p className="text-3xl text-emerald">{lang === "en" ? reveal.correctEn || reveal.correctAr : reveal.correctAr}</p>
      ) : null}
      {reveal?.letterRows ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-start text-sm">
            <thead className="text-neon">
              <tr>
                <th className="px-2 py-2">{t("host.players")}</th>
                {LETTER_CATS.map((cat) => (
                  <th key={cat} className="px-2 py-2">
                    {t(`letter.${cat}`)}
                  </th>
                ))}
                <th className="px-2 py-2">+</th>
              </tr>
            </thead>
            <tbody>
              {reveal.letterRows.map((row) => (
                <tr key={row.playerId} className="border-t border-white/10">
                  <td className="px-2 py-3">{row.name}</td>
                  {LETTER_CATS.map((cat) => {
                    const cell = row.fields[cat];
                    return (
                      <td key={cat} className="px-2 py-3">
                        <div className={cell.verdict === "bad" && cell.text ? "text-red-300" : undefined}>{cell.text || "—"}</div>
                        <div className="text-neon tabular-nums">{cell.points}</div>
                        {host && cell.verdict === "bad" && cell.text ? (
                          <button
                            type="button"
                            className="text-xs text-neon underline"
                            onClick={() => void onAct("accept", { playerId: row.playerId, category: cat })}
                          >
                            {t("host.accept")}
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="px-2 py-3 tabular-nums">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {reveal?.percents ? (
        <ul className="space-y-2 text-xl">
          {reveal.percents.map((item) => (
            <li key={item.id} className="flex justify-between border-b border-white/10 py-2">
              <span>{lang === "en" ? item.en : item.ar}</span>
              <span className="tabular-nums text-neon">{item.n}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.votes ? (
        <ul className="space-y-2 text-xl">
          {reveal.votes.map((item) => (
            <li key={item.playerId} className="flex justify-between border-b border-white/10 py-2">
              <span>{item.name}</span>
              <span className="tabular-nums text-neon">{item.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.truth ? (
        <ul className="space-y-3">
          {reveal.truth.map((item) => (
            <li key={item.playerId} className="glass-card rounded-2xl p-4">
              <p className="text-sm font-bold text-neon">{item.name}</p>
              <p className="text-xl">{lang === "en" ? item.promptEn : item.promptAr}</p>
              {host ? (
                <Button type="button" tone="violet" className="mt-3" onClick={() => void onAct("bonus", { playerId: item.playerId })}>
                  {t("host.bonus")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.answers ? (
        <ul className="space-y-2">
          {reveal.answers.map((item) => (
            <li key={item.playerId} className="flex justify-between gap-3 border-b border-white/10 py-2">
              <span>{item.name}</span>
              <span className={item.correct ? "text-emerald" : "text-muted"}>{item.text}</span>
              <span className="tabular-nums text-neon">+{item.points}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.feudHits ? (
        <ul className="space-y-2">
          {reveal.feudHits.map((item) => (
            <li key={item.playerId} className="flex justify-between border-b border-white/10 py-2">
              <span>
                {item.name}: {item.text}
              </span>
              <span className="tabular-nums">+{item.points}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const CHEER_ICON: Record<CheerKind, LucideIcon> = {
  spark: Sparkles,
  laugh: Laugh,
  heart: Heart,
  flame: Flame,
};

function cheerLane(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return { left: 8 + (hash % 76), drift: `${(hash % 48) - 24}px` };
}

function CheerRain({ cheers }: { cheers: Cheer[] }) {
  const [live, setLive] = useState<Array<Cheer & { left: number; drift: string }>>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);

  // Timers are only cleared on unmount. Clearing them when `cheers` changes would drop cheers
  // that were already marked as seen, so they would never show.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    const fresh = cheers.filter((cheer) => !seen.current.has(cheer.id));
    fresh.forEach((cheer, index) => {
      seen.current.add(cheer.id);
      const lane = cheerLane(cheer.id);
      timers.current.push(
        window.setTimeout(() => {
          setLive((prev) => [...prev, { ...cheer, ...lane }].slice(-16));
          timers.current.push(
            window.setTimeout(() => {
              setLive((prev) => prev.filter((item) => item.id !== cheer.id));
            }, 3400),
          );
        }, index * 160),
      );
    });
  }, [cheers]);

  if (!live.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden" data-cheer-rain={live.length} aria-hidden="true">
      {live.map((item) => {
        const Icon = CHEER_ICON[item.kind];
        return (
          <div
            key={item.id}
            className="cheer-rise absolute bottom-28 flex flex-col items-center gap-1"
            style={{ left: `${item.left}%`, ["--cheer-drift" as string]: item.drift }}
          >
            <Icon className="size-14 text-neon drop-shadow-[0_0_12px_rgb(6_182_212/0.7)]" strokeWidth={1.5} />
            <span className="rounded-full border border-white/10 bg-night/85 px-3 py-1 text-sm text-ivory">{item.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function CheerBar({ onSend }: { onSend: (kind: CheerKind) => void }) {
  const { t } = useI18n();
  const [cooling, setCooling] = useState(false);

  function tap(kind: CheerKind) {
    if (cooling) return;
    setCooling(true);
    window.setTimeout(() => setCooling(false), 900);
    onSend(kind);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night/85 px-4 pt-3 pb-4 backdrop-blur-xl">
      <p className="mb-2 text-center text-xs text-muted">{t("cheer.hint")}</p>
      <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
        {CHEER_KINDS.map((kind) => {
          const Icon = CHEER_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              data-cheer={kind}
              disabled={cooling}
              onClick={() => tap(kind)}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] text-ivory transition hover:border-neon/50 active:scale-95 disabled:opacity-50"
            >
              <Icon className="size-5 text-neon" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-xs">{t(`cheer.${kind}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GamePicker({
  games,
  currentId,
  disabled,
  onPick,
}: {
  games: GameCard[];
  currentId: string;
  disabled?: boolean;
  onPick: (gameId: string) => void;
}) {
  const { lang } = useI18n();
  return (
    <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
      {games.map((game) => {
        const active = game.id === currentId;
        return (
          <button
            key={game.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(game.id)}
            className={cx(
              "relative cursor-pointer rounded-2xl border px-3 py-3 text-start transition-all duration-150 disabled:cursor-not-allowed",
              active
                ? "border-neon bg-neon/10 shadow-[0_0_18px_rgb(6_182_212/0.25)]"
                : "border-white/10 bg-white/[0.03] hover:border-neon/40",
            )}
          >
            {active ? <Check className="absolute end-3 top-3 size-4 text-neon" aria-hidden="true" /> : null}
            <span className="flex items-center gap-2 font-bold text-ivory">
              <GameIcon name={game.icon} className="size-4 shrink-0 text-neon" />
              {lang === "en" ? game.nameEn : game.nameAr}
            </span>
            <span className="mt-1 block text-xs text-muted">{lang === "en" ? game.descriptionEn : game.descriptionAr}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionVisual({ snap }: { snap: Snapshot }) {
  const q = snap.room.question;
  if (!q) return null;
  if (q.imageUrl) {
    return (
      <img
        src={q.imageUrl}
        alt=""
        className="mx-auto max-h-72 w-auto max-w-full rounded-2xl border border-white/10 bg-white/[0.03] object-contain p-2"
      />
    );
  }
  if (q.icons.length) return <PictureIcons names={q.icons} />;
  return null;
}

/** Guest names under the question. A green check appears as soon as a guest has answered. */
function GuestsStrip({ snap }: { snap: Snapshot }) {
  const answered = snap.players.filter((p) => p.answered).length;
  const rules = [
    snap.room.targetScore > 0 ? `الهدف ${snap.room.targetScore} نقطة` : null,
    snap.room.pointsPerCorrect > 0 ? `${snap.room.pointsPerCorrect} نقطة لكل إجابة صحيحة` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {snap.players.map((player) => (
          <span
            key={player.id}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold transition-colors duration-200",
              player.answered ? "border-emerald/50 bg-emerald/15 text-ivory" : "border-white/10 bg-white/[0.03] text-muted",
            )}
          >
            {player.answered ? (
              <Check className="size-3.5 text-emerald" strokeWidth={3} aria-label="أجاب" />
            ) : (
              <span className="size-1.5 rounded-full bg-white/30" aria-hidden="true" />
            )}
            {player.name}
          </span>
        ))}
      </div>
      <p className="text-center text-xs text-muted">
        {answered}/{snap.players.length} أجابوا{rules.length ? ` · ${rules.join(" · ")}` : ""}
      </p>
    </div>
  );
}

/** Final standings: winners in descending order of points, with each player's gap to the leader. */
function Standings({ players, yourId }: { players: Snapshot["players"]; yourId: string | null }) {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const leader = ranked[0]?.score ?? 0;
  let place = 0;
  let last = Number.POSITIVE_INFINITY;
  const rows = ranked.map((player, index) => {
    if (player.score !== last) {
      place = index + 1;
      last = player.score;
    }
    return { player, place, gap: leader - player.score };
  });
  return (
    <section className="space-y-6 text-center">
      <h2 className="font-display text-5xl">الترتيب النهائي</h2>
      <ol className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-3">
        {rows.slice(0, 3).map(({ player, place: rank, gap }) => (
          <li
            key={player.id}
            className={cx("glass-card rounded-2xl p-4", rank === 1 && "border-neon/50 shadow-[0_0_32px_rgb(6_182_212/0.25)]")}
          >
            <p className="font-display text-4xl text-neon">{rank}</p>
            <p className="text-2xl font-bold">{player.name}</p>
            <p className="tabular-nums text-ivory">{player.score}</p>
            <p className="text-xs text-muted">{gap === 0 ? "المتصدر" : `−${gap}`}</p>
          </li>
        ))}
      </ol>
      <ol className="mx-auto max-w-3xl space-y-2 text-start">
        {rows.map(({ player, place: rank, gap }) => (
          <li
            key={player.id}
            className={cx(
              "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3",
              player.id === yourId ? "border-neon/50 bg-neon/10" : "border-white/10 bg-white/[0.03]",
            )}
          >
            <span className="flex items-center gap-3">
              <span className="w-8 font-display text-xl tabular-nums text-neon">{rank}</span>
              <span className="font-bold">{player.name}</span>
            </span>
            <span className="flex items-center gap-4 tabular-nums">
              <span className="text-sm text-muted">{gap === 0 ? "—" : `−${gap}`}</span>
              <span className="text-lg font-bold">{player.score}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlayerRail({
  snap,
  host,
  onKick,
}: {
  snap: Snapshot;
  host: boolean;
  onKick: (id: string) => void;
}) {
  return (
    <ul className="mt-auto grid grid-cols-2 gap-2 sm:grid-cols-4">
      {snap.players.map((player) => (
        <li
          key={player.id}
          className={cx(
            "rounded-2xl border px-3 py-3",
            player.answered || player.id === snap.yourId ? "border-neon/50 bg-neon/10" : "border-white/10 bg-white/[0.03]",
          )}
        >
          <p className="font-bold">{player.name}</p>
          <p className="text-sm tabular-nums text-neon">{player.score}</p>
          {host && player.id !== snap.yourId ? (
            <button type="button" className="text-xs text-muted hover:text-crimson" onClick={() => onKick(player.id)}>
              إخراج
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

async function copy(link: string, setCopied: (v: boolean) => void) {
  try {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  } catch {
    setCopied(false);
  }
}

/* ----------------------------------------------------------------------------
 * Player pad (phone). Routes: /pad/:code and /play_/:code.
 * ------------------------------------------------------------------------- */

export function PadScreen({ code }: { code: string }) {
  const { t, lang } = useI18n();
  const { snap, error, tokens, refresh } = useRoom(code);
  const [pick, setPick] = useState<Pick | null>(null);
  useRoundCue(snap);

  if (!tokens.player && snap) {
    return <Gate code={code} />;
  }
  if (!snap) {
    return (
      <main className="grid min-h-screen place-items-center bg-night px-6 text-center text-ivory">
        {error ? t(`err.${error}`) : t("common.loading")}
      </main>
    );
  }

  const me = snap.players.find((p) => p.id === snap.yourId);
  const pickedKey = pickedFor(pick, snap.room.round);
  const onPick = (key: string | null) => setPick(key === null ? null : { round: snap.room.round, key });
  const answeredNow = snap.yourAnswered || pickedKey !== null;
  const showCheer = snap.room.status !== "PLAYING" || answeredNow;

  function throwCheer(kind: CheerKind) {
    unlockAudio();
    void sendCheer({ data: { code, playerToken: tokens.player, kind } });
  }

  return (
    <main className={cx("min-h-screen bg-night px-4 py-5 text-ivory", showCheer && "pb-32")} onPointerDown={unlockAudio}>
      <header className="glass-card mb-5 flex items-center justify-between rounded-3xl px-4 py-3">
        <div>
          <p className="text-sm text-muted">{me?.name}</p>
          <p className="font-display text-3xl tabular-nums text-neon">{me?.score ?? 0}</p>
        </div>
        <p className="text-sm text-muted">{t("host.round", { n: Math.max(snap.room.round, 1) })}</p>
      </header>

      {snap.room.status === "WAITING" ? (
        <section className="space-y-3">
          <p className="text-sm font-bold text-neon">{lang === "en" ? snap.room.nameEn : snap.room.nameAr}</p>
          <h1 className="font-display text-4xl">اللاعبون</h1>
          <div className="grid grid-cols-2 gap-2">
            {snap.players.map((p) => (
              <div
                key={p.id}
                className={cx(
                  "rounded-2xl border px-4 py-4",
                  p.id === snap.yourId ? "border-neon/60 bg-neon/10" : "border-white/10 bg-white/[0.03]",
                )}
              >
                <p className="font-bold">{p.name}</p>
                <p className="text-xs text-neon">{p.id === snap.yourId ? "اختيارك" : "في الغرفة"}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {snap.room.status === "PLAYING" ? (
        <div className="mb-4 space-y-4">
          <QuestionVisual snap={snap} />
          <GuestsStrip snap={snap} />
        </div>
      ) : null}
      {snap.room.status === "PLAYING" && snap.yourId ? (
        <AnswerSurface
          key={snap.room.round}
          snap={snap}
          code={code}
          playerToken={tokens.player}
          picked={pickedKey}
          onPick={onPick}
          onRoundClosed={refresh}
        />
      ) : null}

      {snap.room.status === "ROUND_END" ? (
        <section className="space-y-5">
          <div>
            <h1 className="font-display text-4xl">{t("pad.roundEnd")}</h1>
            <p className="font-display text-6xl tabular-nums text-ivory">{t("pad.points", { n: snap.yourRoundScore })}</p>
          </div>
          {snap.yourId && hasChoices(snap) ? (
            <AnswerSurface
              key={snap.room.round}
              snap={snap}
              code={code}
              playerToken={tokens.player}
              picked={pickedKey}
              onPick={onPick}
              onRoundClosed={refresh}
            />
          ) : null}
          {snap.room.auto ? <NextBar roundKey={snap.room.round} /> : null}
        </section>
      ) : null}

      {snap.room.status === "FINISHED" ? (
        <div className="glass-card rounded-3xl p-4">
          <Standings players={snap.players} yourId={snap.yourId} />
        </div>
      ) : null}

      {snap.room.status === "CLOSED" ? <p className="mt-6 text-center text-lg text-muted">{t("err.ROOM_NOT_FOUND")}</p> : null}
      {showCheer ? <CheerBar onSend={throwCheer} /> : null}
    </main>
  );
}

function Gate({ code }: { code: string }) {
  const { t } = useI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-night px-6 text-center text-ivory">
      <div className="space-y-3">
        <p>{t("join.title")}</p>
        <a
          className="inline-flex min-h-11 items-center rounded-full bg-neon px-5 font-bold text-night shadow-[0_0_22px_rgb(6_182_212/0.35)]"
          href={`/join/${code}`}
        >
          {code}
        </a>
      </div>
    </main>
  );
}
