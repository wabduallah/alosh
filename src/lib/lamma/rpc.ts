import { createServerFn } from "@tanstack/react-start";
import { optionalUser } from "./session";

type Diff = "easy" | "medium" | "hard" | "mixed";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(typeof value === "number" ? value : Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function diff(value: unknown): Diff {
  return value === "easy" || value === "medium" || value === "hard" || value === "mixed" ? value : "mixed";
}

export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { publicConfig } = await import("./engine.server");
  return publicConfig();
});

export const listGames = createServerFn({ method: "GET" }).handler(async () => {
  const { listGamesNow } = await import("./engine.server");
  return listGamesNow();
});

export const getGame = createServerFn({ method: "GET" })
  .validator((input: { id?: string }) => ({ id: text(input?.id, 80) }))
  .handler(async ({ data }) => {
    const { gameDetail } = await import("./engine.server");
    return gameDetail(data.id);
  });

export const createRoom = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({
    gameId: text(input.gameId, 80),
    rounds: int(input.rounds, 1, 15, 6),
    seconds: int(input.seconds, 8, 180, 30),
    difficulty: diff(input.difficulty),
    sound: bool(input.sound, true),
    music: bool(input.music, false),
    maxPlayers: int(input.maxPlayers, 2, 14, 14),
    locale: input.locale === "en" ? ("en" as const) : ("ar" as const),
    promo: text(input.promo, 24) || undefined,
    hostName: text(input.hostName, 24) || undefined,
    hostMode: input.hostMode === "narrator" ? ("narrator" as const) : ("player" as const),
  }))
  .handler(async ({ data, context }) => {
    const { createRoomNow } = await import("./engine.server");
    return createRoomNow(data, { userId: context.userId, email: context.email });
  });

export const joinRoom = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({
    code: text(input.code, 8).toUpperCase(),
    name: text(input.name, 24),
  }))
  .handler(async ({ data, context }) => {
    const { joinRoomNow } = await import("./engine.server");
    return joinRoomNow(data, { userId: context.userId, email: context.email });
  });

export const getSnapshot = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    code: text(input.code, 8).toUpperCase(),
    hostToken: text(input.hostToken, 80) || undefined,
    playerToken: text(input.playerToken, 80) || undefined,
  }))
  .handler(async ({ data }) => {
    const { snapshotNow } = await import("./engine.server");
    return snapshotNow(data);
  });

export const submitAnswer = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    code: text(input.code, 8).toUpperCase(),
    playerToken: text(input.playerToken, 80),
    round: int(input.round, 1, 30, 1),
    payload: input.payload && typeof input.payload === "object" ? (input.payload as Record<string, unknown>) : {},
  }))
  .handler(async ({ data }) => {
    const { submitNow } = await import("./engine.server");
    return submitNow(data);
  });

export const sendCheer = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    code: text(input.code, 8).toUpperCase(),
    playerToken: text(input.playerToken, 80),
    kind: text(input.kind, 12),
  }))
  .handler(async ({ data }) => {
    const { cheerNow } = await import("./engine.server");
    return cheerNow(data);
  });

export const hostAction = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({
    code: text(input.code, 8).toUpperCase(),
    hostToken: text(input.hostToken, 80),
    action: text(input.action, 24),
    extra: input.extra && typeof input.extra === "object" ? (input.extra as Record<string, unknown>) : undefined,
  }))
  .handler(async ({ data, context }) => {
    const { hostNow } = await import("./engine.server");
    return hostNow(data, { userId: context.userId, email: context.email });
  });

export const redeemPromo = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({
    promo: text(input.promo, 24),
    roomCode: text(input.roomCode, 8).toUpperCase() || undefined,
    hostToken: text(input.hostToken, 80) || undefined,
  }))
  .handler(async ({ data, context }) => {
    const { redeemNow } = await import("./engine.server");
    return redeemNow(data, { userId: context.userId, email: context.email });
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([optionalUser])
  .handler(async ({ context }) => {
    const { profileNow } = await import("./engine.server");
    return profileNow({ userId: context.userId, email: context.email });
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({ name: text(input.name, 24) }))
  .handler(async ({ data, context }) => {
    const { updateProfileNow } = await import("./engine.server");
    return updateProfileNow(data, { userId: context.userId, email: context.email });
  });

export const toggleFavorite = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({ gameId: text(input.gameId, 80) }))
  .handler(async ({ data, context }) => {
    const { favoriteNow } = await import("./engine.server");
    return favoriteNow(data, { userId: context.userId, email: context.email });
  });

export const claimAdmin = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({ studio: text(input.studio, 40) }))
  .handler(async ({ data, context }) => {
    const { claimAdminNow } = await import("./engine.server");
    return claimAdminNow(data, { userId: context.userId, email: context.email });
  });

export const soloQuestion = createServerFn({ method: "GET" })
  .validator((input: { gameId?: string }) => ({ gameId: text(input?.gameId, 80) }))
  .handler(async ({ data }) => {
    const { soloQuestionNow } = await import("./engine.server");
    return soloQuestionNow(data.gameId);
  });

export const soloAnswer = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown>) => ({
    questionId: int(input.questionId, 1, 1_000_000, 0),
    choiceId: text(input.choiceId, 40),
  }))
  .handler(async ({ data }) => {
    const { soloAnswerNow } = await import("./engine.server");
    return soloAnswerNow(data);
  });

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: Record<string, unknown>) => ({
    planId: text(input.planId, 40),
    provider: text(input.provider, 20) || "stripe",
    promo: text(input.promo, 24),
    origin: text(input.origin, 200),
  }))
  .handler(async ({ data, context }) => {
    const { checkoutNow } = await import("./payments.server");
    return checkoutNow(data, { userId: context.userId, email: context.email });
  });

