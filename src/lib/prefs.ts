/**
 * Visitor preferences, kept on this device only (localStorage). Every read and
 * write is guarded: private windows and blocked storage just fall back to defaults.
 */

const KEYS = {
  muted: "alosh-muted",
  noVibrate: "alosh-no-vibrate",
  reduceMotion: "alosh-reduce-motion",
  avatar: "alosh-avatar",
  lastRoom: "alosh-last-room",
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

/* ---- Sound and vibration ---- */

export const soundOn = () => read(KEYS.muted) !== "1";
export const setSoundOn = (on: boolean) => write(KEYS.muted, on ? null : "1");
export const vibrationOn = () => read(KEYS.noVibrate) !== "1";
export const setVibrationOn = (on: boolean) => write(KEYS.noVibrate, on ? null : "1");

/** Vibrates the phone, unless the visitor turned vibration off. */
export function vibrate(pattern: number | number[]) {
  if (!vibrationOn()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // No vibration on this device.
  }
}

/* ---- Motion ---- */

export const reduceMotionOn = () => read(KEYS.reduceMotion) === "1";
export function setReduceMotion(on: boolean) {
  write(KEYS.reduceMotion, on ? "1" : null);
  applyMotion();
}
/** Puts the visitor's motion choice on <html> (the CSS reads the class). */
export function applyMotion() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("reduce-motion", reduceMotionOn());
}

/* ---- Avatar ---- */

/**
 * The egg a visitor chose. Each part is optional; a missing part follows join order.
 * c: egg colour 1–8 (the brand egg colours).
 * e: a bird from BIRD_IDS, or NO_AVATAR for the first letter of the name only.
 * (Older saves held an emoji in e; those now fall back to the automatic bird.)
 */
export type Avatar = { c?: number | null; e?: string | null };

/** The bird avatars, in the order they are handed out automatically. Drawings: components/bird-art.ts. */
export const BIRD_IDS = ["chick", "falcon", "hoopoe", "owl", "parrot", "penguin", "flamingo", "dove", "peacock", "duck", "toucan", "canary", "crow", "eagle", "bulbul", "kingfisher"] as const;
export const NO_AVATAR = "none";

export const isBird = (e: unknown): e is string => typeof e === "string" && (BIRD_IDS as readonly string[]).includes(e);

export function cleanAvatar(value: unknown): Avatar | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { c?: unknown; e?: unknown };
  const n = Number(v.c);
  const c = v.c != null && Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
  const e = isBird(v.e) || v.e === NO_AVATAR ? (v.e as string) : null;
  if (c === null && e === null) return null;
  const out: Avatar = {};
  if (c !== null) out.c = c;
  if (e !== null) out.e = e;
  return out;
}
export function getAvatar(): Avatar | null {
  try {
    return cleanAvatar(JSON.parse(read(KEYS.avatar) ?? "null"));
  } catch {
    return null;
  }
}
export const setAvatar = (a: Avatar | null) => write(KEYS.avatar, a ? JSON.stringify(a) : null);

/* ---- The room to come back to ---- */

export type LastRoom = { code: string; host: boolean; at: number };
const LAST_ROOM_HOURS = 12;

export function getLastRoom(): LastRoom | null {
  try {
    const v = JSON.parse(read(KEYS.lastRoom) ?? "null") as LastRoom | null;
    if (!v || typeof v.code !== "string" || !/^[A-Z0-9]{4,8}$/.test(v.code)) return null;
    if (Date.now() - Number(v.at) > LAST_ROOM_HOURS * 3600_000) return null;
    return { code: v.code, host: !!v.host, at: Number(v.at) };
  } catch {
    return null;
  }
}
export const rememberRoom = (code: string, host: boolean) => write(KEYS.lastRoom, JSON.stringify({ code: code.toUpperCase(), host, at: Date.now() }));
export const forgetRoom = () => write(KEYS.lastRoom, null);
