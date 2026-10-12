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

/** The egg a visitor chose: a colour (1–8, the brand egg colours) and an optional emoji. */
export type Avatar = { c: number; e?: string | null };

export const AVATAR_EMOJIS = ["🦊", "🐼", "🦁", "🐯", "🐸", "🐵", "🦄", "🐙", "🐢", "🦉", "🐧", "🐨", "🐰", "🦋", "🐳", "🌵", "🌙", "⭐", "🔥", "⚽", "🎮", "🎩", "👑", "🍉"];

export function cleanAvatar(value: unknown): Avatar | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { c?: unknown; e?: unknown };
  const c = Number(v.c);
  if (!Number.isInteger(c) || c < 1 || c > 8) return null;
  const e = typeof v.e === "string" && AVATAR_EMOJIS.includes(v.e) ? v.e : null;
  return { c, e };
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
