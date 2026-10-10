/**
 * «الكذابون» game rules as pure functions. No database, no clock, no randomness of
 * their own (a random source is passed in), so every rule is unit-tested.
 */
import {
  DEFAULT_TIMER,
  LEVEL_COUNT,
  MAX_CATEGORIES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  POINT_LEVELS,
  TIMER_CHOICES,
  type LiarsSettings,
} from "./types.ts";

/** Reference window for the speed bonus when the timer is off. */
export const UNTIMED_SPEED_WINDOW_MS = 30_000;
/** Answers that arrive this long after the deadline still count (network latency). */
export const LATE_GRACE_MS = 1500;
/** A player counts as connected if they polled within this window. */
export const CONNECTED_WINDOW_MS = 20_000;

export function pointsForLevel(level: number): number | null {
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_COUNT) return null;
  return POINT_LEVELS[level - 1] ?? null;
}

export function cellKey(categoryId: string, level: number): string {
  return `${categoryId}:${level}`;
}

export function parseCellKey(key: string): { categoryId: string; level: number } | null {
  const at = key.lastIndexOf(":");
  if (at <= 0) return null;
  const level = Number(key.slice(at + 1));
  if (pointsForLevel(level) === null) return null;
  return { categoryId: key.slice(0, at), level };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Normalise settings from any input. Unknown timer values fall back to the default. */
export function parseSettings(raw: unknown): LiarsSettings {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const timer = Number(src.timerSeconds);
  const max = Math.round(Number(src.maxPlayers));
  return {
    timerSeconds: (TIMER_CHOICES as readonly number[]).includes(timer) ? timer : DEFAULT_TIMER,
    fiftyFifty: bool(src.fiftyFifty, true),
    penalty: bool(src.penalty, false),
    speedBonus: bool(src.speedBonus, true),
    maxPlayers: Number.isFinite(max) ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, max)) : MAX_PLAYERS,
  };
}

/**
 * Category selection: keeps known ids only, removes duplicates, keeps the host's order,
 * and caps at MAX_CATEGORIES.
 */
export function parseCategorySelection(raw: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !known.has(item) || out.includes(item)) continue;
    out.push(item);
    if (out.length === MAX_CATEGORIES) break;
  }
  return out;
}

/**
 * Points for one answer.
 * - Correct: the cell's points, plus up to 50% for speed when the bonus is on.
 * - Wrong: minus half the points when the penalty is on, otherwise 0.
 */
export function scoreAnswer(input: {
  correct: boolean;
  points: number;
  responseMs: number;
  timerSeconds: number;
  settings: Pick<LiarsSettings, "penalty" | "speedBonus">;
}): number {
  const { correct, points, settings } = input;
  if (!correct) return settings.penalty ? -Math.round(points / 2) : 0;
  if (!settings.speedBonus) return points;
  const windowMs = input.timerSeconds > 0 ? input.timerSeconds * 1000 : UNTIMED_SPEED_WINDOW_MS;
  const t = Math.min(Math.max(input.responseMs, 0), windowMs);
  const ratio = 1 - t / windowMs;
  return points + Math.round(points * 0.5 * ratio);
}

/** The next picker after `currentId`, by seat order, wrapping around. */
export function nextPicker(players: readonly { id: string; seat: number }[], currentId: string | null): string | null {
  if (!players.length) return null;
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const at = currentId ? ordered.findIndex((p) => p.id === currentId) : -1;
  return ordered[(at + 1) % ordered.length]!.id;
}

export function totalCells(categoryCount: number): number {
  return categoryCount * LEVEL_COUNT;
}

/** True when every cell of the board has been opened. */
export function boardComplete(categoryCount: number, usedCount: number): boolean {
  return usedCount >= totalCells(categoryCount);
}

/** The question is closed when the deadline passed (plus grace) or every connected player answered. */
export function shouldClose(input: { now: number; endsAt: number | null; answered: number; connected: number }): boolean {
  if (input.endsAt !== null && input.now >= input.endsAt + LATE_GRACE_MS) return true;
  return input.connected > 0 && input.answered >= input.connected;
}

/** Answers are accepted until the deadline plus a small grace for network latency. */
export function acceptsAnswer(now: number, endsAt: number | null): boolean {
  return endsAt === null || now <= endsAt + LATE_GRACE_MS;
}

/**
 * The 50:50 helper: two wrong option indexes to hide. `random` returns [0, 1).
 * With fewer than three options, it hides what it can and never the correct one.
 */
export function pickHidden(optionCount: number, correctIndex: number, random: () => number): number[] {
  const wrong: number[] = [];
  for (let i = 0; i < optionCount; i += 1) if (i !== correctIndex) wrong.push(i);
  for (let i = wrong.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [wrong[i], wrong[j]] = [wrong[j]!, wrong[i]!];
  }
  return wrong.slice(0, Math.min(2, Math.max(0, wrong.length - 1))).sort((a, b) => a - b);
}

/** Leaderboard order: score, then fewer wrong answers, then seat. */
export function rankPlayers<T extends { score: number; wrong: number; seat: number }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => b.score - a.score || a.wrong - b.wrong || a.seat - b.seat);
}
