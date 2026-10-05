export type LetterCat = "boy" | "girl" | "animal" | "object" | "country";
export const LETTER_CATS: LetterCat[] = ["boy", "girl", "animal", "object", "country"];

export type CellVerdict = "unique" | "duplicate" | "bad" | "empty";
export type LetterCell = { text: string; points: number; verdict: CellVerdict };
export type LetterRules = { unique: number; duplicate: number; wrong: number; empty: number };

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

export function sameAnswer(a: string, b: string, locale: Locale): boolean {
  return canon(a, locale) !== "" && canon(a, locale) === canon(b, locale);
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

type Bank = Record<string, Record<LetterCat, string[]>>;

function acceptedWord(text: string, letter: string, cat: LetterCat, locale: Locale, bank: Bank): boolean {
  const g = canon(text, locale);
  const L = canon(letter, locale);
  if (!g || !L || !g.startsWith(L)) return false;
  const list = bank[letter]?.[cat] ?? bank[L]?.[cat] ?? bank[letter.toUpperCase()]?.[cat] ?? [];
  return list.some((word) => canon(word, locale) === g);
}

export function scoreLetterRound(args: {
  submissions: { playerId: string; fields: Record<LetterCat, string> }[];
  letter: string;
  locale: Locale;
  bank: Bank;
  rules: LetterRules;
}): {
  playerId: string;
  fields: Record<LetterCat, LetterCell>;
  total: number;
  correct: number;
  wrong: number;
}[] {
  const preliminary = args.submissions.map((sub) => {
    const fields = {} as Record<LetterCat, { text: string; ok: boolean; empty: boolean; key: string }>;
    for (const cat of LETTER_CATS) {
      const text = (sub.fields[cat] ?? "").trim().slice(0, 40);
      const key = canon(text, args.locale);
      const empty = key.length === 0;
      const ok = !empty && acceptedWord(text, args.letter, cat, args.locale, args.bank);
      fields[cat] = { text, ok, empty, key };
    }
    return { playerId: sub.playerId, fields };
  });

  return preliminary.map((row) => {
    const fields = {} as Record<LetterCat, LetterCell>;
    let total = 0;
    let correct = 0;
    let wrong = 0;
    for (const cat of LETTER_CATS) {
      const cell = row.fields[cat];
      let verdict: CellVerdict = "bad";
      let points = args.rules.wrong;
      if (cell.empty) {
        verdict = "empty";
        points = args.rules.empty;
      } else if (!cell.ok) {
        verdict = "bad";
        points = args.rules.wrong;
        wrong += 1;
      } else {
        const twins = preliminary.filter((other) => other.fields[cat].ok && other.fields[cat].key === cell.key);
        if (twins.length === 1) {
          verdict = "unique";
          points = args.rules.unique;
        } else {
          verdict = "duplicate";
          points = args.rules.duplicate;
        }
        correct += 1;
      }
      total += points;
      fields[cat] = { text: cell.text, points, verdict };
    }
    return { playerId: row.playerId, fields, total, correct, wrong };
  });
}

export function speedPoints(responseMs: number, windowMs: number, base: number, speed: number): number {
  const t = Math.min(Math.max(responseMs, 0), windowMs);
  const ratio = 1 - t / Math.max(windowMs, 1);
  return base + Math.round(ratio * speed);
}

export const DEFAULT_LETTER_RULES: LetterRules = { unique: 10, duplicate: 5, wrong: 0, empty: 0 };
