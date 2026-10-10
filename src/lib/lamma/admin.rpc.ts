import { createServerFn } from "@tanstack/react-start";
import { optionalUser } from "./session";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

function pack(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export const adminQuery = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: { section?: string }) => ({ section: text(input?.section, 40) }))
  .handler(async ({ data, context }) => {
    const { adminQueryNow } = await import("./admin.server");
    const res = await adminQueryNow(data.section, { userId: context.userId, email: context.email });
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, data: pack(res.data) };
  });

export const adminMutate = createServerFn({ method: "POST" })
  .middleware([optionalUser])
  .validator((input: { op?: string; payload?: Record<string, unknown> }) => ({
    op: text(input?.op, 40),
    payload: input?.payload && typeof input.payload === "object" ? input.payload : {},
  }))
  .handler(async ({ data, context }) => {
    const { adminMutateNow } = await import("./admin.server");
    const res = await adminMutateNow(data.op, data.payload, { userId: context.userId, email: context.email });
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const };
  });
