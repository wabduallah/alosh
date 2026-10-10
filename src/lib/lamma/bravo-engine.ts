/**
 * Bravo section rules. Pure and dependency-free so both the server engine
 * (engine.server.ts) and the client create form (play.tsx) can import it.
 *
 * The Bravo section is a config + rules layer over the shared lamma engine:
 * a mode switches on existing mechanics, categories filter the question bank,
 * and the scorecard helpers rank the final table for sharing.
 */

export const BRAVO_MODES = ["quick", "roles", "rapid"] as const;
export type BravoMode = (typeof BRAVO_MODES)[number];

export const BRAVO_CATEGORIES = ["movies", "puzzles", "sports", "culture"] as const;
export type BravoCategory = (typeof BRAVO_CATEGORIES)[number];

export const BRAVO_ROUND_CHOICES = [3, 5, 10] as const;
export const BRAVO_TIMER_CHOICES = [10, 20, 30] as const;

export const BRAVO_MIN_PLAYERS = 2;
export const BRAVO_MAX_PLAYERS = 14;
export const BRAVO_DEFAULT_PLAYERS = 2;

/** Labels shown on the create form. Kept here so the server and UI agree on ids. */
export const BRAVO_MODE_INFO: Record<BravoMode, { label: string; hint: string }> = {
  quick: { label: "حفلة سريعة", hint: "أسئلة متنوعة، والإجابة الصحيحة تكسب النقاط." },
  roles: { label: "تخمين الأدوار", hint: "تكسب إذا وافقت اختيار أغلبية اللاعبين." },
  rapid: { label: "رشق سريع", hint: "مكافأة السرعة والتتابع مفعّلة تلقائياً." },
};

export const BRAVO_CATEGORY_INFO: Record<BravoCategory, string> = {
  movies: "🎬 سينما وأنيمي",
  puzzles: "🧠 ألغاز وذكاء",
  sports: "⚽ رياضة وكرة قدم",
  culture: "🇸🇦 ثقافة وعام",
};

export function parseBravoMode(value: unknown): BravoMode {
  return (BRAVO_MODES as readonly string[]).includes(value as string) ? (value as BravoMode) : "quick";
}

/**
 * Accepts an array or a single legacy category string. Unknown ids are dropped,
 * duplicates removed. An empty result means "all categories".
 */
export function parseBravoCategories(value: unknown): BravoCategory[] {
  const list = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const picked = new Set<BravoCategory>();
  for (const item of list) {
    if ((BRAVO_CATEGORIES as readonly string[]).includes(item as string)) picked.add(item as BravoCategory);
  }
  return BRAVO_CATEGORIES.filter((id) => picked.has(id));
}

type ModeFlags = {
  bravoMode: BravoMode;
  majorityMode: boolean;
  reactionBonus: boolean;
  streakMultiplier: boolean;
};

/**
 * The mode owns some rules. Role-based guessing forces group guessing on;
 * rapid fire forces reaction bonus and streaks on. Applied on every settings read,
 * so the rule holds even if a room row was written with the flags off.
 */
export function applyBravoMode<T extends ModeFlags>(settings: T): T {
  if (settings.bravoMode === "roles") return { ...settings, majorityMode: true };
  if (settings.bravoMode === "rapid") return { ...settings, reactionBonus: true, streakMultiplier: true };
  return settings;
}

export type ScorecardPlayer = { id: string; name: string; score: number };

export type ScorecardRow = ScorecardPlayer & { place: number; gap: number };

/** Competition ranking: equal scores share a place; gap is measured from the leader. */
export function rankScorecard(players: ScorecardPlayer[]): ScorecardRow[] {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const leader = ranked[0]?.score ?? 0;
  let place = 0;
  let last = Number.POSITIVE_INFINITY;
  return ranked.map((player, index) => {
    if (player.score !== last) {
      place = index + 1;
      last = player.score;
    }
    return { ...player, place, gap: leader - player.score };
  });
}

/** Plain-text scorecard for copying into a chat app. Arabic labels, no markup. */
export function buildScorecardText(input: { roomCode: string; mode: BravoMode; rows: ScorecardRow[]; top?: number }): string {
  const top = input.rows.slice(0, input.top ?? 10);
  const lines = top.map((row) => `${row.place}. ${row.name} — ${row.score}${row.gap === 0 ? " 👑" : ""}`);
  return [`🏆 نتيجة تحدي برافو (${BRAVO_MODE_INFO[input.mode].label})`, `غرفة ${input.roomCode}`, ...lines, "", "العش · al3sh.app"].join("\n");
}
