/**
 * «منافسة العش»: the tournament rules, with no React in them so they can be tested.
 *
 *  - Players: 2 to 14 names, typed on one phone.
 *  - A tournament round pairs everyone 1 against 1. With an odd count one player rests,
 *    and the rest goes to whoever rested least, never the same player twice in a row.
 *  - Inside a round, a player meets someone they have met less often first.
 *  - Win = 1 point, draw = ½ each, loss = 0. The first to the target (10 by default) wins.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 14;
export const NAME_MAX = 16;
export const TARGETS = [3, 5, 10] as const;
export const DEFAULT_TARGET = 10;

export type Side = "a" | "b";
export type Outcome = Side | "draw";

export type DuelPlayer = {
  id: string;
  name: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  /** Rounds this player rested in (odd counts only). */
  rests: number;
};

export type MiniGameId = "reflex" | "taps" | "precision" | "memory";

export type MiniGame = {
  id: MiniGameId;
  title: string;
  icon: string;
  /** One line each player reads before the match. */
  hint: string;
  /** The full rule, for «كيف تلعب». */
  rule: string;
  /** Lower value wins (reaction time, distance) or higher (taps). */
  better: "lower" | "higher";
};

export const MINI_GAMES: Record<MiniGameId, MiniGame> = {
  reflex: {
    id: "reflex",
    title: "ردة الفعل",
    icon: "🚦",
    hint: "انتظر الأخضر ثم اضغط زرك فورًا. الضغط على الأحمر يعطي الجولة لخصمك.",
    rule: "تظهر شاشة حمراء من ثانيتين إلى 5 ثوانٍ، ثم تصير خضراء فجأة. أول من يضغط زره بعد الأخضر يربح، ومن يضغط قبل الأخضر تذهب الجولة لخصمه.",
    better: "lower",
  },
  taps: {
    id: "taps",
    title: "النقر المتسارع",
    icon: "👆",
    hint: "انقر زرك بأسرع ما تقدر لمدة 5 ثوانٍ. الأكثر نقرات يربح.",
    rule: "5 ثوانٍ، ولكل لاعب زره. صاحب أكثر نقرات عند انتهاء الوقت يربح، والتساوي تعادل.",
    better: "higher",
  },
  precision: {
    id: "precision",
    title: "إيقاف المؤشر",
    icon: "🎯",
    hint: "المؤشر يتحرك يمينًا ويسارًا. أوقفه بضغطة في المنطقة الخضراء بالوسط.",
    rule: "مؤشر يتحرك بسرعة في شريط، وفي وسطه منطقة خضراء ضيقة. كل لاعب يضغط مرة ليوقف مؤشره، والأقرب للمركز يربح.",
    better: "lower",
  },
  memory: {
    id: "memory",
    title: "الذاكرة الخاطفة",
    icon: "🧠",
    hint: "احفظ 4 ألوان تظهر ثانية ونصف، ثم اضغطها بالترتيب نفسه. الأسرع يربح.",
    rule: "يظهر تسلسل من 4 ألوان لمدة ثانية ونصف ثم يختفي. أول من يعيده صحيحًا يربح، ومن يخطئ يخسر محاولته.",
    better: "lower",
  },
};

export const MINI_GAME_IDS = Object.keys(MINI_GAMES) as MiniGameId[];

/** One player's result in a mini-game. No result = did not finish in time. */
export type SideResult = { value?: number; foul?: boolean };

/**
 * Who won a mini-game.
 *  - A foul (pressing before green) gives the round to the other player; two fouls = draw.
 *  - No result loses to a result; two missing results = draw.
 *  - Otherwise the better value wins, and equal values are a draw.
 */
export function decide(game: MiniGameId, a: SideResult | undefined, b: SideResult | undefined): Outcome {
  const af = !!a?.foul;
  const bf = !!b?.foul;
  if (af && bf) return "draw";
  if (af) return "b";
  if (bf) return "a";
  const av = a?.value;
  const bv = b?.value;
  const ha = typeof av === "number" && Number.isFinite(av);
  const hb = typeof bv === "number" && Number.isFinite(bv);
  if (!ha && !hb) return "draw";
  if (!ha) return "b";
  if (!hb) return "a";
  if (av === bv) return "draw";
  const lower = MINI_GAMES[game].better === "lower";
  return (av! < bv!) === lower ? "a" : "b";
}

