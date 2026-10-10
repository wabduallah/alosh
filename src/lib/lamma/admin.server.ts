import { getSql, type Sql } from "@/lib/db";
import { isAdmin, ready } from "./engine.server";
import { markPaymentPaid } from "./payments.server";

type Ctx = { userId: string | null; email: string | null };

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function gate(ctx: Ctx): Promise<Sql | null> {
  const sql = await getSql();
  await ready(sql);
  if (await isAdmin(sql, ctx.userId)) return sql;
  return null;
}

export async function adminQueryNow(section: string, ctx: Ctx) {
  const sql = await gate(ctx);
  if (!sql) return { ok: false as const, error: "FORBIDDEN" };
  if (section === "dashboard" || section === "reports") {
    const users = await sql<{ n: number }>`select count(*) as n from users`;
    const roomsToday = await sql<{ n: number }>`select count(*) as n from rooms where created_at > now() - interval '1 day'`;
    const playersToday = await sql<{ n: number }>`select count(*) as n from players where joined_at > now() - interval '1 day' and is_bot = false`;
    const games = await sql<{ n: number }>`select count(*) as n from games`;
    const activeRooms = await sql<{ n: number }>`select count(*) as n from rooms where status in ('WAITING','PLAYING','ROUND_END')`;
    const revenue = await sql<{ n: number }>`select coalesce(sum(amount_sar), 0) as n from payments where status = 'paid'`;
    const subs = await sql<{ n: number }>`select count(*) as n from subscriptions where status = 'active'`;
    const top = await sql<{ game_id: string; n: number }>`select game_id, count(*) as n from rooms group by game_id order by n desc limit 6`;
    const names = await sql<{ id: string; name_ar: string }>`select id, name_ar from games`;
    const nameOf = new Map(names.map((row) => [row.id, row.name_ar]));
    return {
      ok: true as const,
      data: {
        users: num(users[0]?.n),
        roomsToday: num(roomsToday[0]?.n),
        playersToday: num(playersToday[0]?.n),
        games: num(games[0]?.n),
        activeRooms: num(activeRooms[0]?.n),
        revenue: num(revenue[0]?.n),
        subs: num(subs[0]?.n),
        top: top.map((row) => ({ id: row.game_id, name: nameOf.get(row.game_id) ?? row.game_id, plays: num(row.n) })),
      },
    };
  }
  if (section === "games") {
    const rows = await sql`select * from games order by sort_order`;
    return { ok: true as const, data: rows };
  }
  if (section === "questions") {
    const rows = await sql`select id, game_id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, status, source from questions order by id desc limit 200`;
    return { ok: true as const, data: rows };
  }
  if (section === "categories") {
    return { ok: true as const, data: await sql`select * from categories order by sort_order` };
  }
  if (section === "users") {
    const rows = await sql`select u."id", u."name", u."email", u."createdAt", p.role from users u left join profiles p on p.user_id = u."id" order by u."createdAt" desc limit 100`;
    return { ok: true as const, data: rows };
  }
  if (section === "rooms") {
    const rows = await sql`select id, game_id, status, current_round, created_at, expires_at from rooms order by created_at desc limit 50`;
    return { ok: true as const, data: rows };
  }
  if (section === "subscriptions") {
    return { ok: true as const, data: await sql`select * from subscriptions order by created_at desc limit 50` };
  }
  if (section === "payments") {
    return { ok: true as const, data: await sql`select * from payments order by created_at desc limit 50` };
  }
  if (section === "promos") {
    return { ok: true as const, data: await sql`select * from promo_codes order by created_at desc` };
  }
  if (section === "translations") {
    return { ok: true as const, data: await sql`select locale, key, value from ui_strings order by key` };
  }
  if (section === "settings") {
    return { ok: true as const, data: await sql`select key, value from settings order by key` };
  }
  if (section === "lexicon") {
    return { ok: true as const, data: await sql`select id, locale, letter, category, word, source from lexicon order by id desc limit 200` };
  }
  if (section === "imports") {
    return sql`select * from imports order by id desc limit 30`;
  }
  if (section === "ai") {
    return sql`select * from ai_drafts order by id desc limit 40`;
  }
  if (section === "addons") {
    return sql`select * from addons order by id`;
  }
  if (section === "sections") {
    return sql`select * from sections order by sort_order`;
  }
  if (section === "plans") {
    return { ok: true as const, data: await sql`select * from plans order by sort_order` };
  }
  return { ok: false as const, error: "BAD_INPUT" };
}

