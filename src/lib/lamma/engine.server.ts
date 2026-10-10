import { createHash, timingSafeEqual } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { letterBank, playableLetters } from "@/games/lexicon";
import {
  LETTER_CATS,
  DEFAULT_LETTER_RULES,
  scoreLetterRound,
  speedPoints,
  textMatches,
  type LetterCat,
  type LetterRules,
  type Locale,
} from "@/games/score";
import { profileFor } from "./catalog";
import { applyBravoMode, parseBravoCategories, parseBravoMode, rankScorecard, type BravoCategory, type BravoMode } from "./bravo-engine";
import { SEED_CATEGORIES, SEED_GAMES, SEED_PLANS, SEED_PROMOS } from "./seed-data";
import type { Cheer, CheerKind, Engine, Fail, GameCard, PlanCard, PublicQuestion, Reveal, RoomStatus, SnapPlayer, Snapshot } from "./types";
import { CHEER_KINDS } from "./types";

type Ctx = { userId: string | null; email: string | null };

type RoomRow = {
  id: string;
  host_token: string;
  host_user_id: string | null;
  game_id: string;
  status: string;
  current_round: number;
  settings: unknown;
  round_state: unknown;
  unlocked: boolean;
  revision: number;
  cheers: unknown;
  expires_at: unknown;
};

type GameRow = {
  id: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  category: string;
  tier: string;
  engine: string;
  min_players: number;
  max_players: number;
  default_seconds: number;
  default_rounds: number;
  scoring: unknown;
  visible: boolean;
  status: string;
  sort_order: number;
  icon: string;
  play_mode: string;
  duration_min: number;
  duration_max: number;
  rules_ar: string;
  rules_en: string;
  how_ar: string;
  how_en: string;
  created_at?: string;
  plays?: number;
};

type PlayerRow = {
  id: string;
  room_id: string;
  token: string;
  name: string;
  user_id: string | null;
  is_bot: boolean;
  score: number;
  round_score: number;
  correct_count: number;
  wrong_count: number;
  eliminated: boolean;
};

type QRow = {
  id: number;
  prompt_ar: string;
  prompt_en: string;
  kind: string;
  choices: unknown;
  correct: string | null;
  accepted: unknown;
  difficulty: string;
  icons: unknown;
  points: number;
  image_url: string | null;
};

type AnswerRow = {
  player_id: string;
  round: number;
  payload: unknown;
  response_ms: number;
  score_awarded: number;
};

type Settings = {
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
  bravoMode: BravoMode;
  categories: BravoCategory[];
  hostMode: "player" | "narrator";
};

type RoundState = {
  startedAt?: string;
  endsAt?: string | null;
  letter?: string;
  usedLetters?: string[];
  questionId?: number;
  usedQuestionIds?: number[];
  subjectId?: string | null;
  reveal?: Reveal | null;
  autoAt?: string | null;
};

type Choice = { id: string; ar: string; en: string; points?: number };

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const hits = new Map<string, { n: number; t: number }>();
const CHEER_TTL_MS = 6500;
const AUTO_NEXT_MS = 2500;
const MAJLIS_GAME = "majlis-custom";
const MAJLIS_MAX_QUESTIONS = 15;

export type MajlisQuestionInput = {
  promptAr: string;
  choices: { ar: string }[];
  correct: number;
  points: number;
};

/** Validates host-written questions. Every kept choice must be non-blank, and `correct` must point at one of them. */
function sanitizeMajlis(list: MajlisQuestionInput[] | undefined): MajlisQuestionInput[] | null {
  const out: MajlisQuestionInput[] = [];
  for (const raw of (list ?? []).slice(0, MAJLIS_MAX_QUESTIONS)) {
    const promptAr = String(raw?.promptAr ?? "").trim().slice(0, 200);
    const choices = (Array.isArray(raw?.choices) ? raw.choices : []).slice(0, 4).map((c) => ({ ar: String(c?.ar ?? "").trim().slice(0, 80) }));
    const correct = Number(raw?.correct);
    const points = clamp(raw?.points, 10, 500, 100);
    if (!promptAr || choices.length < 2 || choices.some((c) => !c.ar)) return null;
    if (!Number.isInteger(correct) || correct < 0 || correct >= choices.length) return null;
    out.push({ promptAr, choices, correct, points });
  }
  return out.length ? out : null;
}
let seeding: Promise<void> | null = null;
let lastSweep = 0;

function fail(error: string): Fail {
  return { ok: false, error };
}

function jparse<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function stamp(value: unknown): number {
  const s = iso(value);
  return s ? Date.parse(s) : 0;
}

function rid(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHA[b % ALPHA.length];
  return out;
}

function hex(size: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString("hex");
}

function tokensMatch(stored: string, given?: string): boolean {
  if (!given || given.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stored), Buffer.from(given));
  } catch {
    return false;
  }
}

function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || now - row.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    return true;
  }
  row.n += 1;
  return row.n <= max;
}

