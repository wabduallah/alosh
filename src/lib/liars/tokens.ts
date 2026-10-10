/**
 * Per-room host and player tokens, kept in localStorage so a refresh (or the TV tab)
 * keeps its seat. Every access is guarded: storage can be unavailable or throw.
 */
type Role = "host" | "player";

function key(code: string, role: Role): string {
  return `liars:${role}:${code.toUpperCase()}`;
}

export function readToken(code: string, role: Role): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key(code, role)) ?? "";
  } catch {
    return "";
  }
}

export function saveToken(code: string, role: Role, value: string | null | undefined): void {
  if (typeof window === "undefined" || !value) return;
  try {
    window.localStorage.setItem(key(code, role), value);
  } catch {
    // Storage blocked (private mode): the token lives only for this page view.
  }
}