export async function adminMutateNow(op: string, payload: Record<string, unknown>, ctx: Ctx) {
  const sql = await gate(ctx);
  if (!sql) return { ok: false as const, error: "FORBIDDEN" };
  if (op === "saveGame") {
    const id = text(payload.id, 80) || `game-${Date.now()}`;
    const mode = text(payload.playMode, 20);
    const playMode = mode === "coop" || mode === "teams" || mode === "social" ? mode : "competitive";
    await sql`insert into games (id, name_ar, name_en, description_ar, description_en, category, tier, engine, min_players, max_players, default_seconds, default_rounds, scoring, visible, status, sort_order, icon, source, play_mode, duration_min, duration_max, rules_ar, rules_en, how_ar, how_en) values (${id}, ${text(payload.nameAr, 120)}, ${text(payload.nameEn, 120)}, ${text(payload.descAr, 400)}, ${text(payload.descEn, 400)}, ${text(payload.category, 40) || "trivia"}, ${payload.tier === "premium" ? "premium" : "free"}, ${text(payload.engine, 40) || "quiz"}, ${num(payload.minPlayers, 2)}, ${Math.min(14, num(payload.maxPlayers, 14))}, ${num(payload.seconds, 20)}, ${num(payload.rounds, 6)}, ${JSON.stringify(payload.scoring ?? { correct: 10 })}::jsonb, ${payload.visible !== false}, ${text(payload.status, 20) || "published"}, ${num(payload.sort, 50)}, ${text(payload.icon, 40) || "Gamepad2"}, 'admin', ${playMode}, ${num(payload.durationMin, 5)}, ${num(payload.durationMax, 15)}, ${text(payload.rulesAr, 1200)}, ${text(payload.rulesEn, 1200)}, ${text(payload.howAr, 1200)}, ${text(payload.howEn, 1200)}) on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en, category = excluded.category, tier = excluded.tier, engine = excluded.engine, min_players = excluded.min_players, max_players = excluded.max_players, default_seconds = excluded.default_seconds, default_rounds = excluded.default_rounds, scoring = excluded.scoring, visible = excluded.visible, status = excluded.status, sort_order = excluded.sort_order, icon = excluded.icon, play_mode = excluded.play_mode, duration_min = excluded.duration_min, duration_max = excluded.duration_max, rules_ar = excluded.rules_ar, rules_en = excluded.rules_en, how_ar = excluded.how_ar, how_en = excluded.how_en`;
    return { ok: true as const };
  }
  if (op === "deleteGame") {
    await sql`delete from games where id = ${text(payload.id, 80)} and source <> 'seed'`;
    return { ok: true as const };
  }
  if (op === "toggleGame") {
    await sql`update games set visible = not visible where id = ${text(payload.id, 80)}`;
    return { ok: true as const };
  }
  if (op === "saveQuestion") {
    const id = num(payload.id, 0);
    const choices = JSON.stringify(payload.choices ?? []);
    const accepted = JSON.stringify(payload.accepted ?? []);
    const icons = JSON.stringify(payload.icons ?? []);
    if (id > 0) {
      await sql`update questions set game_id = ${text(payload.gameId, 80)}, prompt_ar = ${text(payload.promptAr, 400)}, prompt_en = ${text(payload.promptEn, 400)}, kind = ${text(payload.kind, 20) || "mcq"}, choices = ${choices}::jsonb, correct = ${text(payload.correct, 80) || null}, accepted = ${accepted}::jsonb, difficulty = ${text(payload.difficulty, 20) || "medium"}, icons = ${icons}::jsonb, points = ${num(payload.points, 10)}, status = ${text(payload.status, 20) || "published"} where id = ${id}`;
    } else {
      await sql`insert into questions (game_id, prompt_ar, prompt_en, kind, choices, correct, accepted, difficulty, icons, points, status, source) values (${text(payload.gameId, 80)}, ${text(payload.promptAr, 400)}, ${text(payload.promptEn, 400)}, ${text(payload.kind, 20) || "mcq"}, ${choices}::jsonb, ${text(payload.correct, 80) || null}, ${accepted}::jsonb, ${text(payload.difficulty, 20) || "medium"}, ${icons}::jsonb, ${num(payload.points, 10)}, ${text(payload.status, 20) || "published"}, 'admin')`;
    }
    return { ok: true as const };
  }
  if (op === "setQuestionStatus") {
    await sql`update questions set status = ${text(payload.status, 20)} where id = ${num(payload.id)}`;
    return { ok: true as const };
  }
  if (op === "deleteQuestion") {
    await sql`delete from questions where id = ${num(payload.id)} and source <> 'seed'`;
    return { ok: true as const };
  }
  if (op === "importQuestions") {
    const gameId = text(payload.gameId, 80);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    let n = 0;
    for (const row of rows.slice(0, 200)) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const promptAr = text(item.promptAr ?? item.prompt_ar, 400);
      const promptEn = text(item.promptEn ?? item.prompt_en, 400);
      if (!promptAr || !promptEn) continue;
      await sql`insert into questions (game_id, prompt_ar, prompt_en, kind, choices, correct, difficulty, points, status, source) values (${gameId}, ${promptAr}, ${promptEn}, ${text(item.kind, 20) || "mcq"}, ${JSON.stringify(item.choices ?? [])}::jsonb, ${text(item.correct, 80) || null}, ${text(item.difficulty, 20) || "medium"}, ${num(item.points, 10)}, 'pending', 'import')`;
      n += 1;
    }
    return { ok: true as const, imported: n };
  }
  if (op === "saveCategory") {
    const id = text(payload.id, 40);
    await sql`insert into categories (id, name_ar, name_en, sort_order) values (${id}, ${text(payload.nameAr, 80)}, ${text(payload.nameEn, 80)}, ${num(payload.sort, 0)}) on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, sort_order = excluded.sort_order`;
    return { ok: true as const };
  }
  if (op === "deleteCategory") {
    await sql`delete from categories where id = ${text(payload.id, 40)}`;
    return { ok: true as const };
  }
  if (op === "setRole") {
    const role = payload.role === "admin" ? "admin" : "player";
    const userId = text(payload.userId, 80);
    await sql`insert into profiles (user_id, role) values (${userId}, ${role}) on conflict (user_id) do update set role = ${role}`;
    return { ok: true as const };
  }
  if (op === "closeRoom") {
    await sql`update rooms set status = 'CLOSED', revision = revision + 1, updated_at = now() where id = ${text(payload.id, 12)}`;
    return { ok: true as const };
  }
  if (op === "resetRoom") {
    const id = text(payload.id, 12);
    await sql`delete from answers where room_id = ${id}`;
    await sql`update players set score = 0, round_score = 0 where room_id = ${id}`;
    await sql`update rooms set status = 'WAITING', current_round = 0, round_state = '{}'::jsonb, revision = revision + 1, updated_at = now() where id = ${id}`;
    return { ok: true as const };
  }
  if (op === "kickPlayer") {
    await sql`delete from players where id = ${text(payload.playerId, 40)} and room_id = ${text(payload.roomId, 12)}`;
    await sql`update rooms set revision = revision + 1 where id = ${text(payload.roomId, 12)}`;
    return { ok: true as const };
  }
  if (op === "savePlan") {
    await sql`update plans set name_ar = ${text(payload.nameAr, 80)}, name_en = ${text(payload.nameEn, 80)}, price_sar = ${num(payload.price)}, active = ${payload.active !== false} where id = ${text(payload.id, 40)}`;
    return { ok: true as const };
  }
  if (op === "savePromo") {
    const code = text(payload.code, 24).toUpperCase();
    await sql`insert into promo_codes (code, kind, amount, max_uses, active, source, expires_at) values (${code}, ${text(payload.kind, 20) || "percent"}, ${num(payload.amount)}, ${payload.maxUses == null || payload.maxUses === "" ? null : num(payload.maxUses)}, ${payload.active !== false}, 'admin', ${text(payload.expiresAt, 40) || null}) on conflict (code) do update set kind = excluded.kind, amount = excluded.amount, max_uses = excluded.max_uses, active = excluded.active`;
    return { ok: true as const };
  }
  if (op === "deletePromo") {
    await sql`delete from promo_codes where code = ${text(payload.code, 24).toUpperCase()} and source <> 'seed'`;
    return { ok: true as const };
  }
  if (op === "saveSetting") {
    const key = text(payload.key, 40);
    if (!key || key === "seed") return { ok: false as const, error: "BAD_INPUT" };
    await sql`insert into settings (key, value) values (${key}, ${JSON.stringify(payload.value ?? {})}::jsonb) on conflict (key) do update set value = excluded.value`;
    return { ok: true as const };
  }
  if (op === "setString") {
    await sql`insert into ui_strings (locale, key, value) values (${text(payload.locale, 8) || "ar"}, ${text(payload.key, 80)}, ${text(payload.value, 500)}) on conflict (locale, key) do update set value = excluded.value`;
    return { ok: true as const };
  }
  if (op === "addLexicon") {
    await sql`insert into lexicon (locale, letter, category, word, source) values (${text(payload.locale, 8) || "ar"}, ${text(payload.letter, 8)}, ${text(payload.category, 20)}, ${text(payload.word, 40)}, 'admin') on conflict do nothing`;
    return { ok: true as const };
  }
  if (op === "deleteLexicon") {
    await sql`delete from lexicon where id = ${num(payload.id)}`;
    return { ok: true as const };
  }
  if (op === "markPayment") {
    await markPaymentPaid(text(payload.id, 80));
    return { ok: true as const };
  }
  if (op === "purgeSeed") {
    await sql`delete from questions where source = 'seed'`;
    await sql`delete from games where source = 'seed'`;
    await sql`delete from promo_codes where source = 'seed'`;
    await sql`insert into settings (key, value) values ('seed', ${JSON.stringify({ loaded: true, purged: true })}::jsonb) on conflict (key) do update set value = excluded.value`;
    return { ok: true as const };
  }
  if (op === "generateQuestions" || op === "draftGame") {
    return ai(sql, op, payload);
  }
  if (op === "previewCsv") {
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 20) : [];
    const headers = rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0] as object) : [];
    await sql`insert into imports (filename, game_id, mapping, row_count, status) values (${text(payload.filename, 120) || "upload.csv"}, ${text(payload.gameId, 80) || null}, ${JSON.stringify(payload.mapping ?? {})}::jsonb, ${Array.isArray(payload.rows) ? payload.rows.length : 0}, 'preview')`;
    return { ok: true as const, headers, sample: rows };
  }
  if (op === "commitCsv") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const mapping = (payload.mapping ?? {}) as Record<string, string>;
    const gameId = text(payload.gameId, 80);
    if (!gameId) return { ok: false as const, error: "BAD_INPUT" };
    let n = 0;
    for (const row of rows.slice(0, 500)) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const promptAr = text(rec[mapping.promptAr || "prompt_ar"], 400);
      const answer = text(rec[mapping.answer || "correct"], 200);
      if (!promptAr || !answer) continue;
      const choices = ["a", "b", "c", "d"].map((key, i) => {
        const col = mapping[`choice${i + 1}`];
        const value = col ? text(rec[col], 200) : "";
        return value ? { id: key, ar: value, en: value } : null;
      }).filter(Boolean);
      await sql`insert into questions (game_id, prompt_ar, prompt_en, kind, choices, correct, difficulty, points, category, status, source) values (${gameId}, ${promptAr}, ${text(rec[mapping.promptEn || "prompt_en"], 400) || promptAr}, ${choices.length ? "mcq" : "text"}, ${JSON.stringify(choices)}::jsonb, ${answer}, ${text(rec[mapping.difficulty || "difficulty"], 20) || "medium"}, ${num(rec[mapping.points || "points"], 10)}, ${text(rec[mapping.category || "category"], 80) || null}, 'pending', 'csv')`;
      n += 1;
    }
    await sql`insert into imports (filename, game_id, mapping, row_count, status) values (${text(payload.filename, 120) || "upload.csv"}, ${gameId}, ${JSON.stringify(mapping)}::jsonb, ${n}, 'imported')`;
    return { ok: true as const, imported: n };
  }
  if (op === "toggleAddon") {
    const id = text(payload.id, 40);
    await sql`update addons set enabled = not enabled where id = ${id}`;
    return { ok: true as const };
  }
  if (op === "saveSection") {
    const id = text(payload.id, 40);
    if (!id) return { ok: false as const, error: "BAD_INPUT" };
    await sql`insert into sections (id, name_ar, name_en, icon, href, description_ar, description_en, visible, sort_order) values (${id}, ${text(payload.nameAr, 80) || id}, ${text(payload.nameEn, 80) || id}, ${text(payload.icon, 40) || "Gamepad2"}, ${text(payload.href, 80) || "/"}, ${text(payload.descriptionAr, 200)}, ${text(payload.descriptionEn, 200)}, ${payload.visible !== false}, ${num(payload.sort, 50)}) on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, icon = excluded.icon, href = excluded.href, description_ar = excluded.description_ar, visible = excluded.visible, sort_order = excluded.sort_order`;
    return { ok: true as const };
  }
  if (op === "reviewDraft") {
    const id = num(payload.id, 0);
    const status = text(payload.status, 20) || "review";
    await sql`update ai_drafts set status = ${status}, note = ${text(payload.note, 400)} where id = ${id}`;
    return { ok: true as const };
  }
  return { ok: false as const, error: "BAD_INPUT" };
}