function cleanName(input: string): string | null {
  const name = input.replace(/[<>]/g, "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 16) return null;
  if (/https?:|www\./i.test(name)) return null;
  return name;
}

function asSettings(value: unknown, fallback?: Partial<Settings>): Settings {
  const raw = jparse<Partial<Settings>>(value, {});
  const difficulty = raw.difficulty;
  const hostIsPlayer = typeof raw.hostIsPlayer === "boolean" ? raw.hostIsPlayer : raw.hostMode !== "narrator";
  return applyBravoMode({
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
    bravoMode: parseBravoMode(raw.bravoMode),
    categories: parseBravoCategories(raw.categories ?? raw.category),
    hostMode: hostIsPlayer ? "player" : "narrator",
  });
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(num(value, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function ipKey(): Promise<string> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const req = getRequest();
  const ip = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req?.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

async function db(): Promise<Sql> {
  const sql = await getSql();
  await ready(sql);
  return sql;
}

export async function ready(sql: Sql): Promise<void> {
  if (!seeding) {
    seeding = seedAll(sql).catch((error) => {
      seeding = null;
      throw error;
    });
  }
  await seeding;
}

async function seedAll(sql: Sql): Promise<void> {
  const existing = await sql<{ value: unknown }>`select value from settings where key = 'seed'`;
  const flag = jparse<{ loaded?: boolean; purged?: boolean; catalog?: number }>(existing[0]?.value, {});
  if (flag.purged) return;
  if (flag.loaded && num(flag.catalog) >= 4) return;

  for (const cat of SEED_CATEGORIES) {
    await sql`insert into categories (id, name_ar, name_en, sort_order) values (${cat.id}, ${cat.ar}, ${cat.en}, ${cat.sort}) on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, sort_order = excluded.sort_order`;
  }
  for (const plan of SEED_PLANS) {
    await sql`insert into plans (id, name_ar, name_en, price_sar, interval_unit, features_ar, features_en, sort_order) values (${plan.id}, ${plan.nameAr}, ${plan.nameEn}, ${plan.price}, ${plan.interval}, ${JSON.stringify(plan.featuresAr)}::jsonb, ${JSON.stringify(plan.featuresEn)}::jsonb, ${plan.sort}) on conflict (id) do nothing`;
  }
  for (const promo of SEED_PROMOS) {
    await sql`insert into promo_codes (code, kind, amount, source) values (${promo.code}, ${promo.kind}, ${promo.amount}, 'seed') on conflict (code) do nothing`;
  }
  for (const game of SEED_GAMES) {
    await sql`insert into games (id, name_ar, name_en, description_ar, description_en, category, tier, engine, min_players, max_players, default_seconds, default_rounds, scoring, visible, status, sort_order, icon, source) values (${game.id}, ${game.nameAr}, ${game.nameEn}, ${game.descAr}, ${game.descEn}, ${game.category}, ${game.tier}, ${game.engine}, ${game.minPlayers}, ${game.maxPlayers}, ${game.seconds}, ${game.rounds}, ${JSON.stringify(game.scoring)}::jsonb, true, 'published', ${game.sort}, ${game.icon}, 'seed') on conflict (id) do nothing`;
    await sql`update games set icon = ${game.icon} where id = ${game.id} and source = 'seed'`;
    const meta = profileFor(game.id);
    await sql`update games set category = ${meta.category}, play_mode = ${meta.mode}, duration_min = ${meta.dmin}, duration_max = ${meta.dmax}, rules_ar = ${meta.rulesAr}, rules_en = ${meta.rulesEn}, how_ar = ${meta.howAr}, how_en = ${meta.howEn} where id = ${game.id} and source = 'seed'`;
    const count = await sql<{ n: number }>`select count(*) as n from questions where game_id = ${game.id} and source = 'seed'`;
    if (num(count[0]?.n) > 0 || game.questions.length === 0) continue;
    for (const q of game.questions) {
      await sql`insert into questions (game_id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, status, source) values (${game.id}, ${q.promptAr}, ${q.promptEn}, ${q.kind}, ${JSON.stringify(q.choices ?? [])}::jsonb, ${q.correct ?? null}, ${JSON.stringify(q.accepted ?? [])}::jsonb, ${q.difficulty ?? "easy"}, ${JSON.stringify(q.icons ?? [])}::jsonb, ${q.points ?? 10}, 'published', 'seed')`;
    }
  }
  const defaults: [string, unknown][] = [
    ["brand", { ar: "العش", en: "The Nest" }],
    ["ads", { enabled: false }],
    ["limits", { freeRoomsPerDay: 5, ttlHours: 6 }],
    ["studio", { code: "", open: false }],
    ["sounds", { click: "", countdown: "", correct: "", wrong: "", winner: "", round: "", lobby: "", victory: "" }],
    ["seed", { loaded: true, purged: false, catalog: 4 }],
  ];
  for (const [key, value] of defaults) {
    await sql`insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb) on conflict (key) do nothing`;
  }
  await sql`insert into settings (key, value) values ('brand', ${JSON.stringify({ ar: "العش", en: "The Nest" })}::jsonb) on conflict (key) do update set value = excluded.value`;
  await sql`insert into settings (key, value) values ('seed', ${JSON.stringify({ loaded: true, purged: false, catalog: 4 })}::jsonb) on conflict (key) do update set value = excluded.value`;
}

async function setting<T>(sql: Sql, key: string, fallback: T): Promise<T> {
  const rows = await sql<{ value: unknown }>`select value from settings where key = ${key}`;
  return jparse<T>(rows[0]?.value, fallback);
}

async function premium(sql: Sql, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const role = await sql<{ role: string }>`select role from profiles where user_id = ${userId}`;
  if (role[0]?.role === "admin") return true;
  const sub = await sql<{ id: string }>`select id from subscriptions where user_id = ${userId} and status = 'active' and (ends_at is null or ends_at > now()) limit 1`;
  return sub.length > 0;
}

async function sweep(sql: Sql): Promise<void> {
  if (Date.now() - lastSweep < 30_000) return;
  lastSweep = Date.now();
  await sql`update rooms set status = 'CLOSED', updated_at = now() where status <> 'CLOSED' and expires_at < now()`;
}

function card(game: GameRow): GameCard {
  return {
    id: game.id,
    nameAr: game.name_ar,
    nameEn: game.name_en,
    descriptionAr: game.description_ar,
    descriptionEn: game.description_en,
    category: game.category,
    tier: game.tier === "premium" ? "premium" : "free",
    engine: game.engine as Engine,
    minPlayers: game.min_players,
    maxPlayers: game.max_players,
    seconds: game.default_seconds,
    rounds: game.default_rounds,
    icon: game.icon,
    visible: game.visible,
    status: game.status,
    playMode: game.play_mode === "coop" || game.play_mode === "teams" || game.play_mode === "social" ? game.play_mode : "competitive",
    durationMin: game.duration_min || 5,
    durationMax: game.duration_max || 15,
    rulesAr: game.rules_ar || "",
    rulesEn: game.rules_en || "",
    howAr: game.how_ar || "",
    howEn: game.how_en || "",
    plays: num(game.plays),
    createdAt: game.created_at ? String(game.created_at) : "",
  };
}

export async function publicConfig(): Promise<{
  ok: true;
  brand: { ar: string; en: string };
  ads: boolean;
  plans: PlanCard[];
  strings: { ar: Record<string, string>; en: Record<string, string> };
  sounds: Record<string, string>;
}> {
  const sql = await db();
  const brand = await setting(sql, "brand", { ar: "العش", en: "The Nest" });
  const ads = await setting(sql, "ads", { enabled: false });
  const sounds = await setting<Record<string, string>>(sql, "sounds", {});
  const plans = await sql<{ id: string; name_ar: string; name_en: string; price_sar: number; interval_unit: string; features_ar: unknown; features_en: unknown }>`select * from plans where active = true order by sort_order`;
  const strings = await sql<{ locale: string; key: string; value: string }>`select locale, key, value from ui_strings`;
  const ar: Record<string, string> = {};
  const en: Record<string, string> = {};
  for (const row of strings) {
    if (row.locale === "en") en[row.key] = row.value;
    else ar[row.key] = row.value;
  }
  return {
    ok: true,
    brand,
    ads: ads.enabled === true,
    sounds,
    strings: { ar, en },
    plans: plans.map((plan) => ({
      id: plan.id,
      nameAr: plan.name_ar,
      nameEn: plan.name_en,
      priceSar: num(plan.price_sar),
      interval: plan.interval_unit,
      featuresAr: jparse<string[]>(plan.features_ar, []),
      featuresEn: jparse<string[]>(plan.features_en, []),
    })),
  };
}

export async function listGamesNow(): Promise<GameCard[]> {
  const sql = await db();
  const rows = await sql<GameRow>`select g.*, coalesce(plays.n, 0) as plays from games g left join (select game_id, count(*) as n from rooms group by game_id) plays on plays.game_id = g.id where g.visible = true and g.status = 'published' order by g.sort_order`;
  return rows.map(card);
}

export async function gameDetail(id: string): Promise<GameCard | null> {
  const sql = await db();
  const rows = await sql<GameRow>`select * from games where id = ${id}`;
  const game = rows[0];
  if (!game || !game.visible || game.status !== "published") return null;
  return card(game);
}

export async function createRoomNow(
  input: {
    gameId: string;
    rounds: number;
    seconds: number;
    difficulty: Settings["difficulty"];
    sound: boolean;
    music: boolean;
    maxPlayers: number;
    locale: Locale;
    promo?: string;
    hostName?: string;
    hostMode?: "player" | "narrator";
    hostIsPlayer?: boolean;
    pointsPerCorrect?: number;
    targetScore?: number;
    streakMultiplier?: boolean;
    eliminationMode?: boolean;
    reactionBonus?: boolean;
    majorityMode?: boolean;
    category?: string;
    bravoMode?: string;
    categories?: string[];
    customQuestions?: MajlisQuestionInput[];
  },
  ctx: Ctx,
): Promise<Fail | { ok: true; code: string; hostToken: string; playerId?: string; playerToken?: string }> {
  const sql = await db();
  const ip = await ipKey();
  if (!allow(`create:${ip}`, 200, 60 * 60 * 1000)) return fail("RATE");
  const games = await sql<GameRow>`select * from games where id = ${input.gameId} and (visible = true or id = ${MAJLIS_GAME}) and status = 'published'`;
  const game = games[0];
  if (!game) return fail("GAME");
  const majlisQuestions = game.id === MAJLIS_GAME ? sanitizeMajlis(input.customQuestions) : null;
  if (game.id === MAJLIS_GAME && !majlisQuestions) return fail("NO_QUESTIONS");
  const hostName = input.hostName ? cleanName(input.hostName) : null;
  if (input.hostName && !hostName) return fail("NAME_INVALID");
  const settings = asSettings(
    {
      rounds: majlisQuestions ? majlisQuestions.length : input.rounds || game.default_rounds,
      seconds: input.seconds || game.default_seconds,
      difficulty: input.difficulty,
      sound: input.sound,
      music: input.music,
      maxPlayers: Math.min(14, Math.max(2, game.min_players, Math.round(input.maxPlayers) || 2)),
      locale: input.locale,
      hostIsPlayer: input.hostIsPlayer ?? input.hostMode !== "narrator",
      pointsPerCorrect: majlisQuestions ? 0 : input.pointsPerCorrect,
      targetScore: input.targetScore,
      streakMultiplier: input.streakMultiplier === true,
      eliminationMode: input.eliminationMode === true,
      reactionBonus: input.reactionBonus === true,
      majorityMode: input.majorityMode === true,
      category: input.category ?? "",
      bravoMode: input.bravoMode,
      categories: input.categories,
    },
    { rounds: game.default_rounds, seconds: game.default_seconds },
  );
  const limits = await setting(sql, "limits", { ttlHours: 6, freeRoomsPerDay: 5 });
  const hours = clamp(limits.ttlHours, 1, 24, 6);
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code = rid(5);
    const clash = await sql<{ id: string }>`select id from rooms where id = ${code}`;
    if (!clash.length) break;
  }
  const hostToken = hex(16);
  await sql`insert into rooms (id, host_token, host_user_id, host_ip, game_id, status, settings, round_state, unlocked, expires_at) values (${code}, ${hostToken}, ${ctx.userId}, ${ip}, ${game.id}, 'WAITING', ${JSON.stringify(settings)}::jsonb, '{}'::jsonb, true, now() + (${hours} * interval '1 hour'))`;
  // Majlis questions are inserted in host order; ids are serial, so `order by id` keeps that order.
  for (const q of majlisQuestions ?? []) {
    const choices = q.choices.map((c, i) => ({ id: `c${i}`, ar: c.ar, en: c.ar }));
    await sql`insert into questions (game_id, room_id, prompt_ar, prompt_en, kind, choices, correct, points, status, source) values (${MAJLIS_GAME}, ${code}, ${q.promptAr}, ${q.promptAr}, 'mcq', ${JSON.stringify(choices)}::jsonb, ${`c${q.correct}`}, ${q.points}, 'published', 'host')`;
  }
  // Host-as-player: the host always gets a real seat (and therefore a Player Pad) when hostIsPlayer is set.
  if (!settings.hostIsPlayer) return { ok: true, code, hostToken };
  const seatName = hostName ?? (input.locale === "en" ? "Host" : "المضيف");
  const playerId = rid(8);
  const playerToken = hex(16);
  await sql`insert into players (id, room_id, token, name, user_id) values (${playerId}, ${code}, ${playerToken}, ${seatName}, ${ctx.userId})`;
  return { ok: true, code, hostToken, playerId, playerToken };
}

export async function joinRoomNow(input: { code: string; name: string }, ctx: Ctx): Promise<Fail | { ok: true; code: string; playerId: string; playerToken: string }> {
  const sql = await db();
  const ip = await ipKey();
  if (!allow(`join:${ip}`, 30, 60 * 1000)) return fail("RATE");
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const name = cleanName(input.name);
  if (!name) return fail("NAME_INVALID");
  const rooms = await sql<RoomRow>`select * from rooms where id = ${code}`;
  const room = rooms[0];
  if (!room || room.status === "CLOSED") return fail("ROOM_NOT_FOUND");
  if (stamp(room.expires_at) < Date.now()) return fail("ROOM_NOT_FOUND");
  if (room.status !== "WAITING" && room.status !== "STARTING") return fail("STARTED");
  const settings = asSettings(room.settings);
  const players = await sql<PlayerRow>`select * from players where room_id = ${code}`;
  if (players.length >= settings.maxPlayers) return fail("ROOM_FULL");
  if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail("NAME_TAKEN");
  const playerId = rid(8);
  const playerToken = hex(16);
  await sql`insert into players (id, room_id, token, name, user_id) values (${playerId}, ${code}, ${playerToken}, ${name}, ${ctx.userId})`;
  await sql`update rooms set revision = revision + 1, updated_at = now() where id = ${code}`;
  return { ok: true, code, playerId, playerToken };
}

async function bundle(sql: Sql, code: string) {
  const rooms = await sql<RoomRow>`select * from rooms where id = ${code}`;
  const room = rooms[0];
  if (!room) return null;
  const games = await sql<GameRow>`select * from games where id = ${room.game_id}`;
  const players = await sql<PlayerRow>`select * from players where room_id = ${code} order by joined_at`;
  return { room, game: games[0], players };
}

function toPublic(q: QRow, hideChoices: boolean): PublicQuestion {
  const choices = hideChoices ? [] : jparse<Choice[]>(q.choices, []).map((c) => ({ id: c.id, ar: c.ar, en: c.en }));
  return {
    id: q.id,
    promptAr: q.prompt_ar,
    promptEn: q.prompt_en,
    kind: q.kind,
    choices,
    icons: jparse<string[]>(q.icons, []),
    imageUrl: q.image_url ?? null,
  };
}

async function questionById(sql: Sql, id: number | undefined): Promise<QRow | null> {
  if (!id) return null;
  const rows = await sql<QRow>`select id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, image_url from questions where id = ${id}`;
  return rows[0] ?? null;
}

async function buildSnap(sql: Sql, code: string, hostToken?: string, playerToken?: string): Promise<Snapshot | Fail> {
  const data = await bundle(sql, code);
  if (!data?.game) return fail("ROOM_NOT_FOUND");
  let { room } = data;
  if (stamp(room.expires_at) < Date.now() && room.status !== "CLOSED") {
    await sql`update rooms set status = 'CLOSED', updated_at = now(), revision = revision + 1 where id = ${code}`;
    room = { ...room, status: "CLOSED" };
  }
  const state = jparse<RoundState>(room.round_state, {});
  if (room.status === "PLAYING" && state.endsAt && Date.parse(state.endsAt) <= Date.now()) {
    await closeRound(sql, code, false);
  }
  await advanceIfDue(sql, code);
  const fresh = await bundle(sql, code);
  if (!fresh?.game) return fail("ROOM_NOT_FOUND");
  const settings = asSettings(fresh.room.settings);
  const roundState = jparse<RoundState>(fresh.room.round_state, {});
  const you = playerToken ? fresh.players.find((p) => tokensMatch(p.token, playerToken)) : undefined;
  if (you) {
    await sql`update players set last_seen = now() where id = ${you.id}`;
  }
  const answers = await sql<AnswerRow>`select player_id, round, payload, response_ms, score_awarded from answers where room_id = ${code} and round = ${fresh.room.current_round}`;
  const answered = new Set(answers.map((a) => a.player_id));
  const q = await questionById(sql, roundState.questionId);
  const hide = q ? q.kind === "feud" || q.kind === "text" || fresh.room.status === "WAITING" : false;
  const showReveal = fresh.room.status === "ROUND_END" || fresh.room.status === "FINISHED";
  const players: SnapPlayer[] = fresh.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    roundScore: p.round_score,
    answered: answered.has(p.id),
    isBot: p.is_bot,
    correct: p.correct_count,
    wrong: p.wrong_count,
    eliminated: p.eliminated,
  }));
  return {
    ok: true,
    revision: fresh.room.revision,
    youAreHost: tokensMatch(fresh.room.host_token, hostToken),
    yourId: you?.id ?? null,
    yourAnswered: you ? answered.has(you.id) : false,
    yourRoundScore: you?.round_score ?? 0,
    cheers: publicCheers(fresh.room.cheers),
    room: {
      code,
      status: fresh.room.status as RoomStatus,
      gameId: fresh.game.id,
      nameAr: fresh.game.name_ar,
      nameEn: fresh.game.name_en,
      engine: fresh.game.engine as Engine,
      playMode: fresh.game.play_mode === "coop" || fresh.game.play_mode === "teams" || fresh.game.play_mode === "social" ? fresh.game.play_mode : "competitive",
      round: fresh.room.current_round,
      rounds: settings.rounds,
      seconds: settings.seconds,
      locale: settings.locale,
      sound: settings.sound,
      music: settings.music,
      letter: roundState.letter ?? null,
      endsAt: roundState.endsAt ?? null,
      auto: Boolean(roundState.autoAt),
      question: q && fresh.room.status !== "WAITING" ? toPublic(q, hide && !showReveal) : null,
      reveal: showReveal ? (roundState.reveal ?? null) : null,
      subjectId: roundState.subjectId ?? null,
      minPlayers: fresh.game.min_players,
      maxPlayers: settings.maxPlayers,
      hostIsPlayer: settings.hostIsPlayer,
      pointsPerCorrect: settings.pointsPerCorrect,
      targetScore: settings.targetScore,
      streakMultiplier: settings.streakMultiplier,
      eliminationMode: settings.eliminationMode,
      reactionBonus: settings.reactionBonus,
      majorityMode: settings.majorityMode,
      category: settings.category,
      bravoMode: settings.bravoMode,
      categories: settings.categories,
      hostMode: settings.hostMode,
      hostAnswer: tokensMatch(fresh.room.host_token, hostToken) && settings.hostMode === "narrator" ? (q?.correct ?? null) : null,
    },
    players,
  };
}

