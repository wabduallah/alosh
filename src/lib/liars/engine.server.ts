/**
 * Server-only entry points for «الكذابون». Adds what the pure core does not do:
 * the database handle, per-IP and per-player rate limits, and a clear NOT_READY error
 * when supabase/schema_liars.sql has not been applied yet.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { createRateLimiter } from "@/lib/lamma/rate-limit";
import * as core from "./core";
import type { LiarsError, LiarsFail } from "./types";

const limiter = createRateLimiter();

async function ipKey(): Promise<string> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const req = getRequest();
  const ip = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req?.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function fail(error: LiarsError): LiarsFail {
  return { ok: false, error };
}

/** Run a core call with the database, mapping a missing schema to NOT_READY. */
async function withDb<T>(run: (sql: Awaited<ReturnType<typeof getSql>>) => Promise<T>): Promise<T | LiarsFail> {
  try {
    return await run(await getSql());
  } catch (error) {
    if (core.isSchemaMissing(error)) return fail("NOT_READY");
    throw error;
  }
}

async function limited(scope: string, max: number, windowMs: number, extra = ""): Promise<boolean> {
  return limiter.allow(`${scope}:${await ipKey()}:${extra}`, max, windowMs);
}

export async function listCategoriesNow() {
  return withDb(async (sql) => ({ ok: true as const, categories: await core.listCategories(sql) }));
}

export async function createRoomNow(
  input: { categories: string[]; settings: Record<string, unknown>; hostName: string },
  ctx: { userId: string | null },
) {
  if (!(await limited("liars-create", 10, 60_000))) return fail("RATE_LIMIT");
  return withDb((sql) => core.createRoom(sql, { ...input, userId: ctx.userId }));
}

export async function joinRoomNow(input: { code: string; name: string }, ctx: { userId: string | null }) {
  if (!(await limited("liars-join", 20, 60_000))) return fail("RATE_LIMIT");
  return withDb((sql) => core.joinRoom(sql, { ...input, userId: ctx.userId }));
}

export async function snapshotNow(input: { code: string; hostToken?: string; playerToken?: string; since?: number }) {
  if (!(await limited("liars-poll", 240, 60_000, input.code))) return fail("RATE_LIMIT");
  return withDb((sql) => core.snapshot(sql, input));
}

export type HostAction = "start" | "pick" | "reveal" | "next" | "end";

export async function actionNow(input: {
  code: string;
  action: HostAction;
  hostToken?: string;
  playerToken?: string;
  categoryId?: string;
  level?: number;
}) {
  if (!(await limited("liars-action", 60, 60_000, input.code))) return fail("RATE_LIMIT");
  const auth = { code: input.code, hostToken: input.hostToken, playerToken: input.playerToken };
  return withDb((sql) => {
    switch (input.action) {
      case "start":
        return core.startGame(sql, auth);
      case "pick":
        return core.pickCell(sql, { ...auth, categoryId: input.categoryId ?? "", level: input.level ?? 0 });
      case "reveal":
        return core.revealNow(sql, auth);
      case "next":
        return core.nextTurn(sql, auth);
      case "end":
        return core.endGame(sql, auth);
    }
  });
}

export async function answerNow(input: { code: string; playerToken: string; choice: number }) {
  if (!limiter.allow(`liars-answer:${input.playerToken}`, 20, 60_000)) return fail("RATE_LIMIT");
  return withDb((sql) => core.submitAnswer(sql, input));
}

export async function helperNow(input: { code: string; playerToken: string }) {
  if (!limiter.allow(`liars-helper:${input.playerToken}`, 10, 60_000)) return fail("RATE_LIMIT");
  return withDb((sql) => core.useHelper(sql, input));
}
