import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button, cx, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { submitAnswer } from "@/lib/lamma/rpc";
import type { Reveal, Snapshot } from "@/lib/lamma/types";
import { playCue, unlockAudio } from "@/lib/sfx";

const NON_CHOICE_ENGINES = new Set(["text", "feud", "vote"]);

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
export type Pick = { round: number; key: string };

export function hasChoices(snap: Snapshot) {
  return Boolean(snap.room.question) && !NON_CHOICE_ENGINES.has(snap.room.engine);
}

export function pickedFor(pick: Pick | null, round: number) {
  return pick && pick.round === round ? pick.key : null;
}

/** Plays the result sound on a player's own pad, once per round. */
export function useRoundCue(snap: Snapshot | null) {
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

export function Countdown({ endsAt, total }: { endsAt: string | null; total: number }) {
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

export function promptOf(snap: Snapshot, lang: "ar" | "en") {
  const q = snap.room.question;
  if (!q) return "";
  return lang === "en" ? q.promptEn : q.promptAr;
}

/** Auto-advance indicator: the server moves on 2.5s after the reveal; this bar shows that countdown. */
export function NextBar({ roundKey }: { roundKey: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div key={roundKey} className="drain h-full bg-neon shadow-[0_0_12px_rgb(6_182_212/0.8)]" />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Answer surface: shared by the player pad and the host's own player pad.
 * ------------------------------------------------------------------------- */

export function AnswerSurface({
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
  const [text, setText] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  // Synchronous guard: a double tap can never send two answers, and the lock doesn't wait for a render.
  const lockRef = useRef(false);

  const playing = snap.room.status === "PLAYING";
  const youOut = Boolean(snap.players.find((p) => p.id === snap.yourId)?.eliminated);
  const locked = Boolean(picked) || snap.yourAnswered || !playing || youOut;
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
        <p role="alert" className="rounded-xl border border-crimson/40 bg-crimson/10 px-3 py-2 text-sm text-ivory">
          {t(`err.${localErr}`)}
        </p>
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

export function RevealBoard({
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
