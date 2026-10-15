export type AlhalbaPhase = "lobby" | "bid" | "prove" | "result" | "over";

export interface AlhalbaTopic {
  id: string;
  text: string;
  category?: string | null;
  minAnswers: number;
  timeLimitSec: number;
  difficulty?: number | null;
}

export interface AlhalbaPlayerScore {
  playerId: string;
  name: string;
  score: number;
  lives: number;
}

export interface AlhalbaRoundState {
  phase: AlhalbaPhase;
  round: number;
  maxRounds: number;
  topic: AlhalbaTopic | null;
  bidderId: string | null;
  bidderName: string | null;
  contenderId: string | null;
  contenderName: string | null;
  answerCount: number;
  answers: string[];
  scores: AlhalbaPlayerScore[];
  startedAt: string | null;
  endsAt: string | null;
}

export interface AlhalbaGameState {
  id: string;
  roomId: string;
  mode: "solo" | "duel" | "team";
  phase: AlhalbaPhase;
  currentRound: AlhalbaRoundState;
}

export const emptyAlhalbaRound = (): AlhalbaRoundState => ({
  phase: "lobby",
  round: 0,
  maxRounds: 7,
  topic: null,
  bidderId: null,
  bidderName: null,
  contenderId: null,
  contenderName: null,
  answerCount: 0,
  answers: [],
  scores: [],
  startedAt: null,
  endsAt: null,
});

export function normalizeAlhalbaAnswer(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/\bال/g, "")
    .replace(/\s+/g, "");
}

export function toAlhalbaTopic(topic: Partial<AlhalbaTopic>): AlhalbaTopic {
  return {
    id: topic.id ?? crypto.randomUUID(),
    text: topic.text ?? "موضوع افتراضي",
    category: topic.category ?? "عام",
    minAnswers: topic.minAnswers ?? 3,
    timeLimitSec: topic.timeLimitSec ?? 30,
    difficulty: topic.difficulty ?? 2,
  };
}
