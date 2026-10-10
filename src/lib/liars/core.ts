/**
 * «الكذابون» (Liars) server logic. Every function takes the database handle, so the
 * same code runs in production and in integration tests against a real Postgres.
 *
 * Concurrency rules (there are no multi-statement transactions on this Sql handle):
 * - Every state change is one guarded UPDATE (`where state = ...`). When two requests
 *   race, exactly one wins and the other gets WRONG_STATE.
 * - An answer insert locks the room row (`for share`), so it either lands before the
 *   question closes or is refused after it.
 * - Scoring is applied by `settle`, which flips `room_answers.applied` and adds the
 *   points in one statement. It is idempotent, so it can safely run more than once.
 */
import type { Sql } from "../db.ts";
import { cleanName, hex, jparse, num, rid, stamp, tokensMatch } from "../lamma/util.ts";
import {
  acceptsAnswer,
  boardComplete,
  cellKey,
  CONNECTED_WINDOW_MS,
  nextPicker,
  parseCategorySelection,
  parseCellKey,
  parseSettings,
  pickHidden,
  pointsForLevel,
  rankPlayers,
  scoreAnswer,
  shouldClose,
} from "./rules.ts";
import {
  LEVEL_COUNT,
  LIARS_SLUG,
  MIN_CATEGORIES,
  type CategoryCard,
  type LiarsError,
  type LiarsFail,
  type LiarsSnapshot,
  type LiarsState,
  type LiarsUnchanged,
  type RevealRow,
  type SnapPlayer,
} from "./types.ts";

type Ok<T = object> = { ok: true } & T;

type RoomRow = {
  id: string;
  code: string;
  host_token: string;
  state: LiarsState;
  settings: unknown;
  categories: string[] | null;
  used_cells: string[] | null;
  used_question_ids: unknown[] | null;
  picker_id: string | null;
  cell_key: string | null;
  cell_points: number | null;
  question_id: unknown;
  question_started_at: unknown;
  ends_at: unknown;
  revision: number;
  expires_at: unknown;
  db_now: unknown;
};

type PlayerRow = {
  id: string;
  name: string;
  seat: number;
  score: number;
  correct_count: number;
  wrong_count: number;
  is_host: boolean;
  connected: boolean;
  answered: boolean;
  helper_used: boolean;
  helper_cell: string | null;
  helper_hidden: number[] | null;
};

const CONNECTED_SECONDS = Math.round(CONNECTED_WINDOW_MS / 1000);
const ROOM_CODE_LENGTH = 5;

function fail(error: LiarsError): LiarsFail {
  return { ok: false, error };
}

/** Postgres error code and constraint, from pg, PGlite or the test adapter. */
function pgError(error: unknown): { code: string; constraint: string; message: string } {
  const e = (error ?? {}) as { code?: unknown; constraint?: unknown; message?: unknown };
  return {
    code: typeof e.code === "string" ? e.code : "",
    constraint: typeof e.constraint === "string" ? e.constraint : "",
    message: typeof e.message === "string" ? e.message : "",
  };
}

/** Missing tables or columns mean the Liars schema has not been applied yet. */
export function isSchemaMissing(error: unknown): boolean {
  const { code } = pgError(error);
  return code === "42P01" || code === "42703";
}

function uniqueViolation(error: unknown, constraint: string): boolean {
  const e = pgError(error);
  return e.code === "23505" && (e.constraint === constraint || e.message.includes(constraint));
}

function list<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

async function loadRoom(sql: Sql, code: string): Promise<RoomRow | null> {
  const rows = await sql<RoomRow>`
    select id, code, host_token, state, settings, categories, used_cells, used_question_ids, picker_id,
           cell_key, cell_points, question_id, question_started_at, ends_at, revision, expires_at, now() as db_now
    from game_rooms where code = ${code}`;
  return rows[0] ?? null;
}

/** Room by code, refusing unknown and expired rooms. */
async function openRoom(sql: Sql, code: string): Promise<RoomRow | LiarsFail> {
  const room = await loadRoom(sql, code);
  if (!room) return fail("NOT_FOUND");
  if (stamp(room.expires_at) <= stamp(room.db_now)) return fail("EXPIRED");
  return room;
}

