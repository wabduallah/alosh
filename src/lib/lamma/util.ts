/**
 * Small, dependency-free helpers shared by the room engine. Everything here is pure
 * apart from the id generators, which read from the platform's secure random source.
 */
import { timingSafeEqual } from "node:crypto";

/** Unambiguous characters for room codes: no I, O, 0 or 1. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Parse a jsonb column that may arrive as a string or an already-parsed value. */
export function jparse<T>(value: unknown, fallback: T): T {
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

/** Coerce to a finite number, or return the fallback. */
export function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Round to an integer and keep it inside [min, max]; non-numeric input yields the fallback. */
export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(num(value, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Normalise a Date or date-like value to an ISO string, or null when it is empty or invalid. */
export function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Milliseconds since the epoch for a date-like value, or 0 when it is empty or invalid. */
export function stamp(value: unknown): number {
  const s = iso(value);
  return s ? Date.parse(s) : 0;
}

/** Random room code of the given length. */
export function rid(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return out;
}

/** Random hex string built from `size` secure random bytes. */
export function hex(size: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString("hex");
}

/** Constant-time token comparison. False for a missing token or a length mismatch. */
export function tokensMatch(stored: string, given?: string): boolean {
  if (!given || given.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stored), Buffer.from(given));
  } catch {
    return false;
  }
}

/** Player display name: strips angle brackets, collapses spaces, 2 to 16 characters, no links. */
export function cleanName(input: string): string | null {
  const name = input.replace(/[<>]/g, "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 16) return null;
  if (/https?:|www\./i.test(name)) return null;
  return name;
}
