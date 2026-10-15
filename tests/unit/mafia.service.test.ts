import { emptyMafiaGame } from "../../src/games/mafia/model";
import { assignRoles, startNight, recordNightAction, resolveNight, checkVictory } from "../../src/games/mafia/service";

test("mafia basic lifecycle", () => {
  const room = "room1";
  const host = "host1";
  let g = emptyMafiaGame(room, host);
  // seed players
  g = { ...g, players: [
    { id: "p1", playerId: "alice", name: "Alice", alive: true },
    { id: "p2", playerId: "bob", name: "Bob", alive: true },
    { id: "p3", playerId: "charlie", name: "Charlie", alive: true },
    { id: "p4", playerId: "dave", name: "Dave", alive: true },
  ]};
  g = assignRoles(g);
  g = startNight(g);
  g = recordNightAction(g, { type: "mafiaTarget", playerId: "bob" });
  g = recordNightAction(g, { type: "doctorSave", playerId: "alice" });
  g = resolveNight(g);
  expect(g.phase).toBe("day");
});