function isFail(value: unknown): value is LiarsFail {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === false);
}

async function playerByToken(sql: Sql, roomId: string, token: string | undefined): Promise<{ id: string } | null> {
  if (!token) return null;
  const rows = await sql<{ id: string }>`select id from room_players where room_id = ${roomId}::uuid and token = ${token}`;
  return rows[0] ?? null;
}

async function bump(sql: Sql, roomId: string): Promise<void> {
  await sql`update game_rooms set revision = revision + 1, updated_at = now() where id = ${roomId}::uuid`;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryWithStatus = CategoryCard & { ready: boolean };

/** Active categories, flagged ready when every one of the 9 levels has a published question. */
export async function listCategories(sql: Sql): Promise<CategoryWithStatus[]> {
  const rows = await sql<{ id: string; name_ar: string; name_en: string; icon: string; levels: number }>`
    select c.id, c.name_ar, c.name_en, c.icon, count(distinct q.level)::int as levels
    from categories c
    left join questions_grid q on q.category_id = c.id and q.status = 'published'
    where c.active = true
    group by c.id, c.name_ar, c.name_en, c.icon, c.sort_order
    order by c.sort_order, c.id`;
  return rows.map((row) => ({
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    icon: row.icon,
    ready: num(row.levels) >= LEVEL_COUNT,
  }));
}

// ---------------------------------------------------------------------------
// Create and join
// ---------------------------------------------------------------------------

export async function createRoom(
  sql: Sql,
  input: { categories: unknown; settings: unknown; hostName?: string; userId?: string | null },
): Promise<Ok<{ code: string; hostToken: string; playerToken: string | null; playerId: string | null }> | LiarsFail> {
  const ready = new Set((await listCategories(sql)).filter((c) => c.ready).map((c) => c.id));
  const categories = parseCategorySelection(input.categories, ready);
  if (categories.length < MIN_CATEGORIES) return fail("BAD_INPUT");
  const settings = parseSettings(input.settings);

  let hostName: string | null = null;
  if (input.hostName && input.hostName.trim()) {
    hostName = cleanName(input.hostName);
    if (!hostName) return fail("BAD_NAME");
  }

  const games = await sql<{ id: string }>`select id from games where id = ${LIARS_SLUG}`;
  if (!games.length) return fail("NOT_READY");

  const hostToken = hex(16);
  let room: { id: string; code: string } | undefined;
  for (let attempt = 0; attempt < 6 && !room; attempt += 1) {
    const rows = await sql<{ id: string; code: string }>`
      insert into game_rooms (code, game_id, host_token, host_user_id, settings, categories)
      values (${rid(ROOM_CODE_LENGTH)}, ${LIARS_SLUG}, ${hostToken}, ${input.userId ?? null},
              ${JSON.stringify(settings)}::jsonb, ${categories}::text[])
      on conflict (code) do nothing
      returning id, code`;
    room = rows[0];
  }
  if (!room) return fail("RATE_LIMIT");

  let playerToken: string | null = null;
  let playerId: string | null = null;
  if (hostName) {
    playerToken = hex(16);
    const rows = await sql<{ id: string }>`
      insert into room_players (room_id, token, name, user_id, is_host, seat)
      values (${room.id}::uuid, ${playerToken}, ${hostName}, ${input.userId ?? null}, true, 1)
      returning id`;
    playerId = rows[0]?.id ?? null;
  }
  return { ok: true, code: room.code, hostToken, playerToken, playerId };
}

export async function joinRoom(
  sql: Sql,
  input: { code: string; name: string; userId?: string | null },
): Promise<Ok<{ code: string; playerToken: string; playerId: string }> | LiarsFail> {
  const name = cleanName(input.name);
  if (!name) return fail("BAD_NAME");
  const room = await openRoom(sql, input.code);
  if (isFail(room)) return room;
  if (room.state === "finished") return fail("WRONG_STATE");
  const settings = parseSettings(room.settings);
  const token = hex(16);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      // The seat is the next free one; the HAVING clause refuses a full room in the same statement.
      const rows = await sql<{ id: string }>`
        insert into room_players (room_id, token, name, user_id, seat)
        select ${room.id}::uuid, ${token}, ${name}, ${input.userId ?? null}, coalesce(max(seat), 0) + 1
        from room_players where room_id = ${room.id}::uuid
        having count(*) < ${settings.maxPlayers}
        returning id`;
      if (!rows[0]) return fail("ROOM_FULL");
      await bump(sql, room.id);
      return { ok: true, code: room.code, playerToken: token, playerId: rows[0].id };
    } catch (error) {
      if (uniqueViolation(error, "room_players_room_name_idx")) return fail("NAME_TAKEN");
      // Two joins took the same seat at once: try again with the next seat.
      if (uniqueViolation(error, "room_players_room_seat_idx")) continue;
      throw error;
    }
  }
  return fail("RATE_LIMIT");
}

