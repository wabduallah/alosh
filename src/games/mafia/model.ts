export type MafiaPhase = "lobby" | "night" | "day" | "voting" | "finished";

export type MafiaRole = "mafia" | "doctor" | "detective" | "villager";

export interface MafiaPlayer {
  id: string; // local uuid for the mafia_player row
  playerId: string; // room_players.id
  name?: string;
  role?: MafiaRole | null;
  alive: boolean;
}

export interface MafiaGameState {
  id: string;
  roomId: string;
  hostId: string;
  phase: MafiaPhase;
  round: number;
  players: MafiaPlayer[];
  // transient per-night actions stored here:
  nightActions: {
    mafiaTarget?: string | null; // playerId target by mafia
    doctorSave?: string | null; // playerId saved by doctor
    detectiveCheck?: string | null; // playerId checked
    detectiveResult?: { targetId: string; role: MafiaRole } | null;
  };
  // votes mapping voterId -> targetId
  votes: Record<string, string>;
  winner: "mafia" | "villagers" | null;
  createdAt: string;
  updatedAt: string;
}

export const emptyMafiaGame = (roomId: string, hostId: string): MafiaGameState => ({
  id: crypto.randomUUID(),
  roomId,
  hostId,
  phase: "lobby",
  round: 0,
  players: [],
  nightActions: {},
  votes: {},
  winner: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
