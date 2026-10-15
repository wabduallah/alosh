import React from "react";
import { MafiaGameState } from "./model";

export function MafiaBoard({ game, onOpenNight, onAction, onVote }: {
  game: MafiaGameState;
  onOpenNight?: () => void;
  onAction?: (type: string, playerId: string) => void;
  onVote?: (voterId: string, targetId: string) => void;
}) {
  return (
    <section className="p-4 border rounded">
      <h3>Mafia — Phase: {game.phase}</h3>
      <p>Round: {game.round}</p>
      <ul>
        {game.players.map(p => (
          <li key={p.playerId}>
            {p.name ?? p.playerId} — {p.alive ? "alive" : "dead"} {p.role ? `(${p.role})` : ""}
            {game.phase === "night" && onAction ? (
              <>
                <button onClick={() => onAction("mafiaTarget", p.playerId)}>Mafia→</button>
                <button onClick={() => onAction("doctorSave", p.playerId)}>Save</button>
                <button onClick={() => onAction("detectiveCheck", p.playerId)}>Check</button>
              </>
            ) : null}
            {game.phase === "day" && onVote ? (
              <button onClick={() => onVote("self", p.playerId)}>Vote {p.playerId}</button>
            ) : null}
          </li>
        ))}
      </ul>
      {onOpenNight && <button onClick={onOpenNight}>Start Night</button>}
    </section>
  );
}
