import { useState } from "react";
import { CheerBar } from "@/components/room-cheers";
import { Standings } from "@/components/room-standings";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { sendCheer } from "@/lib/lamma/rpc";
import { useRoom } from "@/lib/lamma/use-room";
import { AnswerSurface, NextBar, hasChoices, pickedFor, useRoundCue, type Pick } from "@/components/room-answers";
import type { CheerKind } from "@/lib/lamma/types";
import { unlockAudio } from "@/lib/sfx";
import { GuestsStrip, QuestionVisual } from "@/components/room-shared";

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