// ---------------------------------------------------------------------------
// Question lifecycle
// ---------------------------------------------------------------------------

/**
 * Apply every unapplied answer of a cell to the players' totals, in one statement.
 * Idempotent: an answer is applied once, however many times this runs.
 */
export async function settle(sql: Sql, roomId: string, key: string): Promise<boolean> {
  const rows = await sql<{ revision: number }>`
    with applied as (
      update room_answers set applied = true
      where room_id = ${roomId}::uuid and cell_key = ${key} and applied = false
      returning player_id, awarded, is_correct
    ), scored as (
      update room_players p
      set score = p.score + a.awarded,
          correct_count = p.correct_count + case when a.is_correct then 1 else 0 end,
          wrong_count = p.wrong_count + case when a.is_correct then 0 else 1 end
      from applied a
      where p.id = a.player_id
      returning p.id
    )
    update game_rooms set revision = revision + 1, updated_at = now()
    where id = ${roomId}::uuid and exists (select 1 from scored)
    returning revision`;
  return rows.length > 0;
}

/** Close the open question (only the first caller wins), then apply its scores. */
export async function closeQuestion(sql: Sql, roomId: string, key: string): Promise<boolean> {
  const moved = await sql<{ id: string }>`
    update game_rooms
    set state = 'reveal', ends_at = least(coalesce(ends_at, now()), now()), revision = revision + 1, updated_at = now()
    where id = ${roomId}::uuid and state = 'question' and cell_key = ${key}
    returning id`;
  await settle(sql, roomId, key);
  return moved.length > 0;
}

async function answerCounts(sql: Sql, roomId: string, key: string): Promise<{ answered: number; connected: number }> {
  const rows = await sql<{ answered: number; connected: number }>`
    select
      (select count(*) from room_answers where room_id = ${roomId}::uuid and cell_key = ${key})::int as answered,
      (select count(*) from room_players
        where room_id = ${roomId}::uuid and last_seen > now() - make_interval(secs => ${CONNECTED_SECONDS}))::int as connected`;
  return { answered: num(rows[0]?.answered), connected: num(rows[0]?.connected) };
}