export async function snapshotNow(input: { code: string; hostToken?: string; playerToken?: string }): Promise<Snapshot | Fail> {
  const sql = await db();
  await sweep(sql);
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return buildSnap(sql, code, input.hostToken, input.playerToken);
}

/** Round N of a Majlis room is the N-th question the host wrote for that room. */
async function majlisQuestion(sql: Sql, code: string, round: number): Promise<QRow | null> {
  const rows = await sql<QRow>`select id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, image_url from questions where room_id = ${code} order by id offset ${round - 1} limit 1`;
  return rows[0] ?? null;
}

async function pickQuestion(sql: Sql, gameId: string, state: RoundState, difficulty: Settings["difficulty"], categories: string[] = []): Promise<QRow | null> {
  // Pick one row in SQL instead of loading the whole pool. Preference order:
  // category + difficulty, category, difficulty, anything. Questions already used this game
  // are skipped; if every question has been used, the final level allows repeats.
  const used = state.usedQuestionIds ?? [];
  const diff = difficulty === "mixed" ? null : difficulty;
  const levels: Array<{ cats: string[]; diff: string | null }> = [];
  if (categories.length) {
    if (diff) levels.push({ cats: categories, diff });
    levels.push({ cats: categories, diff: null });
  }
  if (diff) levels.push({ cats: [], diff });
  levels.push({ cats: [], diff: null });
  for (const level of levels) {
    const rows = await sql<QRow>`select id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, image_url from questions where game_id = ${gameId} and status = 'published' and room_id is null ${level.cats.length ? sql`and category = any(${level.cats})` : sql``} ${level.diff ? sql`and difficulty = ${level.diff}` : sql``} ${used.length ? sql`and not (id = any(${used}))` : sql``} order by random() limit 1`;
    if (rows[0]) return rows[0];
  }
  const repeats = await sql<QRow>`select id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, image_url from questions where game_id = ${gameId} and status = 'published' and room_id is null order by random() limit 1`;
  return repeats[0] ?? null;
}

