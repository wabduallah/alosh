import { MafiaGameState, MafiaPlayer, MafiaRole } from "./model";

/** Helper to shuffle array */
function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Assign roles given counts in settings or defaults */
export function assignRoles(
  state: MafiaGameState,
  settings?: { mafiaCount?: number; includeDoctor?: boolean; includeDetective?: boolean },
): MafiaGameState {
  const n = state.players.length;
  const mafiaCount = settings?.mafiaCount ?? Math.max(1, Math.floor(n / 4));
  const roles: MafiaRole[] = [];

  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  if (settings?.includeDoctor ?? true) roles.push("doctor");
  if (settings?.includeDetective ?? true) roles.push("detective");
  while (roles.length < n) roles.push("villager");
  shuffle(roles);

  const players: MafiaPlayer[] = state.players.map((p, idx) => ({ ...p, role: roles[idx], alive: true }));
  return { ...state, players, updatedAt: new Date().toISOString() };
}

export function startNight(state: MafiaGameState): MafiaGameState {
  return { ...state, phase: "night", round: state.round + 1, nightActions: {}, votes: {}, updatedAt: new Date().toISOString() };
}

export function recordNightAction(
  state: MafiaGameState,
  action: { type: "mafiaTarget" | "doctorSave" | "detectiveCheck"; playerId: string },
): MafiaGameState {
  const na = { ...state.nightActions };
  if (action.type === "mafiaTarget") na.mafiaTarget = action.playerId;
  if (action.type === "doctorSave") na.doctorSave = action.playerId;
  if (action.type === "detectiveCheck") na.detectiveCheck = action.playerId;
  return { ...state, nightActions: na, updatedAt: new Date().toISOString() };
}

export function resolveNight(state: MafiaGameState): MafiaGameState {
  const { mafiaTarget, doctorSave, detectiveCheck } = state.nightActions;
  let players = state.players.map((p) => ({ ...p }));
  // If mafia targeted someone and doctor didn't save them -> they die
  if (mafiaTarget && mafiaTarget !== doctorSave) {
    players = players.map((p) => (p.playerId === mafiaTarget ? { ...p, alive: false } : p));
  }
  // detective result
  let detectiveResult = null;
  if (detectiveCheck) {
    const found = players.find((p) => p.playerId === detectiveCheck);
    detectiveResult = found ? { targetId: detectiveCheck, role: found.role! } : null;
  }
  return {
    ...state,
    players,
    nightActions: { ...state.nightActions, detectiveResult },
    phase: "day",
    updatedAt: new Date().toISOString(),
  };
}

export function castLynchVote(state: MafiaGameState, voterId: string, targetId: string): MafiaGameState {
  if (!state.players.some((p) => p.playerId === voterId && p.alive)) return state;
  const votes = { ...state.votes, [voterId]: targetId };
  return { ...state, votes, updatedAt: new Date().toISOString() };
}

export function resolveLynch(state: MafiaGameState): MafiaGameState {
  // count votes
  const counts: Record<string, number> = {};
  for (const t of Object.values(state.votes)) counts[t] = (counts[t] ?? 0) + 1;
  let max = 0;
  let selected: string | null = null;
  for (const [id, c] of Object.entries(counts)) if (c > max) { max = c; selected = id; }
  let players = state.players.map((p) => ({ ...p }));
  if (selected) players = players.map((p) => (p.playerId === selected ? { ...p, alive: false } : p));
  const nextState = { ...state, players, votes: {}, phase: "night", updatedAt: new Date().toISOString() };
  return checkVictory(nextState);
}

/** Check win conditions: mafia eliminated -> villagers win; mafia >= others -> mafia win */
export function checkVictory(state: MafiaGameState): MafiaGameState {
  const alive = state.players.filter((p) => p.alive);
  const mafiaAlive = alive.filter((p) => p.role === "mafia").length;
  const others = alive.length - mafiaAlive;
  if (mafiaAlive === 0) return { ...state, phase: "finished", winner: "villagers", updatedAt: new Date().toISOString() };
  if (mafiaAlive >= others) return { ...state, phase: "finished", winner: "mafia", updatedAt: new Date().toISOString() };
  return state;
}