/** Close the question when its deadline has passed or every connected player has answered. */
async function closeIfDue(sql: Sql, room: RoomRow, checkCounts: boolean): Promise<boolean> {
  if (room.state !== "question" || !room.cell_key) return false;
  const now = stamp(room.db_now);
  const endsAt = room.ends_at ? stamp(room.ends_at) : null;
  let counts = { answered: 0, connected: 0 };
  if (checkCounts) counts = await answerCounts(sql, room.id, room.cell_key);
  if (!shouldClose({ now, endsAt, ...counts })) return false;
  return closeQuestion(sql, room.id, room.cell_key);
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function snapshot(
  sql: Sql,
  input: { code: string; hostToken?: string; playerToken?: string; since?: number },
): Promise<LiarsSnapshot | LiarsUnchanged | LiarsFail> {
  let room = await openRoom(sql, input.code);
  if (isFail(room)) return room;

  // Lazy transitions: a poll is what moves an expired question to the reveal.
  const untimed = !room.ends_at;
  if (await closeIfDue(sql, room, untimed)) {
    const fresh = await openRoom(sql, input.code);
    if (isFail(fresh)) return fresh;
    room = fresh;
  }

  // Presence: refresh last_seen at most every 8 seconds per player, in the same round trip as the lookup.
  let me: { id: string } | null = null;
  if (input.playerToken) {
    const rows = await sql<{ id: string }>`
      with me as (
        select id, last_seen from room_players where room_id = ${room.id}::uuid and token = ${input.playerToken}
      ), touch as (
        update room_players p set last_seen = now() from me
        where p.id = me.id and me.last_seen < now() - interval '8 seconds'
      )
      select id from me`;
    me = rows[0] ?? null;
  }

  const fullFetch = input.since === undefined || input.since !== room.revision;
  if (room.state === "reveal" && room.cell_key && fullFetch && (await settle(sql, room.id, room.cell_key))) {
    const fresh = await openRoom(sql, input.code);
    if (isFail(fresh)) return fresh;
    room = fresh;
  }
  if (input.since !== undefined && input.since === room.revision) {
    return { ok: true, unchanged: true, revision: room.revision, serverNow: stamp(room.db_now) };
  }

  const isHost = Boolean(input.hostToken && tokensMatch(room.host_token, input.hostToken));
  const key = room.cell_key ?? "";
  const players = await sql<PlayerRow>`
    select p.id, p.name, p.seat, p.score, p.correct_count, p.wrong_count, p.is_host,
           (p.last_seen > now() - make_interval(secs => ${CONNECTED_SECONDS})) as connected,
           exists (select 1 from room_answers a where a.room_id = p.room_id and a.cell_key = ${key} and a.player_id = p.id) as answered,
           p.helper_used, p.helper_cell, p.helper_hidden
    from room_players p
    where p.room_id = ${room.id}::uuid
    order by p.seat`;

  const selected = list(room.categories);
  const cats = selected.length
    ? await sql<{ id: string; name_ar: string; name_en: string; icon: string }>`
        select id, name_ar, name_en, icon from categories where id = any(${selected}::text[])`
    : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const categories: CategoryCard[] = selected.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ id: c.id, nameAr: c.name_ar, nameEn: c.name_en, icon: c.icon }] : [];
  });

  const open = (room.state === "question" || room.state === "reveal") && room.question_id != null;
  let question: { text: string; options: string[]; correct: number } | null = null;
  if (open) {
    const rows = await sql<{ question: string; options: unknown; correct_index: number }>`
      select question, options, correct_index from questions_grid where id = ${num(room.question_id)}`;
    const q = rows[0];
    if (q) question = { text: q.question, options: jparse<string[]>(q.options, []), correct: num(q.correct_index) };
  }

  let reveal: LiarsSnapshot["room"]["reveal"] = null;
  if (room.state === "reveal" && question) {
    const rows = await sql<{ player_id: string; name: string; choice: number; is_correct: boolean; awarded: number }>`
      select a.player_id, p.name, a.choice, a.is_correct, a.awarded
      from room_answers a join room_players p on p.id = a.player_id
      where a.room_id = ${room.id}::uuid and a.cell_key = ${key}
      order by a.awarded desc, p.seat`;
    const revealRows: RevealRow[] = rows.map((r) => ({
      playerId: r.player_id,
      name: r.name,
      choice: num(r.choice),
      correct: Boolean(r.is_correct),
      awarded: num(r.awarded),
    }));
    reveal = { correctIndex: question.correct, rows: revealRows };
  }

  let myChoice: number | null = null;
  if (me && open && key) {
    const rows = await sql<{ choice: number }>`
      select choice from room_answers where room_id = ${room.id}::uuid and cell_key = ${key} and player_id = ${me.id}::uuid`;
    myChoice = rows[0] ? num(rows[0].choice) : null;
  }

  const settings = parseSettings(room.settings);
  const mine = me ? players.find((p) => p.id === me!.id) : undefined;
  const parsed = room.cell_key ? parseCellKey(room.cell_key) : null;
  const snapPlayers: SnapPlayer[] = rankPlayers(
    players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: num(p.seat),
      score: num(p.score),
      correct: num(p.correct_count),
      wrong: num(p.wrong_count),
      isHost: Boolean(p.is_host),
      connected: Boolean(p.connected),
      answered: Boolean(p.answered),
    })),
  );

  return {
    ok: true,
    revision: room.revision,
    serverNow: stamp(room.db_now),
    room: {
      code: room.code,
      state: room.state,
      settings,
      categories,
      usedCells: list(room.used_cells),
      pickerId: room.picker_id,
      cell:
        open && parsed && room.cell_key
          ? {
              key: room.cell_key,
              categoryId: parsed.categoryId,
              level: parsed.level,
              points: num(room.cell_points, pointsForLevel(parsed.level) ?? 0),
              startedAt: stamp(room.question_started_at),
              endsAt: room.ends_at ? stamp(room.ends_at) : null,
            }
          : null,
      question: question ? { text: question.text, options: question.options } : null,
      reveal,
      answeredCount: snapPlayers.filter((p) => p.answered).length,
      connectedCount: snapPlayers.filter((p) => p.connected).length,
    },
    players: snapPlayers,
    you: {
      role: isHost ? "host" : me ? "player" : "viewer",
      playerId: me?.id ?? null,
      isHost,
      canPick: room.state === "board" && (isHost || (Boolean(me) && me!.id === room.picker_id)),
      choice: myChoice,
      helperAvailable: Boolean(
        settings.fiftyFifty && mine && !mine.helper_used && room.state === "question" && myChoice === null,
      ),
      hidden: mine && mine.helper_cell && mine.helper_cell === room.cell_key ? list(mine.helper_hidden).map((n) => num(n)) : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Host and player actions
// ---------------------------------------------------------------------------

type Auth = { code: string; hostToken?: string; playerToken?: string };

async function authorise(sql: Sql, input: Auth): Promise<{ room: RoomRow; isHost: boolean; playerId: string | null } | LiarsFail> {
  const room = await openRoom(sql, input.code);
  if (isFail(room)) return room;
  const isHost = Boolean(input.hostToken && tokensMatch(room.host_token, input.hostToken));
  const player = await playerByToken(sql, room.id, input.playerToken);
  return { room, isHost, playerId: player?.id ?? null };
}

export async function startGame(sql: Sql, input: Auth): Promise<Ok | LiarsFail> {
  const auth = await authorise(sql, input);
  if (isFail(auth)) return auth;
  if (!auth.isHost) return fail("FORBIDDEN");
  if (auth.room.state !== "lobby") return fail("WRONG_STATE");
  const players = await sql<{ id: string; seat: number }>`select id, seat from room_players where room_id = ${auth.room.id}::uuid`;
  const picker = nextPicker(players.map((p) => ({ id: p.id, seat: num(p.seat) })), null);
  if (!picker) return fail("NO_PLAYERS");
  const rows = await sql<{ id: string }>`
    update game_rooms set state = 'board', picker_id = ${picker}::uuid, revision = revision + 1, updated_at = now()
    where id = ${auth.room.id}::uuid and state = 'lobby'
    returning id`;
  return rows.length ? { ok: true } : fail("WRONG_STATE");
}

export async function pickCell(sql: Sql, input: Auth & { categoryId: string; level: number }): Promise<Ok | LiarsFail> {
  const auth = await authorise(sql, input);
  if (isFail(auth)) return auth;
  const { room } = auth;
  if (room.state !== "board") return fail("WRONG_STATE");
  if (!auth.isHost && (!auth.playerId || auth.playerId !== room.picker_id)) return fail("FORBIDDEN");
  const points = pointsForLevel(input.level);
  if (points === null || !list(room.categories).includes(input.categoryId)) return fail("BAD_INPUT");
  const key = cellKey(input.categoryId, input.level);
  if (list(room.used_cells).includes(key)) return fail("CELL_USED");

  const used = list(room.used_question_ids).map((n) => num(n));
  let questions = await sql<{ id: number }>`
    select id from questions_grid
    where category_id = ${input.categoryId} and level = ${input.level} and status = 'published'
      and not (id = any(${used}::bigint[]))
    order by random() limit 1`;
  if (!questions.length) {
    questions = await sql<{ id: number }>`
      select id from questions_grid
      where category_id = ${input.categoryId} and level = ${input.level} and status = 'published'
      order by random() limit 1`;
  }
  const questionId = questions[0] ? num(questions[0].id) : null;
  if (questionId === null) return fail("NO_QUESTION");

  const timer = parseSettings(room.settings).timerSeconds;
  const rows = await sql<{ id: string }>`
    update game_rooms
    set state = 'question', cell_key = ${key}, cell_points = ${points}, question_id = ${questionId},
        question_started_at = now(),
        ends_at = case when ${timer}::int > 0 then now() + make_interval(secs => ${timer}::int) else null end,
        used_cells = array_append(used_cells, ${key}::text),
        used_question_ids = array_append(used_question_ids, ${questionId}::bigint),
        revision = revision + 1, updated_at = now()
    where id = ${room.id}::uuid and state = 'board' and not (${key}::text = any(used_cells))
    returning id`;
  return rows.length ? { ok: true } : fail("WRONG_STATE");
}

type AnswerContext = {
  room_id: string;
  state: LiarsState;
  cell_key: string | null;
  cell_points: number | null;
  settings: unknown;
  ends_at: unknown;
  expires_at: unknown;
  db_now: unknown;
  elapsed_ms: number | null;
  player_id: string;
  correct_index: number | null;
  option_count: number | null;
};

async function answerContext(sql: Sql, code: string, playerToken: string): Promise<AnswerContext | LiarsFail> {
  const rows = await sql<AnswerContext>`
    select r.id as room_id, r.state, r.cell_key, r.cell_points, r.settings, r.ends_at, r.expires_at, now() as db_now,
           floor(extract(epoch from (now() - r.question_started_at)) * 1000)::int as elapsed_ms,
           p.id as player_id, q.correct_index, jsonb_array_length(q.options) as option_count
    from game_rooms r
    join room_players p on p.room_id = r.id and p.token = ${playerToken}
    left join questions_grid q on q.id = r.question_id
    where r.code = ${code}`;
  const ctx = rows[0];
  if (!ctx) {
    const room = await loadRoom(sql, code);
    return fail(room ? "FORBIDDEN" : "NOT_FOUND");
  }
  if (stamp(ctx.expires_at) <= stamp(ctx.db_now)) return fail("EXPIRED");
  return ctx;
}

export async function submitAnswer(
  sql: Sql,
  input: { code: string; playerToken: string; choice: number },
): Promise<Ok<{ closed: boolean }> | LiarsFail> {
  const ctx = await answerContext(sql, input.code, input.playerToken);
  if (isFail(ctx)) return ctx;
  if (ctx.state !== "question" || !ctx.cell_key || ctx.correct_index === null) return fail("WRONG_STATE");
  const optionCount = num(ctx.option_count);
  if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice >= optionCount) return fail("BAD_INPUT");
  const endsAt = ctx.ends_at ? stamp(ctx.ends_at) : null;
  if (!acceptsAnswer(stamp(ctx.db_now), endsAt)) return fail("TOO_LATE");

  const settings = parseSettings(ctx.settings);
  const correct = input.choice === num(ctx.correct_index);
  const responseMs = Math.max(0, num(ctx.elapsed_ms));
  const awarded = scoreAnswer({
    correct,
    points: num(ctx.cell_points),
    responseMs,
    timerSeconds: settings.timerSeconds,
    settings,
  });

  // Insert only while the same question is still open; the room row is locked meanwhile,
  // so the question cannot close between the check and the insert.
  const rows = await sql<{ revision: number }>`
    with ins as (
      insert into room_answers (room_id, player_id, cell_key, question_id, choice, is_correct, awarded, response_ms)
      select r.id, ${ctx.player_id}::uuid, r.cell_key, r.question_id, ${input.choice}, ${correct}, ${awarded}, ${responseMs}
      from game_rooms r
      where r.id = ${ctx.room_id}::uuid and r.state = 'question' and r.cell_key = ${ctx.cell_key}
      for share
      on conflict (room_id, cell_key, player_id) do nothing
      returning id
    )
    update game_rooms set revision = revision + 1, updated_at = now()
    where id = ${ctx.room_id}::uuid and exists (select 1 from ins)
    returning revision`;
  if (!rows.length) {
    const existing = await sql<{ id: number }>`
      select id from room_answers
      where room_id = ${ctx.room_id}::uuid and cell_key = ${ctx.cell_key} and player_id = ${ctx.player_id}::uuid`;
    return fail(existing.length ? "ALREADY_ANSWERED" : "WRONG_STATE");
  }

  const counts = await answerCounts(sql, ctx.room_id, ctx.cell_key);
  const closed =
    shouldClose({ now: stamp(ctx.db_now), endsAt: null, ...counts }) && (await closeQuestion(sql, ctx.room_id, ctx.cell_key));
  return { ok: true, closed };
}

export async function useHelper(
  sql: Sql,
  input: { code: string; playerToken: string },
  random: () => number = Math.random,
): Promise<Ok<{ hidden: number[] }> | LiarsFail> {
  const ctx = await answerContext(sql, input.code, input.playerToken);
  if (isFail(ctx)) return ctx;
  if (!parseSettings(ctx.settings).fiftyFifty) return fail("FORBIDDEN");
  if (ctx.state !== "question" || !ctx.cell_key || ctx.correct_index === null) return fail("WRONG_STATE");
  const answered = await sql<{ id: number }>`
    select id from room_answers where room_id = ${ctx.room_id}::uuid and cell_key = ${ctx.cell_key} and player_id = ${ctx.player_id}::uuid`;
  if (answered.length) return fail("ALREADY_ANSWERED");

  const hidden = pickHidden(num(ctx.option_count), num(ctx.correct_index), random);
  const rows = await sql<{ helper_hidden: number[] }>`
    update room_players
    set helper_used = true, helper_cell = ${ctx.cell_key}, helper_hidden = ${hidden}::smallint[]
    where id = ${ctx.player_id}::uuid and helper_used = false
    returning helper_hidden`;
  if (!rows.length) return fail("HELPER_USED");
  await bump(sql, ctx.room_id);
  return { ok: true, hidden };
}

/** Host: reveal the answer now, without waiting for the timer or for every player. */
export async function revealNow(sql: Sql, input: Auth): Promise<Ok | LiarsFail> {
  const auth = await authorise(sql, input);
  if (isFail(auth)) return auth;
  if (!auth.isHost) return fail("FORBIDDEN");
  if (auth.room.state !== "question" || !auth.room.cell_key) return fail("WRONG_STATE");
  return (await closeQuestion(sql, auth.room.id, auth.room.cell_key)) ? { ok: true } : fail("WRONG_STATE");
}

/** After a reveal: back to the board with the next picker, or finish when the board is used up. */
export async function nextTurn(sql: Sql, input: Auth): Promise<Ok<{ finished: boolean }> | LiarsFail> {
  const auth = await authorise(sql, input);
  if (isFail(auth)) return auth;
  const { room } = auth;
  if (room.state !== "reveal" || !room.cell_key) return fail("WRONG_STATE");
  if (!auth.isHost && (!auth.playerId || auth.playerId !== room.picker_id)) return fail("FORBIDDEN");

  await settle(sql, room.id, room.cell_key);
  const players = await sql<{ id: string; seat: number }>`select id, seat from room_players where room_id = ${room.id}::uuid`;
  const next = nextPicker(players.map((p) => ({ id: p.id, seat: num(p.seat) })), room.picker_id);
  const finished = boardComplete(list(room.categories).length, list(room.used_cells).length);
  const rows = await sql<{ state: LiarsState }>`
    update game_rooms
    set state = ${finished ? "finished" : "board"}, picker_id = ${next}::uuid,
        cell_key = null, cell_points = null, question_id = null, question_started_at = null, ends_at = null,
        revision = revision + 1, updated_at = now()
    where id = ${room.id}::uuid and state = 'reveal' and cell_key = ${room.cell_key}
    returning state`;
  if (!rows.length) return fail("WRONG_STATE");
  return { ok: true, finished };
}

/** Host: end the game now. An open question is closed and scored first. */
export async function endGame(sql: Sql, input: Auth): Promise<Ok | LiarsFail> {
  const auth = await authorise(sql, input);
  if (isFail(auth)) return auth;
  if (!auth.isHost) return fail("FORBIDDEN");
  const { room } = auth;
  if (room.state === "finished") return { ok: true };
  if (room.state === "question" && room.cell_key) await closeQuestion(sql, room.id, room.cell_key);
  if (room.cell_key) await settle(sql, room.id, room.cell_key);
  await sql`
    update game_rooms
    set state = 'finished', cell_key = null, cell_points = null, question_id = null, question_started_at = null, ends_at = null,
        revision = revision + 1, updated_at = now()
    where id = ${room.id}::uuid and state <> 'finished'`;
  return { ok: true };
}