async function openRound(sql: Sql, code: string, round: number): Promise<Fail | { ok: true }> {
  const data = await bundle(sql, code);
  if (!data?.game) return fail("ROOM_NOT_FOUND");
  const settings = asSettings(data.room.settings);
  const prev = jparse<RoundState>(data.room.round_state, {});
  const engine = data.game.engine as Engine;
  const state: RoundState = {
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + settings.seconds * 1000).toISOString(),
    usedLetters: prev.usedLetters ?? [],
    usedQuestionIds: prev.usedQuestionIds ?? [],
    reveal: null,
  };
  if (engine === "letter") {
    const poolAll = playableLetters(settings.locale);
    const fresh = poolAll.filter((letter) => !(state.usedLetters ?? []).includes(letter));
    const pool = fresh.length ? fresh : poolAll;
    const letter = pool[Math.floor(Math.random() * pool.length)] ?? "س";
    state.letter = letter;
    state.usedLetters = [...(state.usedLetters ?? []), letter];
  } else {
    const q = data.game.id === MAJLIS_GAME ? await majlisQuestion(sql, code, round) : await pickQuestion(sql, data.game.id, prev, settings.difficulty, settings.categories);
    if (!q) return fail("NO_QUESTIONS");
    state.questionId = q.id;
    state.usedQuestionIds = [...(prev.usedQuestionIds ?? []), q.id];
    if (engine === "whoknows") {
      const humans = data.players.filter((p) => !p.is_bot);
      const pool = humans.length ? humans : data.players;
      state.subjectId = pool[(round - 1) % Math.max(pool.length, 1)]?.id ?? null;
    }
  }
  await sql`update players set round_score = 0 where room_id = ${code}`;
  await sql`update rooms set status = 'PLAYING', current_round = ${round}, round_state = ${JSON.stringify(state)}::jsonb, revision = revision + 1, updated_at = now() where id = ${code}`;
  return { ok: true };
}

async function mergedBank(sql: Sql, locale: Locale) {
  const bank = structuredClone(letterBank(locale));
  const extra = await sql<{ letter: string; category: string; word: string }>`select letter, category, word from lexicon where locale = ${locale}`;
  for (const row of extra) {
    const cat = row.category as LetterCat;
    if (!LETTER_CATS.includes(cat)) continue;
    if (!bank[row.letter]) {
      bank[row.letter] = { boy: [], girl: [], animal: [], object: [], country: [] };
    }
    const list = bank[row.letter]![cat];
    if (!list.includes(row.word)) list.push(row.word);
  }
  return bank;
}

function payloadObj(value: unknown): Record<string, unknown> {
  return jparse<Record<string, unknown>>(value, {});
}

type StoredCheer = { id: string; playerId: string; name: string; kind: CheerKind; at: number };

function isCheerKind(value: string): value is CheerKind {
  return (CHEER_KINDS as string[]).includes(value);
}

function publicCheers(value: unknown): Cheer[] {
  const now = Date.now();
  return jparse<StoredCheer[]>(value, [])
    .filter((row) => row && isCheerKind(row.kind) && typeof row.id === "string" && now - row.at < CHEER_TTL_MS && now - row.at > -4000)
    .slice(-12)
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind, at: row.at }));
}

async function appendCheers(sql: Sql, code: string, incoming: StoredCheer[]): Promise<void> {
  if (!incoming.length) return;
  const cutoff = Date.now() - CHEER_TTL_MS;
  await sql`
    update rooms
    set cheers = (
      select coalesce(jsonb_agg(item order by (item->>'at')::bigint), '[]'::jsonb)
      from (
        select item
        from jsonb_array_elements(coalesce(cheers, '[]'::jsonb) || ${JSON.stringify(incoming)}::jsonb) as item
        where coalesce((item->>'at')::bigint, 0) > ${cutoff}
        order by (item->>'at')::bigint desc
        limit 18
      ) newest
    )
    where id = ${code}
  `;
}

async function fillBots(sql: Sql, code: string, round: number, engine: Engine, settings: Settings, state: RoundState, q: QRow | null) {
  const players = await sql<PlayerRow>`select * from players where room_id = ${code} and is_bot = true`;
  const existing = await sql<{ player_id: string }>`select player_id from answers where room_id = ${code} and round = ${round}`;
  const have = new Set(existing.map((row) => row.player_id));
  const windowMs = settings.seconds * 1000;
  const botCheers: StoredCheer[] = [];
  let shared: Partial<Record<LetterCat, string>> | null = null;
  if (engine === "letter" && state.letter) {
    const bank = letterBank(settings.locale)[state.letter];
    shared = {};
    if (bank) {
      for (const cat of LETTER_CATS) {
        const list = bank[cat];
        if (list?.length) shared[cat] = list[0];
      }
    }
  }
  for (const bot of players) {
    if (have.has(bot.id)) continue;
    let payload: Record<string, unknown> = {};
    if (engine === "letter" && state.letter) {
      const bank = letterBank(settings.locale)[state.letter];
      const fields: Record<string, string> = {};
      for (const cat of LETTER_CATS) {
        const list = bank?.[cat] ?? [];
        if (!list.length) {
          fields[cat] = "";
          continue;
        }
        const roll = Math.random();
        if (roll < 0.15) fields[cat] = "—";
        else if (roll < 0.4 && shared?.[cat]) fields[cat] = shared[cat]!;
        else fields[cat] = list[Math.floor(Math.random() * list.length)]!;
      }
      payload = { fields };
    } else if (engine === "vote") {
      const all = await sql<{ id: string }>`select id from players where room_id = ${code} and id <> ${bot.id}`;
      const pick = all[Math.floor(Math.random() * all.length)];
      if (!pick) continue;
      payload = { playerId: pick.id };
    } else if (engine === "text" || engine === "feud") {
      if (engine === "feud" && q) {
        const choices = jparse<Choice[]>(q.choices, []);
        const pick = choices[Math.floor(Math.random() * choices.length)];
        payload = { text: pick?.ar ?? "" };
      } else if (q?.correct && Math.random() < 0.55) payload = { text: q.correct };
      else payload = { text: "..." };
    } else if (engine === "truth") {
      payload = { side: Math.random() < 0.5 ? "truth" : "dare" };
    } else if (q) {
      const choices = jparse<Choice[]>(q.choices, []);
      if (!choices.length) continue;
      const correct = choices.find((c) => c.id === q.correct) ?? choices[0]!;
      const pick = engine === "whoknows" ? choices[Math.floor(Math.random() * choices.length)]! : Math.random() < 0.62 ? correct : choices[Math.floor(Math.random() * choices.length)]!;
      payload = { choiceId: pick.id };
    }
    const response = 1200 + Math.floor(Math.random() * Math.max(1000, windowMs - 1500));
    await sql`insert into answers (room_id, player_id, round, payload, response_ms) values (${code}, ${bot.id}, ${round}, ${JSON.stringify(payload)}::jsonb, ${response}) on conflict (room_id, player_id, round) do nothing`;
    if (Math.random() < 0.8) {
      botCheers.push({
        id: hex(8),
        playerId: bot.id,
        name: bot.name,
        kind: CHEER_KINDS[Math.floor(Math.random() * CHEER_KINDS.length)] ?? "spark",
        at: Date.now() + botCheers.length * 180,
      });
    }
  }
  if (botCheers.length) await appendCheers(sql, code, botCheers);
}

async function addScore(sql: Sql, playerId: string, points: number, correct: number, wrong: number) {
  await sql`update players set score = score + ${points}, round_score = ${points}, correct_count = correct_count + ${correct}, wrong_count = wrong_count + ${wrong} where id = ${playerId}`;
}

async function autoCloseIfComplete(sql: Sql, code: string): Promise<boolean> {
  const data = await bundle(sql, code);
  if (!data || data.room.status !== "PLAYING") return false;
  const humans = data.players.filter((player) => !player.is_bot);
  if (!humans.length) return false;
  const rows = await sql<{ player_id: string }>`select player_id from answers where room_id = ${code} and round = ${data.room.current_round}`;
  const have = new Set(rows.map((row) => row.player_id));
  if (!humans.every((player) => have.has(player.id))) return false;
  await closeRound(sql, code, true, true);
  return true;
}

