/**
 * «الكذابون» arena building blocks: the board, question stage, reveal, leaderboard,
 * lobby and final standings. The route (src/routes/games/liars/arena.tsx) composes
 * them per view: host (TV plus controls), tv (display only) and pad (player phone).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Check, Crown, Lightbulb, Wifi, WifiOff, X } from "lucide-react";
import { cx } from "@/components/ui";
import { QrCode } from "@/components/qr-code";
import { cellKey } from "@/lib/liars/rules";
import { LEVEL_COUNT, POINT_LEVELS, type LiarsSnapshot, type SnapPlayer } from "@/lib/liars/types";

export const OPTION_LETTERS = ["أ", "ب", "ج", "د", "هـ", "و"];

/** Re-renders every `ms` while `active`, for countdowns. */
export function useTicker(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function Board({
  snap,
  size,
  onPick,
  busy,
}: {
  snap: LiarsSnapshot;
  size: "lg" | "sm";
  onPick?: (categoryId: string, level: number) => void;
  busy?: boolean;
}) {
  const { categories, usedCells } = snap.room;
  const used = new Set(usedCells);
  const open = snap.room.cell?.key ?? null;
  const canPick = Boolean(onPick) && snap.you.canPick && snap.room.state === "board" && !busy;
  const lg = size === "lg";
  return (
    <div
      className="grid gap-1.5 sm:gap-2"
      style={{ gridTemplateColumns: `repeat(${Math.max(categories.length, 1)}, minmax(0, 1fr))` }}
      role="grid"
      aria-label="لوحة الأسئلة"
    >
      {categories.map((cat) => (
        <div
          key={cat.id}
          role="columnheader"
          className={cx(
            "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-violet/40 bg-violet/15 px-1 py-2 text-center",
            lg && "min-h-20",
          )}
        >
          <span className={lg ? "text-2xl" : "text-lg"} aria-hidden="true">
            {cat.icon}
          </span>
          <span className={cx("font-extrabold leading-tight text-ivory", lg ? "text-sm sm:text-base" : "text-[11px] sm:text-xs")}>
            {cat.nameAr}
          </span>
        </div>
      ))}
      {Array.from({ length: LEVEL_COUNT }, (_, row) =>
        categories.map((cat) => {
          const level = row + 1;
          const key = cellKey(cat.id, level);
          const isUsed = used.has(key) && key !== open;
          const isOpen = key === open;
          const points = POINT_LEVELS[row]!;
          return (
            <button
              key={key}
              type="button"
              disabled={!canPick || used.has(key)}
              onClick={() => onPick?.(cat.id, level)}
              aria-label={`${cat.nameAr}، ${points} نقطة${isUsed ? "، مستخدمة" : ""}`}
              className={cx(
                "rounded-xl border font-extrabold tabular-nums transition",
                lg ? "h-12 text-lg sm:h-14 sm:text-2xl" : "h-10 text-sm sm:h-11 sm:text-base",
                isOpen && "border-neon bg-neon text-night shadow-[0_0_24px_rgb(6_182_212/0.55)]",
                isUsed && "border-white/5 bg-white/[0.02] text-transparent",
                !isOpen && !isUsed && "border-neon/30 bg-deep text-neon",
                !isOpen && !isUsed && canPick && "cursor-pointer hover:border-neon hover:bg-neon/15 hover:shadow-[0_0_18px_rgb(6_182_212/0.35)]",
                !canPick && !isUsed && !isOpen && "cursor-default",
              )}
            >
              {isUsed ? "" : points}
            </button>
          );
        }),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown and question
// ---------------------------------------------------------------------------

export function Countdown({ endsAt, startedAt, skew }: { endsAt: number | null; startedAt: number; skew: number }) {
  const now = useTicker(endsAt !== null) + skew;
  if (endsAt === null) return <p className="text-sm text-muted">بلا مؤقت: يُكشف الجواب عندما يجيب الجميع.</p>;
  const total = Math.max(endsAt - startedAt, 1);
  const left = Math.max(0, endsAt - now);
  const ratio = Math.min(1, left / total);
  const seconds = Math.ceil(left / 1000);
  return (
    <div className="flex items-center gap-3" aria-live="off">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cx("h-full rounded-full transition-[width] duration-200", seconds <= 5 ? "bg-crimson" : "bg-neon")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className={cx("w-10 text-end text-xl font-extrabold tabular-nums", seconds <= 5 ? "text-crimson" : "text-ivory")}>
        {seconds}
      </span>
    </div>
  );
}

function categoryName(snap: LiarsSnapshot): string {
  const id = snap.room.cell?.categoryId;
  return snap.room.categories.find((c) => c.id === id)?.nameAr ?? "";
}

/** Big-screen question: text, the four options, answered count and timer. */
export function QuestionStage({ snap, skew }: { snap: LiarsSnapshot; skew: number }) {
  const { cell, question, reveal } = snap.room;
  if (!cell || !question) return null;
  return (
    <section className="space-y-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="rounded-full border border-violet/50 bg-violet/15 px-3 py-1 text-sm font-bold text-ivory">
          {categoryName(snap)}
        </span>
        <span className="text-2xl font-extrabold tabular-nums text-neon">{cell.points} نقطة</span>
      </div>
      <h2 className="text-balance text-2xl font-extrabold leading-snug text-ivory sm:text-4xl">{question.text}</h2>
      <ol className="grid gap-3 sm:grid-cols-2">
        {question.options.map((option, i) => {
          const correct = reveal ? reveal.correctIndex === i : null;
          return (
            <li
              key={i}
              className={cx(
                "flex items-center gap-3 rounded-2xl border px-4 py-3 text-lg font-bold sm:text-xl",
                correct === true && "border-emerald bg-emerald/15 text-ivory",
                correct === false && "border-white/5 bg-white/[0.02] text-muted",
                correct === null && "border-white/10 bg-white/[0.04] text-ivory",
              )}
            >
              <span
                className={cx(
                  "grid size-9 shrink-0 place-items-center rounded-xl text-base font-extrabold",
                  correct === true ? "bg-emerald text-night" : "bg-white/10 text-neon",
                )}
              >
                {OPTION_LETTERS[i]}
              </span>
              <span className="min-w-0">{option}</span>
              {correct === true ? <Check className="ms-auto size-5 shrink-0 text-emerald" aria-label="الإجابة الصحيحة" /> : null}
            </li>
          );
        })}
      </ol>
      {snap.room.state === "question" ? (
        <div className="space-y-2">
          <Countdown endsAt={cell.endsAt} startedAt={cell.startedAt} skew={skew} />
          <p className="text-sm text-muted">
            أجاب {snap.room.answeredCount} من {snap.room.connectedCount || snap.players.length}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Who answered what, after the reveal. */
export function RevealList({ snap }: { snap: LiarsSnapshot }) {
  const { reveal, question } = snap.room;
  if (!reveal || !question) return null;
  if (!reveal.rows.length) return <p className="text-muted">لم يُجب أحد على هذا السؤال.</p>;
  return (
    <ul className="space-y-2">
      {reveal.rows.map((row) => (
        <li key={row.playerId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          {row.correct ? <Check className="size-5 shrink-0 text-emerald" aria-label="صحيحة" /> : <X className="size-5 shrink-0 text-crimson" aria-label="خاطئة" />}
          <span className="min-w-0 flex-1 truncate font-bold">{row.name}</span>
          <span className="text-sm text-muted">{OPTION_LETTERS[row.choice]}</span>
          <span className={cx("w-16 text-end font-extrabold tabular-nums", row.awarded > 0 ? "text-emerald" : row.awarded < 0 ? "text-crimson" : "text-muted")}>
            {row.awarded > 0 ? `+${row.awarded}` : row.awarded}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard and lobby
// ---------------------------------------------------------------------------

export function Leaderboard({ snap, compact = false }: { snap: LiarsSnapshot; compact?: boolean }) {
  const { players } = snap;
  if (!players.length) return <p className="text-sm text-muted">لا يوجد لاعبون بعد.</p>;
  return (
    <ol className="space-y-1.5" aria-label="ترتيب اللاعبين">
      {players.map((p, i) => (
        <LeaderRow key={p.id} player={p} rank={i + 1} snap={snap} compact={compact} />
      ))}
    </ol>
  );
}

function LeaderRow({ player, rank, snap, compact }: { player: SnapPlayer; rank: number; snap: LiarsSnapshot; compact: boolean }) {
  const picking = snap.room.state === "board" && snap.room.pickerId === player.id;
  const me = snap.you.playerId === player.id;
  return (
    <li
      className={cx(
        "flex items-center gap-2 rounded-xl border px-3",
        compact ? "py-1.5" : "py-2",
        me ? "border-neon/50 bg-neon/10" : "border-white/10 bg-white/[0.03]",
      )}
    >
      <span className={cx("w-6 text-center font-extrabold tabular-nums", rank === 1 ? "text-neon" : "text-muted")}>{rank}</span>
      <span className="min-w-0 flex-1 truncate font-bold text-ivory">
        {player.name}
        {me ? <span className="ms-1 text-xs text-neon">(أنت)</span> : null}
      </span>
      {picking ? <span className="rounded-full bg-violet/25 px-2 py-0.5 text-xs font-bold text-ivory">دوره</span> : null}
      {snap.room.state === "question" && player.answered ? <Check className="size-4 text-emerald" aria-label="أجاب" /> : null}
      {player.connected ? (
        <Wifi className="size-3.5 text-muted" aria-label="متصل" />
      ) : (
        <WifiOff className="size-3.5 text-crimson/80" aria-label="غير متصل" />
      )}
      <span className="w-16 text-end font-extrabold tabular-nums text-neon">{player.score}</span>
    </li>
  );
}

export function padLink(code: string): string {
  if (typeof window === "undefined") return `/games/liars/arena?code=${code}&view=pad`;
  return `${window.location.origin}/games/liars/arena?code=${code}&view=pad`;
}

export function Lobby({ snap, controls }: { snap: LiarsSnapshot; controls?: ReactNode }) {
  const link = padLink(snap.room.code);
  return (
    <section className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
      <div className="flex flex-col items-center gap-3">
        <QrCode text={link} className="size-48 sm:size-56" />
        <p className="text-sm text-muted">امسح الرمز بجوالك للانضمام</p>
      </div>
      <div className="space-y-5">
        <div>
          <p className="text-sm text-muted">رمز العش</p>
          <p className="text-6xl font-extrabold tracking-[0.2em] text-neon tabular-nums sm:text-7xl" dir="ltr">
            {snap.room.code}
          </p>
          <p className="mt-2 break-all text-sm text-muted" dir="ltr">
            {link}
          </p>
        </div>
        <div>
          <p className="mb-2 font-bold text-ivory">اللاعبون ({snap.players.length})</p>
          <Leaderboard snap={snap} compact />
        </div>
        {controls}
      </div>
    </section>
  );
}

export function Finished({ snap, action }: { snap: LiarsSnapshot; action?: ReactNode }) {
  const [first, second, third] = snap.players;
  return (
    <section className="space-y-6 text-center">
      <h2 className="text-3xl font-extrabold text-ivory sm:text-4xl">انتهت اللعبة</h2>
      {first ? (
        <div className="mx-auto flex max-w-xl items-end justify-center gap-3">
          {second ? <Podium player={second} place={2} height="h-24" /> : null}
          <Podium player={first} place={1} height="h-32" />
          {third ? <Podium player={third} place={3} height="h-16" /> : null}
        </div>
      ) : (
        <p className="text-muted">لم يشارك أحد في هذه الجولة.</p>
      )}
      <div className="mx-auto max-w-md text-start">
        <Leaderboard snap={snap} />
      </div>
      {action}
    </section>
  );
}

function Podium({ player, place, height }: { player: SnapPlayer; place: number; height: string }) {
  return (
    <div className="flex w-28 flex-col items-center gap-2">
      {place === 1 ? <Crown className="size-7 text-neon" aria-hidden="true" /> : null}
      <span className="w-full truncate font-extrabold text-ivory">{player.name}</span>
      <span className="font-extrabold tabular-nums text-neon">{player.score}</span>
      <div className={cx("grid w-full place-items-center rounded-t-2xl border border-neon/30 bg-neon/15 text-2xl font-extrabold text-ivory", height)}>
        {place}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player answer pad
// ---------------------------------------------------------------------------

export function AnswerPad({
  snap,
  skew,
  busy,
  onAnswer,
  onHelper,
}: {
  snap: LiarsSnapshot;
  skew: number;
  busy: boolean;
  onAnswer: (choice: number) => void;
  onHelper: () => void;
}) {
  const { cell, question, reveal, state } = snap.room;
  if (!cell || !question) return null;
  const hidden = new Set(snap.you.hidden);
  const chosen = snap.you.choice;
  const locked = chosen !== null || state !== "question" || busy;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-muted">{categoryName(snap)}</span>
        <span className="text-lg font-extrabold tabular-nums text-neon">{cell.points}</span>
      </div>
      <p className="text-balance text-xl font-extrabold leading-snug text-ivory">{question.text}</p>
      {state === "question" ? <Countdown endsAt={cell.endsAt} startedAt={cell.startedAt} skew={skew} /> : null}
      <div className="grid gap-2.5">
        {question.options.map((option, i) => {
          const isHidden = hidden.has(i);
          const isChosen = chosen === i;
          const isCorrect = reveal ? reveal.correctIndex === i : null;
          return (
            <button
              key={i}
              type="button"
              disabled={locked || isHidden}
              onClick={() => onAnswer(i)}
              aria-pressed={isChosen}
              className={cx(
                "flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-start text-lg font-bold transition",
                isHidden && "border-white/5 bg-transparent text-muted/50 line-through",
                !isHidden && isCorrect === true && "border-emerald bg-emerald/15 text-ivory",
                !isHidden && isCorrect === false && isChosen && "border-crimson bg-crimson/15 text-ivory",
                !isHidden && isCorrect === null && isChosen && "border-neon bg-neon/15 text-ivory",
                !isHidden && !isChosen && isCorrect !== true && "border-white/10 bg-white/[0.04] text-ivory",
                !locked && !isHidden && "active:scale-[0.99] hover:border-neon/60",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-base font-extrabold text-neon">
                {OPTION_LETTERS[i]}
              </span>
              <span className="min-w-0">{option}</span>
            </button>
          );
        })}
      </div>
      {state === "question" && chosen === null && snap.you.helperAvailable ? (
        <button
          type="button"
          disabled={busy}
          onClick={onHelper}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-violet/60 px-4 text-sm font-bold text-ivory hover:bg-violet/15"
        >
          <Lightbulb className="size-4 text-violet" aria-hidden="true" />
          احذف إجابتين خاطئتين (مرة واحدة)
        </button>
      ) : null}
      {state === "question" && chosen !== null ? <p className="text-center font-bold text-neon">سُجّلت إجابتك. بانتظار البقية.</p> : null}
      {state === "reveal" ? <PadResult snap={snap} /> : null}
    </section>
  );
}

function PadResult({ snap }: { snap: LiarsSnapshot }) {
  const row = snap.room.reveal?.rows.find((r) => r.playerId === snap.you.playerId);
  if (!row) return <p className="text-center font-bold text-muted">لم تُجب على هذا السؤال.</p>;
  return (
    <p className={cx("text-center text-2xl font-extrabold tabular-nums", row.correct ? "text-emerald" : "text-crimson")}>
      {row.correct ? "إجابة صحيحة" : "إجابة خاطئة"} {row.awarded > 0 ? `+${row.awarded}` : row.awarded !== 0 ? row.awarded : ""}
    </p>
  );
}
