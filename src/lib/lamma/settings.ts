/** Room settings: the type, and a parser that accepts anything stored in rooms.settings. */
import { clamp, jparse } from "./util.ts";
import type { Locale } from "./match.ts";

export type Settings = {
  rounds: number;
  seconds: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  sound: boolean;
  music: boolean;
  maxPlayers: number;
  locale: Locale;
  hostIsPlayer: boolean;
  pointsPerCorrect: number;
  targetScore: number;
  streakMultiplier: boolean;
  eliminationMode: boolean;
  reactionBonus: boolean;
  majorityMode: boolean;
  category: string;
  hostMode: "player" | "narrator";
};

/**
 * Normalise stored settings. Unknown or out-of-range values are clamped or replaced by the
 * fallback, so a malformed row can never produce an unplayable room.
 */
export function asSettings(value: unknown, fallback?: Partial<Settings>): Settings {
  const raw = jparse<Partial<Settings>>(value, {});
  const difficulty = raw.difficulty;
  const hostIsPlayer = typeof raw.hostIsPlayer === "boolean" ? raw.hostIsPlayer : raw.hostMode !== "narrator";
  return {
    rounds: clamp(raw.rounds, 1, 15, fallback?.rounds ?? 6),
    seconds: clamp(raw.seconds, 8, 180, fallback?.seconds ?? 30),
    difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" || difficulty === "mixed" ? difficulty : (fallback?.difficulty ?? "mixed"),
    sound: raw.sound !== false,
    music: raw.music === true,
    maxPlayers: clamp(raw.maxPlayers, 2, 14, fallback?.maxPlayers ?? 2),
    locale: raw.locale === "en" ? "en" : "ar",
    hostIsPlayer,
    pointsPerCorrect: clamp(raw.pointsPerCorrect, 0, 1000, 0),
    targetScore: clamp(raw.targetScore, 0, 100000, 0),
    streakMultiplier: raw.streakMultiplier === true,
    eliminationMode: raw.eliminationMode === true,
    reactionBonus: raw.reactionBonus === true,
    majorityMode: raw.majorityMode === true,
    category: typeof raw.category === "string" ? raw.category.slice(0, 40) : "",
    hostMode: hostIsPlayer ? "player" : "narrator",
  };
}
