import {
  AlhalbaGameState,
  AlhalbaRoundState,
  AlhalbaTopic,
  emptyAlhalbaRound,
  normalizeAlhalbaAnswer,
  toAlhalbaTopic,
} from "./model";

export function createAlhalbaGame(roomId: string, mode: AlhalbaGameState["mode"] = "duel"): AlhalbaGameState {
  return {
    id: crypto.randomUUID(),
    roomId,
    mode,
    phase: "lobby",
    currentRound: emptyAlhalbaRound(),
  };
}

export function startAlhalbaRound(
  game: AlhalbaGameState,
  topicInput: Partial<AlhalbaTopic>,
  bidderId: string | null,
  bidderName: string | null,
  contenderId: string | null = null,
  contenderName: string | null = null,
): AlhalbaGameState {
  const nextRound: AlhalbaRoundState = {
    ...emptyAlhalbaRound(),
    phase: "bid",
    round: game.currentRound.round + 1,
    maxRounds: game.currentRound.maxRounds,
    topic: toAlhalbaTopic(topicInput),
    bidderId,
    bidderName,
    contenderId,
    contenderName,
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 30_000).toISOString(),
  };

  return {
    ...game,
    phase: "bid",
    currentRound: nextRound,
  };
}

export function submitAlhalbaAnswer(game: AlhalbaGameState, answer: string): AlhalbaGameState {
  const normalized = normalizeAlhalbaAnswer(answer);
  if (!normalized) {
    return game;
  }

  const existing = game.currentRound.answers.find((entry) => normalizeAlhalbaAnswer(entry) === normalized);
  if (existing) {
    return game;
  }

  const nextAnswers = [...game.currentRound.answers, answer.trim()];

  return {
    ...game,
    currentRound: {
      ...game.currentRound,
      phase: "prove",
      answerCount: nextAnswers.length,
      answers: nextAnswers,
    },
  };
}

export function finishAlhalbaRound(game: AlhalbaGameState): AlhalbaGameState {
  return {
    ...game,
    phase: "result",
    currentRound: {
      ...game.currentRound,
      phase: "result",
      endsAt: new Date().toISOString(),
    },
  };
}

export function advanceAlhalbaRound(game: AlhalbaGameState): AlhalbaGameState {
  const nextRound = game.currentRound.round + 1;
  if (nextRound > game.currentRound.maxRounds) {
    return {
      ...game,
      phase: "over",
      currentRound: {
        ...game.currentRound,
        phase: "over",
      },
    };
  }

  return {
    ...game,
    phase: "lobby",
    currentRound: {
      ...emptyAlhalbaRound(),
      round: nextRound,
      maxRounds: game.currentRound.maxRounds,
    },
  };
}
