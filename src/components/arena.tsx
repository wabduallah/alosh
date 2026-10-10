import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { GameIcon, PictureIcons } from "@/components/icons";
import { CheerBar, CheerRain } from "@/components/room-cheers";
import { Standings } from "@/components/room-standings";
import { QrCode } from "@/components/qr-code";
import { Button, cx, joinLink } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { hostAction, sendCheer } from "@/lib/lamma/rpc";
import { useRoom } from "@/lib/lamma/use-room";
import { AnswerSurface, Countdown, NextBar, RevealBoard, hasChoices, pickedFor, promptOf, useRoundCue, type Pick } from "@/components/room-answers";
import type { CheerKind, GameCard, Snapshot } from "@/lib/lamma/types";
import { lobbyPulse, playCue, unlockAudio } from "@/lib/sfx";

const NESTS = ["عش النسور", "عش الصقور", "عش الشواهين", "عش الفرسان"];

/* ----------------------------------------------------------------------------
 * Host screen (TV / host device). Also renders the Player Pad when hostIsPlayer is set.
 * ------------------------------------------------------------------------- */

export function HostScreen({ code, games }: { code: string; games: GameCard[] }) {
  const { t, lang, bundle } = useI18n();
  const { snap, error, tokens, refresh } = useRoom(code);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
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
              <div className="grid gap-2">
                <Button
                  type="button"
                  onClick={() => void act("start")}
                  disabled={!snap.youAreHost || snap.players.length < needed}
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
            <Standings players={snap.players} yourId={snap.yourId} roomCode={snap.room.code} mode={snap.room.bravoMode} />
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
  // Live standings: the three leaders, shown while the round is in progress.
  const leaders = [...snap.players].sort((a, b) => b.score - a.score).slice(0, 3);
  const rules = [
    snap.room.targetScore > 0 ? `الهدف ${snap.room.targetScore} نقطة` : null,
    snap.room.pointsPerCorrect > 0 ? `${snap.room.pointsPerCorrect} نقطة لكل إجابة صحيحة` : null,
    snap.room.streakMultiplier ? "مضاعف للإجابات المتتالية" : null,
    snap.room.eliminationMode ? "الإقصاء السريع: من يخطئ يخرج" : null,
    snap.room.reactionBonus ? "مكافأة السرعة مفعّلة" : null,
    snap.room.majorityMode ? "التخمين الجماعي: الإجابة الأكثر اختياراً" : null,
    snap.players.find((p) => p.id === snap.yourId)?.eliminated ? "أنت خارج اللعبة، تشاهد فقط" : null,
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {snap.players.map((player) => (
          <span
            key={player.id}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold transition-colors duration-200",
              player.eliminated && "opacity-40 line-through",
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
      {leaders.length ? (
        <p className="text-center text-xs text-ivory/80">
          المتصدرون: {leaders.map((p) => `${p.name} ${p.score}`).join(" · ")}
        </p>
      ) : null}
      <p className="text-center text-xs text-muted">
        {answered}/{snap.players.length} أجابوا{rules.length ? ` · ${rules.join(" · ")}` : ""}
      </p>
    </div>
  );
}

/** Final standings: winners in descending order of points, with each player's gap to the leader. */
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
 * Player pad (phone). Routes: /room/:code (non-host devices) and /play_/:code.
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
          <Standings players={snap.players} yourId={snap.yourId} roomCode={snap.room.code} mode={snap.room.bravoMode} />
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