async function advanceIfDue(sql: Sql, code: string): Promise<void> {
  const data = await bundle(sql, code);
  if (!data || data.room.status !== "ROUND_END") return;
  const state = jparse<RoundState>(data.room.round_state, {});
  if (!state.autoAt || Date.parse(state.autoAt) > Date.now()) return;
  const locked = await sql<{ id: string }>`update rooms set status = 'SCORING' where id = ${code} and status = 'ROUND_END' returning id`;
  if (!locked.length) return;
  try {
    const settings = asSettings(data.room.settings);
    if (data.room.current_round >= settings.rounds || reachedTarget(data.players, settings) || eliminationOver(data.players, settings)) {
      await finishGame(sql, code);
      return;
    }
    const opened = await openRound(sql, code, data.room.current_round + 1);
    if (!opened.ok) await sql`update rooms set status = 'ROUND_END' where id = ${code} and status = 'SCORING'`;
  } catch (error) {
    console.error("[esh] auto next failed", error);
    await sql`update rooms set status = 'ROUND_END' where id = ${code} and status = 'SCORING'`;
  }
}

// Every round end auto-advances (2.5s reveal) unless the engine needs host review (letter/truth).
async function closeRound(sql: Sql, code: string, force: boolean, auto = true): Promise<void> {
  const data = await bundle(sql, code);
  if (!data?.game || data.room.status !== "PLAYING") return;
  const state = jparse<RoundState>(data.room.round_state, {});
  if (!force && state.endsAt && Date.parse(state.endsAt) > Date.now()) return;
  const locked = await sql<{ id: string }>`update rooms set status = 'SCORING', revision = revision + 1 where id = ${code} and status = 'PLAYING' returning id`;
  if (!locked.length) return;
  try {
    await scoreLocked(sql, code, auto);
  } catch (error) {
    console.error("[lamma] score failed", error);
    await sql`update rooms set status = 'PLAYING' where id = ${code} and status = 'SCORING'`;
    throw error;
  }
}

// Points for a correct answer: the host's override wins, else the question's value, else the game default.
function correctPoints(settings: Settings, q: { points: number } | null, scoring: Record<string, number>): number {
  if (settings.pointsPerCorrect > 0) return settings.pointsPerCorrect;
  return num(q?.points, num(scoring.correct, 10));
}

// Target-score rooms end as soon as a human reaches the target (rounds remain the hard cap).
/** Elimination mode ends the game once one active player remains (only after at least two joined). */
function eliminationOver(players: { eliminated: boolean }[], settings: Settings): boolean {
  if (!settings.eliminationMode || players.length < 2) return false;
  return players.filter((p) => !p.eliminated).length <= 1;
}

function reachedTarget(players: { score: number; is_bot: boolean }[], settings: Settings): boolean {
  return settings.targetScore > 0 && players.some((p) => !p.is_bot && p.score >= settings.targetScore);
}

/** Kalak-style streak bonus: 2 correct in a row doubles the next answer, 4 in a row triples it (capped at x3). Only contiguous rounds count. */
async function streakMultiplier(sql: Sql, code: string, playerId: string, round: number): Promise<number> {
  const rows = await sql<{ round: number; correct: boolean | null }>`select round, correct from answers where room_id = ${code} and player_id = ${playerId} and round < ${round} order by round desc limit 10`;
  let expected = round - 1;
  let streak = 0;
  for (const row of rows) {
    if (row.round !== expected || row.correct !== true) break;
    streak += 1;
    expected -= 1;
  }
  return Math.min(3, 1 + Math.floor(streak / 2));
}

/** Kalak-style reaction bonus: 2x for an instant answer, 1x at the end of the window. */
function reactionMultiplier(ms: number, windowMs: number): number {
  const ratio = windowMs > 0 ? Math.min(1, Math.max(0, ms / windowMs)) : 1;
  return 1 + (1 - ratio);
}