async function ai(sql: Sql, op: string, payload: Record<string, unknown>) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false as const, error: "AI_OFF" };
  const count = Math.min(8, Math.max(1, num(payload.count, 4)));
  const lang = text(payload.language, 8) || "ar";
  const topic = text(payload.prompt ?? payload.topic, 400);
  const gameId = text(payload.gameId, 80);
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.4,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content:
            "Return only JSON. No markdown. Shape: {\"nameAr\",\"nameEn\",\"descriptionAr\",\"descriptionEn\",\"questions\":[{\"promptAr\",\"promptEn\",\"choices\":[{\"id\",\"ar\",\"en\"}],\"correct\"}]}. Family-safe. correct is a choice id.",
        },
        {
          role: "user",
          content: `${op === "draftGame" ? "Draft a party quiz game. " : "Write quiz questions. "}Language focus: ${lang}. Count: ${count}. Topic: ${topic || "Saudi family gathering"}. Difficulty: ${text(payload.difficulty, 20) || "mixed"}.`,
        },
      ],
    }),
  });
  if (!res.ok) return { ok: false as const, error: "AI_FAIL" };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content ?? "";
  const parsed = parseJson(raw);
  if (!parsed) return { ok: false as const, error: "AI_FAIL" };
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  let target = gameId;
  if (op === "draftGame") {
    target = `ai-${Date.now()}`;
    await sql`insert into games (id, name_ar, name_en, description_ar, description_en, category, tier, engine, default_seconds, default_rounds, scoring, visible, status, icon, source) values (${target}, ${text(parsed.nameAr, 120) || "مسودة"}, ${text(parsed.nameEn, 120) || "Draft"}, ${text(parsed.descriptionAr, 400) || topic}, ${text(parsed.descriptionEn, 400) || topic}, 'party', 'free', 'quiz', 20, ${Math.min(10, questions.length || 6)}, '{"correct":10}'::jsonb, false, 'draft', 'Sparkles', 'ai')`;
  }
  if (!target) return { ok: false as const, error: "BAD_INPUT" };
  let n = 0;
  for (const item of questions.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const promptAr = text(q.promptAr, 400);
    const promptEn = text(q.promptEn, 400);
    if (!promptAr || !promptEn) continue;
    await sql`insert into questions (game_id, prompt_ar, prompt_en, kind, choices, correct, difficulty, status, source) values (${target}, ${promptAr}, ${promptEn}, 'mcq', ${JSON.stringify(q.choices ?? [])}::jsonb, ${text(q.correct, 8) || null}, ${text(payload.difficulty, 20) || "medium"}, 'pending', 'ai')`;
    n += 1;
  }
  await sql`insert into ai_drafts (kind, payload, status, note) values (${op}, ${JSON.stringify({ gameId: target, count: n, topic })}::jsonb, 'review', 'بانتظار اعتماد المدير')`;
  return { ok: true as const, imported: n, gameId: target };
}

function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    const value = JSON.parse(cleaned) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
