/**
 * «الكذابون» server functions. Each validator trims and bounds client input before it
 * reaches the engine; the engine itself is loaded only on the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { optionalUser } from "@/lib/lamma/session";
import { MAX_CATEGORIES } from "./types";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function code(value: unknown): string {
  return text(value, 8).toUpperCase();
}

function token(value: unknown): string | undefined {
  const t = text(value, 64);
  return /^[0-9a-f]{32}$/.test(t) ? t : undefined;
}

function int(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function flatSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["timerSeconds", "fiftyFifty", "penalty", "speedBonus", "maxPlayers"]) {
    const v = src[key];
    if (typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}

export const listLiarsCategories = createServerFn({ method: "GET" }).handler(async () => {
  const { listCategoriesNow } = await import("./engine.server");
  return listCategoriesNow();
});

export const createLiarsRoom = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({
    categories: Array.isArray(input?.categories)
      ? (input.categories as unknown[]).slice(0, MAX_CATEGORIES * 2).map((c) => text(c, 40)).filter(Boolean)
      : [],
    settings: flatSettings(input?.settings),
    hostName: text(input?.hostName, 40),
  }))
  .handler(async ({ data, context }) => {
    const { createRoomNow } = await import("./engine.server");
    return createRoomNow(data, { userId: context.userId });
  });

export const joinLiarsRoom = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({ code: code(input?.code), name: text(input?.name, 40) }))
  .handler(async ({ data, context }) => {
    const { joinRoomNow } = await import("./engine.server");
    return joinRoomNow(data, { userId: context.userId });
  });

export const getLiarsSnapshot = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    code: code(input?.code),
    hostToken: token(input?.hostToken),
    playerToken: token(input?.playerToken),
    since: input?.since === undefined || input?.since === null ? undefined : int(input.since, -1),
  }))
  .handler(async ({ data }) => {
    const { snapshotNow } = await import("./engine.server");
    return snapshotNow(data);
  });

const ACTIONS = ["start", "pick", "reveal", "next", "end"] as const;

export const liarsAction = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    code: code(input?.code),
    action: (ACTIONS as readonly string[]).includes(input?.action as string) ? (input.action as (typeof ACTIONS)[number]) : "start",
    hostToken: token(input?.hostToken),
    playerToken: token(input?.playerToken),
    categoryId: text(input?.categoryId, 40),
    level: int(input?.level, 0),
  }))
  .handler(async ({ data }) => {
    const { actionNow } = await import("./engine.server");
    return actionNow(data);
  });

export const liarsAnswer = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    code: code(input?.code),
    playerToken: token(input?.playerToken) ?? "",
    choice: int(input?.choice, -1),
  }))
  .handler(async ({ data }) => {
    const { answerNow } = await import("./engine.server");
    return answerNow(data);
  });

export const liarsHelper = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({ code: code(input?.code), playerToken: token(input?.playerToken) ?? "" }))
  .handler(async ({ data }) => {
    const { helperNow } = await import("./engine.server");
    return helperNow(data);
  });