/** The next mini-game: random, but not the same as the last one. */
export function pickMiniGame(last: MiniGameId | null, rnd: () => number = Math.random): MiniGameId {
  const pool = MINI_GAME_IDS.filter((g) => g !== last);
  return pool[Math.floor(rnd() * pool.length)] ?? "reflex";
}

/** Points after a match. */
export function applyOutcome(players: DuelPlayer[], aId: string, bId: string, outcome: Outcome): DuelPlayer[] {
  return players.map((p) => {
    if (p.id !== aId && p.id !== bId) return p;
    const me: Side = p.id === aId ? "a" : "b";
    if (outcome === "draw") return { ...p, points: p.points + 0.5, draws: p.draws + 1 };
    return outcome === me ? { ...p, points: p.points + 1, wins: p.wins + 1 } : { ...p, losses: p.losses + 1 };
  });
}

/** Highest points first; then more wins; then fewer losses; then the name. */
export function ranking(players: DuelPlayer[]): DuelPlayer[] {
  return [...players].sort((x, y) => y.points - x.points || y.wins - x.wins || x.losses - y.losses || x.name.localeCompare(y.name, "ar"));
}

/** The first player at or over the target, if any. */
export function champion(players: DuelPlayer[], target: number): DuelPlayer | null {
  const top = ranking(players)[0];
  return top && top.points >= target ? top : null;
}

export type Pair = [string, string];

/** How many times two players have met. Key: the two ids, sorted, joined by «|». */
export type MetCounts = Record<string, number>;
export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One tournament round: every player in one match, or resting when the count is odd.
 *  - The rest goes to a player with the fewest rests, never to the one who rested last round.
 *  - Pairs: each player meets the opponent they have met least so far (random among equals).
 */
export function planRound(
  players: Array<Pick<DuelPlayer, "id" | "rests">>,
  met: MetCounts,
  lastRest: string | null,
  rnd: () => number = Math.random,
): { pairs: Pair[]; rest: string | null } {
  let pool = shuffle(players, rnd);
  let rest: string | null = null;
  if (pool.length % 2 === 1) {
    const allowed = pool.filter((p) => p.id !== lastRest);
    const fewest = Math.min(...allowed.map((p) => p.rests));
    rest = allowed.find((p) => p.rests === fewest)!.id;
    pool = pool.filter((p) => p.id !== rest);
  }
  // Greedy: the player with the fewest fresh opponents left picks first, then takes the least-met opponent.
  const ids = pool.map((p) => p.id);
  const pairs: Pair[] = [];
  const left = new Set(ids);
  while (left.size > 1) {
    const order = [...left].sort((x, y) => {
      const fx = [...left].filter((o) => o !== x && !met[pairKey(x, o)]).length;
      const fy = [...left].filter((o) => o !== y && !met[pairKey(y, o)]).length;
      return fx - fy;
    });
    const first = order[0];
    left.delete(first);
    const opp = [...left].sort((x, y) => (met[pairKey(first, x)] ?? 0) - (met[pairKey(first, y)] ?? 0))[0];
    left.delete(opp);
    pairs.push(rnd() < 0.5 ? [first, opp] : [opp, first]);
  }
  return { pairs: shuffle(pairs, rnd), rest };
}

/** A clean name: trimmed, single spaces, at most NAME_MAX characters. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/** Why a name cannot be added, or null when it can. */
export function nameProblem(name: string, others: string[]): string | null {
  if (!name) return "اكتب اسمًا.";
  if (others.some((o) => o.toLowerCase() === name.toLowerCase())) return "هذا الاسم موجود. اختر اسمًا آخر.";
  return null;
}

/** Shows ½ points the Arabic way: 3.5 → «3.5», 0.5 → «½». */
export function pointsText(n: number): string {
  if (n === 0.5) return "½";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
