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
    const activeRooms = await sql<{ n: number }>`select count(*) as n from rooms where status in ('WAITING','PLAYING','ROUND_END')`;
    const revenue = await sql<{ n: number }>`select coalesce(sum(amount_sar), 0) as n from payments where status = 'paid'`;
    const subs = await sql<{ n: number }>`select count(*) as n from subscriptions where status = 'active'`;
    return {
      ok: true as const,
      data: {
        users: num(users[0]?.n),
        roomsToday: num(roomsToday[0]?.n),
        playersToday: num(playersToday[0]?.n),
        activeRooms: num(activeRooms[0]?.n),
        revenue: num(revenue[0]?.n),
        subs: num(subs[0]?.n),
      },
    };
  }
  if (section === "users") {
    const rows = await sql`select u."id", u."name", u."email", u."createdAt", p.role from users u left join profiles p on p.user_id = u."id" order by u."createdAt" desc limit 100`;
    return { ok: true as const, data: rows };
  }
  if (section === "rooms") {
    const rows = await sql`select r.id, r.game_id, r.status, r.current_round, r.created_at, r.expires_at,
      (select count(*) from players p where p.room_id = r.id and p.is_bot = false)::int as seated,
      (select count(*) from players p where p.room_id = r.id and p.is_bot = false and p.last_seen > now() - interval '2 minutes')::int as online
      from rooms r order by r.created_at desc limit 50`;
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
  if (section === "addons") {
    return { ok: true as const, data: await sql`select * from addons order by id` };
  }
  if (section === "plans") {
    return { ok: true as const, data: await sql`select * from plans order by sort_order` };
  }
  return { ok: false as const, error: "BAD_INPUT" };
}

export async function adminMutateNow(op: string, payload: Record<string, unknown>, ctx: Ctx) {
  const sql = await gate(ctx);
  if (!sql) return { ok: false as const, error: "FORBIDDEN" };
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
  if (op === "markPayment") {
    await markPaymentPaid(text(payload.id, 80));
    return { ok: true as const };
  }
  if (op === "toggleAddon") {
    const id = text(payload.id, 40);
    await sql`update addons set enabled = not enabled where id = ${id}`;
    return { ok: true as const };
  }
  return { ok: false as const, error: "BAD_INPUT" };
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
