import type { LetterCell, LetterCat } from "@/games/score";

export type CheerKind = "spark" | "laugh" | "heart" | "flame";

export const CHEER_KINDS: CheerKind[] = ["spark", "laugh", "heart", "flame"];

export type Cheer = {
  id: string;
  name: string;
  kind: CheerKind;
  at: number;
};

export type RoomStatus = "WAITING" | "STARTING" | "PLAYING" | "SCORING" | "ROUND_END" | "FINISHED" | "CLOSED";

export type Engine =
  | "letter"
  | "quiz"
  | "truefalse"
  | "fastest"
  | "whoknows"
  | "vote"
  | "picture"
  | "text"
  | "feud"
  | "choice"
  | "truth";

export type PublicChoice = { id: string; ar: string; en: string };

export type PublicQuestion = {
  id: number;
  promptAr: string;
  promptEn: string;
  kind: string;
  choices: PublicChoice[];
  icons: string[];
};

export type LetterRevealRow = {
  playerId: string;
  name: string;
  fields: Record<LetterCat, LetterCell>;
  total: number;
};

export type Reveal = {
  correctId?: string;
  correctAr?: string;
  correctEn?: string;
  letterRows?: LetterRevealRow[];
  percents?: { id: string; ar: string; en: string; n: number }[];
  votes?: { playerId: string; name: string; count: number }[];
  truth?: { playerId: string; name: string; side: string; promptAr: string; promptEn: string }[];
  feudHits?: { playerId: string; name: string; text: string; points: number }[];
  answers?: { playerId: string; name: string; text: string; points: number; correct: boolean }[];
};

export type SnapPlayer = {
  id: string;
  name: string;
  score: number;
  roundScore: number;
  answered: boolean;
  isBot: boolean;
  correct: number;
  wrong: number;
};

export type Snapshot = {
  ok: true;
  revision: number;
  youAreHost: boolean;
  yourId: string | null;
  yourAnswered: boolean;
  yourRoundScore: number;
  cheers: Cheer[];
  room: {
    code: string;
    status: RoomStatus;
    gameId: string;
    nameAr: string;
    nameEn: string;
    engine: Engine;
    round: number;
    rounds: number;
    seconds: number;
    locale: "ar" | "en";
    sound: boolean;
    music: boolean;
    letter: string | null;
    endsAt: string | null;
    auto: boolean;
    question: PublicQuestion | null;
    reveal: Reveal | null;
    subjectId: string | null;
    minPlayers: number;
    maxPlayers: number;
    hostMode: "player" | "narrator";
    hostAnswer: string | null;
  };
  players: SnapPlayer[];
};

export type Fail = { ok: false; error: string };

export type GameCard = {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  category: string;
  tier: "free" | "premium";
  engine: Engine;
  minPlayers: number;
  maxPlayers: number;
  seconds: number;
  rounds: number;
  icon: string;
  visible: boolean;
  status: string;
  playMode: "competitive" | "coop" | "teams" | "social";
  durationMin: number;
  durationMax: number;
  rulesAr: string;
  rulesEn: string;
  howAr: string;
  howEn: string;
  plays: number;
  createdAt: string;
};

export type PlanCard = {
  id: string;
  nameAr: string;
  nameEn: string;
  priceSar: number;
  interval: string;
  featuresAr: string[];
  featuresEn: string[];
};
