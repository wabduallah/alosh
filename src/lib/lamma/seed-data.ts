import { CATALOG } from "./catalog";
import type { Engine } from "./types";

export type SeedChoice = { id: string; ar: string; en: string; points?: number };
export type SeedQuestion = {
  promptAr: string;
  promptEn: string;
  kind: "mcq" | "text" | "feud" | "truth" | "choice" | "vote";
  choices?: SeedChoice[];
  correct?: string;
  accepted?: string[];
  difficulty?: "easy" | "medium" | "hard";
  icons?: string[];
  points?: number;
};

export type SeedGame = {
  id: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  category: string;
  tier: "free" | "premium";
  engine: Engine;
  minPlayers: number;
  maxPlayers: number;
  seconds: number;
  rounds: number;
  scoring: Record<string, number>;
  sort: number;
  icon: string;
  questions: SeedQuestion[];
};

const ids = ["a", "b", "c", "d"] as const;

function mcq(
  promptAr: string,
  promptEn: string,
  options: [string, string][],
  correct: number,
  difficulty: SeedQuestion["difficulty"] = "easy",
): SeedQuestion {
  return {
    promptAr,
    promptEn,
    kind: "mcq",
    difficulty,
    correct: ids[correct],
    choices: options.map(([ar, en], i) => ({ id: ids[i]!, ar, en })),
  };
}

function tf(promptAr: string, promptEn: string, yes: boolean, difficulty: SeedQuestion["difficulty"] = "easy"): SeedQuestion {
  return mcq(promptAr, promptEn, [
    ["صح", "True"],
    ["خطأ", "False"],
  ], yes ? 0 : 1, difficulty);
}

export const SEED_CATEGORIES = CATALOG.map((cat) => ({
  id: cat.id,
  ar: cat.ar,
  en: cat.en,
  sort: cat.sort,
}));


/** Intentionally empty. The game list is being rebuilt; add new SeedGame entries here. */
export const SEED_GAMES: SeedGame[] = [];

export const SEED_PLANS = [
  {
    id: "free",
    nameAr: "مجاني",
    nameEn: "Free",
    price: 0,
    interval: "free",
    featuresAr: ["ألعاب مختارة", "غرف محدودة يوميًا", "حتى 14 لاعبًا"],
    featuresEn: ["A selection of games", "A daily room limit", "Up to 14 players"],
    sort: 1,
  },
  {
    id: "monthly",
    nameAr: "بريميوم شهري",
    nameEn: "Premium monthly",
    price: 29,
    interval: "month",
    featuresAr: ["كل الألعاب", "غرف بلا حد يومي", "بدون مساحة إعلانية", "تخصيص الوقت والجولات"],
    featuresEn: ["Every game", "No daily room cap", "No house ad", "Custom timing and rounds"],
    sort: 2,
  },
  {
    id: "yearly",
    nameAr: "بريميوم سنوي",
    nameEn: "Premium yearly",
    price: 99,
    interval: "year",
    featuresAr: ["كل مزايا الشهري", "سعر السنة أوفر", "ألعاب تُضاف لاحقًا"],
    featuresEn: ["Everything in monthly", "A lower yearly price", "Games added later"],
    sort: 3,
  },
  {
    id: "lifetime",
    nameAr: "مدى الحياة",
    nameEn: "Lifetime",
    price: 199,
    interval: "lifetime",
    featuresAr: ["كل الألعاب", "دفعة واحدة", "غرف خاصة بلا انتهاء الاشتراك"],
    featuresEn: ["Every game", "One payment", "Private rooms without a renewal"],
    sort: 4,
  },
];

export const SEED_PROMOS = [
  { code: "LAMMA50", kind: "percent", amount: 50 },
  { code: "LAMMA30", kind: "days", amount: 30 },
  { code: "LAMMALIFE", kind: "lifetime", amount: 0 },
];
