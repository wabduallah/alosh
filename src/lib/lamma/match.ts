/**
 * Text matching and timing helpers for free-text and speed-based answers.
 * Used by the game engine; kept dependency-free so it can run on the server.
 */

export type Locale = "ar" | "en";

export function normAr(input: string): string {
  return input
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function stripAl(input: string): string {
  const n = normAr(input);
  if (n.startsWith("ال") && n.length > 3) return n.slice(2);
  return n;
}

export function normEn(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

export function canon(input: string, locale: Locale): string {
  return locale === "en" ? normEn(input) : stripAl(input);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

export function textMatches(guess: string, accepted: string[], locale: Locale): boolean {
  const g = canon(guess, locale);
  if (!g) return false;
  return accepted.some((item) => {
    const a = canon(item, locale);
    if (!a) return false;
    if (a === g) return true;
    if (a.length >= 4 && g.length >= 4 && levenshtein(a, g) <= 1) return true;
    return false;
  });
}

export function speedPoints(responseMs: number, windowMs: number, base: number, speed: number): number {
  const t = Math.min(Math.max(responseMs, 0), windowMs);
  const ratio = 1 - t / Math.max(windowMs, 1);
  return base + Math.round(ratio * speed);
}