/** Bravo group guess: the choice most players picked. A tie means no group answer, so nobody scores. */
function majorityChoice(players: { id: string }[], byPlayer: Map<string, AnswerRow>): string | null {
  const counts = new Map<string, number>();
  for (const p of players) {
    const id = String(payloadObj(byPlayer.get(p.id)?.payload).choiceId ?? "");
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let top = 0;
  let tie = false;
  for (const [id, n] of counts) {
    if (n > top) {
      best = id;
      top = n;
      tie = false;
    } else if (n === top) {
      tie = true;
    }
  }
  return tie ? null : best;
}

async function scoreLocked(sql: Sql, code: string, auto = false): Promise<void> {
  const data = await bundle(sql, code);
  if (!data?.game) return;
  const settings = asSettings(data.room.settings);
  const state = jparse<RoundState>(data.room.round_state, {});
  const engine = data.game.engine as Engine;
  const scoring = jparse<Record<string, number>>(data.game.scoring, {});
  const round = data.room.current_round;
  const q = await questionById(sql, state.questionId);
  await fillBots(sql, code, round, engine, settings, state, q);
  const answers = await sql<AnswerRow>`select player_id, round, payload, response_ms, score_awarded from answers where room_id = ${code} and round = ${round}`;
  const byPlayer = new Map(answers.map((row) => [row.player_id, row]));
  const reveal: Reveal = {};
  const rules: LetterRules = {
    unique: num(scoring.unique, DEFAULT_LETTER_RULES.unique),
    duplicate: num(scoring.duplicate, DEFAULT_LETTER_RULES.duplicate),
    wrong: num(scoring.wrong, 0),
    empty: num(scoring.empty, 0),
  };

  if (engine === "letter" && state.letter) {
    const bank = await mergedBank(sql, settings.locale);
    const submissions = data.players.map((player) => {
      const raw = payloadObj(byPlayer.get(player.id)?.payload).fields;
      const fields = jparse<Record<string, string>>(raw, {});
      return {
        playerId: player.id,
        fields: {
          boy: String(fields.boy ?? ""),
          girl: String(fields.girl ?? ""),
          animal: String(fields.animal ?? ""),
          object: String(fields.object ?? ""),
          country: String(fields.country ?? ""),
        },
      };
    });
    const scored = scoreLetterRound({ submissions, letter: state.letter, locale: settings.locale, bank, rules });
    reveal.letterRows = scored.map((row) => ({
      playerId: row.playerId,
      name: data.players.find((p) => p.id === row.playerId)?.name ?? "",
      fields: row.fields,
      total: row.total,
    }));
    for (const row of scored) {
      if (byPlayer.has(row.playerId)) {
        await sql`update answers set payload = ${JSON.stringify({ fields: row.fields })}::jsonb, score_awarded = ${row.total}, correct = ${row.correct > 0} where room_id = ${code} and player_id = ${row.playerId} and round = ${round}`;
      }
      await addScore(sql, row.playerId, row.total, row.correct, row.wrong);
    }
  } else if (engine === "vote") {
    const counts = new Map<string, number>();
    for (const player of data.players) {
      const target = String(payloadObj(byPlayer.get(player.id)?.payload).playerId ?? "");
      if (!target || target === player.id) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    let best = 0;
    for (const n of counts.values()) best = Math.max(best, n);
    const pts = num(scoring.winner, 10);
    reveal.votes = data.players.map((p) => ({ playerId: p.id, name: p.name, count: counts.get(p.id) ?? 0 }));
    for (const player of data.players) {
      const won = best > 0 && (counts.get(player.id) ?? 0) === best;
      await addScore(sql, player.id, won ? pts : 0, won ? 1 : 0, 0);
    }
  } else if (engine === "choice") {
    const choices = q ? jparse<Choice[]>(q.choices, []) : [];
    const counts = new Map<string, number>();
    for (const choice of choices) counts.set(choice.id, 0);
    const pts = num(scoring.answer, 5);
    for (const player of data.players) {
      const choiceId = String(payloadObj(byPlayer.get(player.id)?.payload).choiceId ?? "");
      if (!choiceId) {
        await addScore(sql, player.id, 0, 0, 0);
        continue;
      }
      counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
      await addScore(sql, player.id, pts, 1, 0);
    }
    reveal.percents = choices.map((c) => ({ id: c.id, ar: c.ar, en: c.en, n: counts.get(c.id) ?? 0 }));
  } else if (engine === "truth") {
    const choices = q ? jparse<Choice[]>(q.choices, []) : [];
    const pts = num(scoring.pick, 5);
    reveal.truth = [];
    for (const player of data.players) {
      const side = String(payloadObj(byPlayer.get(player.id)?.payload).side ?? "");
      const choice = choices.find((c) => c.id === side);
      if (!choice) {
        await addScore(sql, player.id, 0, 0, 0);
        continue;
      }
      reveal.truth.push({ playerId: player.id, name: player.name, side, promptAr: choice.ar, promptEn: choice.en });
      await addScore(sql, player.id, pts, 1, 0);
    }
  } else if (engine === "feud" && q) {
    const choices = jparse<Choice[]>(q.choices, []);
    const claimed = new Map<string, number>();
    reveal.feudHits = [];
    for (const player of data.players) {
      const text = String(payloadObj(byPlayer.get(player.id)?.payload).text ?? "");
      const match = choices.find((c) => textMatches(text, [c.ar, c.en], settings.locale) || textMatches(text, [c.ar, c.en], settings.locale === "ar" ? "en" : "ar"));
      if (!match) {
        await addScore(sql, player.id, 0, 0, 1);
        continue;
      }
      const seen = claimed.get(match.id) ?? 0;
      claimed.set(match.id, seen + 1);
      const full = num(match.points, 10);
      const points = seen === 0 ? full : Math.round(full / 2);
      reveal.feudHits.push({ playerId: player.id, name: player.name, text, points });
      await addScore(sql, player.id, points, 1, 0);
    }
  } else if ((engine === "text" || engine === "quiz" || engine === "truefalse" || engine === "fastest" || engine === "picture" || engine === "whoknows") && q) {
    if (engine === "whoknows") {
      const subjectId = state.subjectId;
      const key = String(payloadObj(byPlayer.get(subjectId ?? "")?.payload).choiceId ?? "");
      const choices = jparse<Choice[]>(q.choices, []);
      const matchPts = num(scoring.match, 10);
      const knownPts = num(scoring.known, 5);
      let matches = 0;
      reveal.answers = [];
      for (const player of data.players) {
        const choiceId = String(payloadObj(byPlayer.get(player.id)?.payload).choiceId ?? "");
        const label = choices.find((c) => c.id === choiceId);
        if (player.id === subjectId) continue;
        const ok = Boolean(key) && choiceId === key;
        if (ok) matches += 1;
        reveal.answers.push({ playerId: player.id, name: player.name, text: label?.ar ?? "", points: ok ? matchPts : 0, correct: ok });
        await addScore(sql, player.id, ok ? matchPts : 0, ok ? 1 : 0, !ok && choiceId ? 1 : 0);
      }
      if (subjectId) await addScore(sql, subjectId, matches > 0 ? knownPts : 0, matches > 0 ? 1 : 0, 0);
      const subjectChoice = choices.find((c) => c.id === key);
      reveal.correctId = key;
      reveal.correctAr = subjectChoice?.ar;
      reveal.correctEn = subjectChoice?.en;
    } else if (engine === "text") {
      const accepted = [q.correct ?? "", ...jparse<string[]>(q.accepted, [])].filter(Boolean);
      reveal.correctAr = q.correct ?? "";
      reveal.answers = [];
      const pts = correctPoints(settings, q, scoring);
      for (const player of data.players) {
        const text = String(payloadObj(byPlayer.get(player.id)?.payload).text ?? "");
        const ok = textMatches(text, accepted, settings.locale) || textMatches(text, accepted, "en");
        reveal.answers.push({ playerId: player.id, name: player.name, text, points: ok ? pts : 0, correct: ok });
        await addScore(sql, player.id, ok ? pts : 0, ok ? 1 : 0, text && !ok ? 1 : 0);
      }
    } else {
      const choices = jparse<Choice[]>(q.choices, []);
      const target = settings.majorityMode ? majorityChoice(data.players, byPlayer) : q.correct;
      const correct = choices.find((c) => c.id === target);
      reveal.correctId = target ?? undefined;
      reveal.correctAr = correct?.ar;
      reveal.correctEn = correct?.en;
      reveal.answers = [];
      const windowMs = settings.seconds * 1000;
      const survivors: string[] = [];
      for (const player of data.players) {
        const row = byPlayer.get(player.id);
        const choiceId = String(payloadObj(row?.payload).choiceId ?? "");
        const ok = Boolean(target) && choiceId === target;
        if (ok) survivors.push(player.id);
        let points = 0;
        if (ok && engine === "fastest") {
          points = speedPoints(num(row?.response_ms), windowMs, num(scoring.base, 400), num(scoring.speed, 600));
        } else if (ok) {
          points = correctPoints(settings, q, scoring);
          if (settings.streakMultiplier) points *= await streakMultiplier(sql, code, player.id, round);
          if (settings.reactionBonus) points = Math.round(points * reactionMultiplier(num(row?.response_ms), windowMs));
        }
        const label = choices.find((c) => c.id === choiceId);
        reveal.answers.push({ playerId: player.id, name: player.name, text: label?.ar ?? "", points, correct: ok });
        await addScore(sql, player.id, points, ok ? 1 : 0, choiceId && !ok ? 1 : 0);
        if (row) {
          await sql`update answers set score_awarded = ${points}, correct = ${ok} where room_id = ${code} and player_id = ${player.id} and round = ${round}`;
        }
      }
      // Fast elimination: everyone active who missed this round is out. Nobody is removed if no one answered correctly.
      if (settings.eliminationMode && survivors.length > 0) {
        const out = data.players.filter((p) => !p.eliminated && !survivors.includes(p.id));
        for (const player of out) {
          await sql`update players set eliminated = true where id = ${player.id}`;
        }
      }
    }
  } else {
    for (const player of data.players) await addScore(sql, player.id, 0, 0, 0);
  }

  const nextState: RoundState = {
    ...state,
    reveal,
    endsAt: state.endsAt ?? null,
    autoAt: auto && engine !== "letter" && engine !== "truth" ? new Date(Date.now() + AUTO_NEXT_MS).toISOString() : null,
  };
  await sql`update rooms set status = 'ROUND_END', round_state = ${JSON.stringify(nextState)}::jsonb, revision = revision + 1, updated_at = now() where id = ${code}`;
}

async function finishGame(sql: Sql, code: string): Promise<void> {
  const data = await bundle(sql, code);
  if (!data) return;
  const ranked = [...data.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let place = 0;
  let last = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ranked.length; index += 1) {
    const player = ranked[index]!;
    if (player.score !== last) {
      place = index + 1;
      last = player.score;
    }
    if (!player.user_id || player.is_bot) continue;
    await sql`insert into play_history (user_id, room_id, game_id, player_name, score, placement) values (${player.user_id}, ${code}, ${data.room.game_id}, ${player.name}, ${player.score}, ${place})`;
  }
  if (data.room.game_id !== MAJLIS_GAME) {
    try {
      const settings = asSettings(data.room.settings);
      const seated = data.players.filter((p) => !p.is_bot).map((p) => ({ id: p.id, name: p.name, score: p.score }));
      const card = JSON.stringify(rankScorecard(seated));
      await sql`insert into bravo_matches (room_id, game_id, mode, categories, rounds, seconds, player_count, scorecard) values (${code}, ${data.room.game_id}, ${settings.bravoMode}, ${settings.categories}, ${settings.rounds}, ${settings.seconds}, ${seated.length}, ${card}::jsonb) on conflict (room_id) do nothing`;
    } catch (error) {
      console.error("bravo match history skipped", error);
    }
  }
  await sql`update rooms set status = 'FINISHED', revision = revision + 1, updated_at = now() where id = ${code}`;
}

async function assertHost(sql: Sql, code: string, hostToken: string) {
  const rooms = await sql<RoomRow>`select * from rooms where id = ${code}`;
  const room = rooms[0];
  if (!room) return null;
  if (!tokensMatch(room.host_token, hostToken)) return null;
  return room;
}

export async function submitNow(input: { code: string; playerToken: string; round: number; payload: Record<string, unknown> }): Promise<Fail | { ok: true; roundClosed: boolean }> {
  const sql = await db();
  const ip = await ipKey();
  if (!allow(`answer:${ip}`, 40, 60 * 1000)) return fail("RATE");
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const data = await bundle(sql, code);
  if (!data) return fail("ROOM_NOT_FOUND");
  if (data.room.status !== "PLAYING") return fail("NOT_PLAYING");
  if (data.room.current_round !== input.round) return fail("ROUND");
  const state = jparse<RoundState>(data.room.round_state, {});
  if (state.endsAt && Date.parse(state.endsAt) <= Date.now()) {
    await closeRound(sql, code, false);
    return fail("NOT_PLAYING");
  }
  const player = data.players.find((p) => tokensMatch(p.token, input.playerToken));
  if (!player || player.is_bot || player.eliminated) return fail("FORBIDDEN");
  const engine = data.game?.engine;
  const payload = sanitizePayload(engine, input.payload, data.players.map((p) => p.id));
  if (!payload) return fail("BAD_INPUT");
  if (engine === "vote" && payload.playerId === player.id) return fail("SELF_VOTE");
  const started = state.startedAt ? Date.parse(state.startedAt) : Date.now();
  const response = Math.max(0, Date.now() - started);
  const inserted = await sql<{ id: number }>`insert into answers (room_id, player_id, round, payload, response_ms) values (${code}, ${player.id}, ${input.round}, ${JSON.stringify(payload)}::jsonb, ${response}) on conflict (room_id, player_id, round) do nothing returning id`;
  if (!inserted.length) return fail("ALREADY");
  await sql`update rooms set revision = revision + 1, updated_at = now() where id = ${code}`;
  const roundClosed = await autoCloseIfComplete(sql, code);
  return { ok: true, roundClosed };
}

export async function cheerNow(input: { code: string; playerToken: string; kind: string }): Promise<Fail | { ok: true }> {
  const sql = await db();
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!isCheerKind(input.kind)) return fail("BAD_INPUT");
  const data = await bundle(sql, code);
  if (!data) return fail("ROOM_NOT_FOUND");
  if (data.room.status === "CLOSED") return fail("ROOM_NOT_FOUND");
  const player = data.players.find((p) => tokensMatch(p.token, input.playerToken));
  if (!player || player.is_bot) return fail("FORBIDDEN");
  if (!allow(`cheer:${player.id}`, 1, 900)) return { ok: true };
  const existing = jparse<StoredCheer[]>(data.room.cheers, []);
  const last = existing.reduce((max, row) => (row.playerId === player.id ? Math.max(max, row.at) : max), 0);
  if (Date.now() - last < 900) return { ok: true };
  await appendCheers(sql, code, [
    { id: hex(8), playerId: player.id, name: player.name, kind: input.kind, at: Date.now() },
  ]);
  return { ok: true };
}

function sanitizePayload(engine: string | undefined, raw: Record<string, unknown>, playerIds: string[]): Record<string, unknown> | null {
  if (engine === "letter") {
    const src = jparse<Record<string, unknown>>(raw.fields ?? raw, {});
    const fields: Record<string, string> = {};
    for (const cat of LETTER_CATS) fields[cat] = String(src[cat] ?? "").trim().slice(0, 40);
    return { fields };
  }
  if (engine === "text" || engine === "feud") {
    const text = String(raw.text ?? "").trim().slice(0, 80);
    if (!text) return null;
    return { text };
  }
  if (engine === "vote") {
    const playerId = String(raw.playerId ?? "");
    if (!playerIds.includes(playerId)) return null;
    return { playerId };
  }
  if (engine === "truth") {
    const side = raw.side === "dare" ? "dare" : raw.side === "truth" ? "truth" : "";
    if (!side) return null;
    return { side };
  }
  const choiceId = String(raw.choiceId ?? "").slice(0, 8);
  if (!choiceId) return null;
  return { choiceId };
}

const BOTS = ["ليلى", "فهد", "نورة", "سامي", "جود", "تالا"];

export async function hostNow(input: { code: string; hostToken: string; action: string; extra?: Record<string, unknown> }, ctx: Ctx): Promise<Fail | { ok: true } | Snapshot> {
  const sql = await db();
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const room = await assertHost(sql, code, input.hostToken);
  if (!room) return fail("NOT_HOST");
  const action = input.action;
  if (action === "start") {
    if (room.status !== "WAITING" && room.status !== "FINISHED") return fail("BAD_INPUT");
    const players = await sql<{ id: string }>`select id from players where room_id = ${code}`;
    const game = await sql<{ tier: string; min_players: number }>`select tier, min_players from games where id = ${room.game_id}`;
    const need = Math.max(2, num(game[0]?.min_players, 2));
    if (players.length < need) return fail("NEED_PLAYERS");
    if (room.status === "FINISHED") {
      await sql`delete from answers where room_id = ${code}`;
      await sql`update players set score = 0, round_score = 0, correct_count = 0, wrong_count = 0 where room_id = ${code}`;
      await sql`update rooms set status = 'WAITING', current_round = 0, round_state = '{}'::jsonb where id = ${code}`;
    }
    return openRound(sql, code, 1);
  }
  if (action === "endRound") {
    await closeRound(sql, code, true);
    return { ok: true };
  }
  if (action === "next") {
    if (room.status !== "ROUND_END") return fail("BAD_INPUT");
    const settings = asSettings(room.settings);
    const seated = await sql<PlayerRow>`select * from players where room_id = ${code}`;
    if (room.current_round >= settings.rounds || reachedTarget(seated, settings) || eliminationOver(seated, settings)) {
      await finishGame(sql, code);
      return { ok: true };
    }
    return openRound(sql, code, room.current_round + 1);
  }
  if (action === "finish") {
    await finishGame(sql, code);
    return { ok: true };
  }
  if (action === "close") {
    await sql`update rooms set status = 'CLOSED', revision = revision + 1, updated_at = now() where id = ${code}`;
    return { ok: true };
  }
  if (action === "restart") {
    await sql`delete from answers where room_id = ${code}`;
    await sql`update players set score = 0, round_score = 0, correct_count = 0, wrong_count = 0 where room_id = ${code}`;
    await sql`update rooms set status = 'WAITING', current_round = 0, round_state = '{}'::jsonb, revision = revision + 1, updated_at = now() where id = ${code}`;
    return { ok: true };
  }
  if (action === "bots") {
    if (room.status !== "WAITING") return fail("BAD_INPUT");
    const settings = asSettings(room.settings);
    const players = await sql<{ name: string }>`select name from players where room_id = ${code}`;
    const have = new Set(players.map((p) => p.name));
    let added = 0;
    for (const name of BOTS) {
      if (players.length + added >= settings.maxPlayers) break;
      if (have.has(name)) continue;
      await sql`insert into players (id, room_id, token, name, is_bot) values (${rid(8)}, ${code}, ${hex(8)}, ${name}, true)`;
      added += 1;
      if (added >= 4) break;
    }
    await sql`update rooms set revision = revision + 1, updated_at = now() where id = ${code}`;
    return { ok: true };
  }
  if (action === "kick") {
    const playerId = String(input.extra?.playerId ?? "");
    if (!playerId) return fail("BAD_INPUT");
    if (room.status !== "WAITING" && room.status !== "PLAYING" && room.status !== "ROUND_END") return fail("BAD_INPUT");
    await sql`delete from players where id = ${playerId} and room_id = ${code}`;
    await sql`update rooms set revision = revision + 1, updated_at = now() where id = ${code}`;
    return { ok: true };
  }
  if (action === "switchGame") {
    if (room.status !== "WAITING" && room.status !== "FINISHED" && room.status !== "ROUND_END") return fail("BAD_INPUT");
    const gameId = String(input.extra?.gameId ?? "");
    const games = await sql<GameRow>`select * from games where id = ${gameId} and visible = true and status = 'published'`;
    const next = games[0];
    if (!next) return fail("GAME");
    const settings = asSettings(room.settings, { rounds: next.default_rounds, seconds: next.default_seconds });
    settings.rounds = next.default_rounds;
    settings.seconds = next.default_seconds;
    await sql`delete from answers where room_id = ${code}`;
    await sql`update players set score = 0, round_score = 0, correct_count = 0, wrong_count = 0 where room_id = ${code}`;
    await sql`update rooms set game_id = ${next.id}, status = 'WAITING', current_round = 0, round_state = '{}'::jsonb, settings = ${JSON.stringify(settings)}::jsonb, revision = revision + 1, updated_at = now() where id = ${code}`;
    if (input.extra?.start === true) {
      const players = await sql<{ id: string }>`select id from players where room_id = ${code}`;
      if (players.length < next.min_players) return fail("NEED_PLAYERS");
      return openRound(sql, code, 1);
    }
    return { ok: true };
  }
  if (action === "accept") {
    if (room.status !== "ROUND_END") return fail("BAD_INPUT");
    const playerId = String(input.extra?.playerId ?? "");
    const category = String(input.extra?.category ?? "") as LetterCat;
    if (!LETTER_CATS.includes(category)) return fail("BAD_INPUT");
    const state = jparse<RoundState>(room.round_state, {});
    const settings = asSettings(room.settings);
    const rows = await sql<AnswerRow>`select player_id, round, payload, response_ms, score_awarded from answers where room_id = ${code} and round = ${room.current_round}`;
    const target = rows.find((row) => row.player_id === playerId);
    const fields = jparse<Record<string, { text?: string }>>(payloadObj(target?.payload).fields, {});
    const word = String(fields[category]?.text ?? "").trim();
    if (!word || !state.letter) return fail("BAD_INPUT");
    await sql`insert into lexicon (locale, letter, category, word, source) values (${settings.locale}, ${state.letter}, ${category}, ${word}, 'host') on conflict (locale, letter, category, word) do nothing`;
    const players = await sql<PlayerRow>`select * from players where room_id = ${code}`;
    const bank = await mergedBank(sql, settings.locale);
    const game = await sql<{ scoring: unknown }>`select scoring from games where id = ${room.game_id}`;
    const scoring = jparse<Record<string, number>>(game[0]?.scoring, {});
    const rules: LetterRules = {
      unique: num(scoring.unique, 10),
      duplicate: num(scoring.duplicate, 5),
      wrong: num(scoring.wrong, 0),
      empty: num(scoring.empty, 0),
    };
    const submissions = players.map((player) => {
      const row = rows.find((item) => item.player_id === player.id);
      const current = jparse<Record<string, { text?: string }>>(payloadObj(row?.payload).fields, {});
      return {
        playerId: player.id,
        fields: {
          boy: String(current.boy?.text ?? ""),
          girl: String(current.girl?.text ?? ""),
          animal: String(current.animal?.text ?? ""),
          object: String(current.object?.text ?? ""),
          country: String(current.country?.text ?? ""),
        },
      };
    });
    const scored = scoreLetterRound({ submissions, letter: state.letter, locale: settings.locale, bank, rules });
    for (const row of scored) {
      const prev = rows.find((item) => item.player_id === row.playerId);
      const before = num(prev?.score_awarded);
      const delta = row.total - before;
      await sql`update answers set payload = ${JSON.stringify({ fields: row.fields })}::jsonb, score_awarded = ${row.total}, correct = ${row.correct > 0} where room_id = ${code} and player_id = ${row.playerId} and round = ${room.current_round}`;
      await sql`update players set score = score + ${delta}, round_score = ${row.total} where id = ${row.playerId}`;
    }
    const reveal: Reveal = {
      letterRows: scored.map((row) => ({
        playerId: row.playerId,
        name: players.find((p) => p.id === row.playerId)?.name ?? "",
        fields: row.fields,
        total: row.total,
      })),
    };
    await sql`update rooms set round_state = ${JSON.stringify({ ...state, reveal })}::jsonb, revision = revision + 1, updated_at = now() where id = ${code}`;
    return { ok: true };
  }
  if (action === "bonus") {
    if (room.status !== "ROUND_END") return fail("BAD_INPUT");
    const playerId = String(input.extra?.playerId ?? "");
    const game = await sql<{ scoring: unknown }>`select scoring from games where id = ${room.game_id}`;
    const scoring = jparse<Record<string, number>>(game[0]?.scoring, {});
    const pts = num(scoring.bonus, 10);
    await sql`update players set score = score + ${pts}, round_score = round_score + ${pts} where id = ${playerId} and room_id = ${code}`;
    await sql`update rooms set revision = revision + 1 where id = ${code}`;
    return { ok: true };
  }
  return fail("BAD_INPUT");
}

async function applyPromo(
  sql: Sql,
  rawCode: string,
  userId: string | null,
  roomCode: string | null,
): Promise<Fail | { ok: true; unlocked: boolean; discount: number; kind: string }> {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rows = await sql<{ code: string; kind: string; amount: number; max_uses: number | null; uses: number; active: boolean; expires_at: unknown }>`select code, kind, amount, max_uses, uses, active, expires_at from promo_codes where code = ${code}`;
  const promo = rows[0];
  if (!promo || !promo.active) return fail("BAD_PROMO");
  if (promo.expires_at && stamp(promo.expires_at) < Date.now()) return fail("BAD_PROMO");
  if (promo.max_uses != null && promo.uses >= promo.max_uses) return fail("PROMO_USED");
  await sql`update promo_codes set uses = uses + 1 where code = ${code}`;
  let unlocked = promo.kind === "days" || promo.kind === "lifetime";
  if (unlocked && userId) {
    const ends = promo.kind === "lifetime" ? null : new Date(Date.now() + num(promo.amount, 30) * 864e5).toISOString();
    const planId = promo.kind === "lifetime" ? "lifetime" : "monthly";
    await sql`insert into subscriptions (id, user_id, plan_id, status, source, ends_at) values (${hex(8)}, ${userId}, ${planId}, 'active', 'promo', ${ends})`;
  }
  if (unlocked && roomCode) {
    await sql`update rooms set unlocked = true, revision = revision + 1 where id = ${roomCode}`;
  }
  return { ok: true, unlocked, discount: promo.kind === "percent" ? num(promo.amount) : 0, kind: promo.kind };
}

export async function redeemNow(input: { promo: string; roomCode?: string; hostToken?: string }, ctx: Ctx): Promise<Fail | { ok: true; unlocked: boolean; discount: number; kind: string }> {
  const sql = await db();
  let roomCode: string | null = null;
  if (input.roomCode && input.hostToken) {
    const code = input.roomCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const room = await assertHost(sql, code, input.hostToken);
    if (!room) return fail("NOT_HOST");
    roomCode = code;
  }
  if (!ctx.userId && !roomCode) return fail("ASK_SIGNIN");
  return applyPromo(sql, input.promo, ctx.userId, roomCode);
}

export async function profileNow(ctx: Ctx): Promise<Fail | { ok: true; profile: { name: string; email: string | null; image: string | null; role: string; premium: boolean }; history: { gameId: string; score: number; placement: number | null; playedAt: string }[]; favorites: string[] }> {
  if (!ctx.userId) return fail("ASK_SIGNIN");
  const sql = await db();
  const users = await sql<{ name: string; email: string | null; image: string | null }>`select "name", "email", "image" from users where "id" = ${ctx.userId}`;
  const user = users[0];
  if (!user) return fail("ASK_SIGNIN");
  await sql`insert into profiles (user_id, display_name, avatar_url) values (${ctx.userId}, ${user.name}, ${user.image}) on conflict (user_id) do nothing`;
  const profiles = await sql<{ role: string; display_name: string | null }>`select role, display_name from profiles where user_id = ${ctx.userId}`;
  const history = await sql<{ game_id: string; score: number; placement: number | null; played_at: unknown }>`select game_id, score, placement, played_at from play_history where user_id = ${ctx.userId} order by played_at desc limit 30`;
  const favorites = await sql<{ game_id: string }>`select game_id from favorites where user_id = ${ctx.userId}`;
  return {
    ok: true,
    profile: {
      name: profiles[0]?.display_name || user.name,
      email: user.email,
      image: user.image,
      role: profiles[0]?.role ?? "player",
      premium: await premium(sql, ctx.userId),
    },
    history: history.map((row) => ({
      gameId: row.game_id,
      score: row.score,
      placement: row.placement,
      playedAt: iso(row.played_at) ?? "",
    })),
    favorites: favorites.map((row) => row.game_id),
  };
}

export async function updateProfileNow(input: { name: string }, ctx: Ctx): Promise<Fail | { ok: true }> {
  if (!ctx.userId) return fail("ASK_SIGNIN");
  const name = cleanName(input.name);
  if (!name) return fail("NAME_INVALID");
  const sql = await db();
  await sql`insert into profiles (user_id, display_name) values (${ctx.userId}, ${name}) on conflict (user_id) do update set display_name = ${name}`;
  return { ok: true };
}

export async function favoriteNow(input: { gameId: string }, ctx: Ctx): Promise<Fail | { ok: true; on: boolean }> {
  if (!ctx.userId) return fail("ASK_SIGNIN");
  const sql = await db();
  const have = await sql<{ game_id: string }>`select game_id from favorites where user_id = ${ctx.userId} and game_id = ${input.gameId}`;
  if (have.length) {
    await sql`delete from favorites where user_id = ${ctx.userId} and game_id = ${input.gameId}`;
    return { ok: true, on: false };
  }
  await sql`insert into favorites (user_id, game_id) values (${ctx.userId}, ${input.gameId})`;
  return { ok: true, on: true };
}

export async function claimAdminNow(input: { studio: string }, ctx: Ctx): Promise<Fail | { ok: true }> {
  if (!ctx.userId) return fail("ASK_SIGNIN");
  const sql = await db();
  const admins = await sql<{ user_id: string }>`select user_id from profiles where role = 'admin' limit 1`;
  if (admins.length) return fail("FORBIDDEN");
  const studio = await setting(sql, "studio", { code: "", open: false });
  const given = input.studio.trim().toUpperCase();
  if (!studio.open || !studio.code || given !== studio.code.toUpperCase()) return fail("FORBIDDEN");
  const users = await sql<{ name: string }>`select "name" from users where "id" = ${ctx.userId}`;
  await sql`insert into profiles (user_id, display_name, role) values (${ctx.userId}, ${users[0]?.name ?? ""}, 'admin') on conflict (user_id) do update set role = 'admin'`;
  await sql`update settings set value = ${JSON.stringify({ code: "", open: false })}::jsonb where key = 'studio'`;
  return { ok: true };
}

export async function isAdmin(sql: Sql, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const rows = await sql<{ role: string }>`select role from profiles where user_id = ${userId}`;
  return rows[0]?.role === "admin";
}

export async function soloQuestionNow(gameId: string) {
  const sql = await db();
  const rows = await sql<QRow>`select id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, image_url from questions where game_id = ${gameId} and status = 'published' and room_id is null order by random() limit 1`;
  const q = rows[0];
  if (!q) return fail("NO_QUESTIONS");
  const choices = jparse<{ id: string; ar: string; en: string }[]>(q.choices, []);
  return { ok: true as const, id: q.id, promptAr: q.prompt_ar, promptEn: q.prompt_en, choices, points: q.points };
}

export async function soloAnswerNow(input: { questionId: number; choiceId: string }) {
  const sql = await db();
  const rows = await sql<QRow>`select id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, image_url from questions where id = ${input.questionId}`;
  const q = rows[0];
  if (!q) return fail("NO_QUESTIONS");
  const correct = input.choiceId === q.correct;
  return { ok: true as const, correct, answer: q.correct, points: correct ? q.points : 0 };
}
