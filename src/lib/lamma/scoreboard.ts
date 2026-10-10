/**
 * Final-table helpers, shared by the host and player screens. Pure and dependency-free.
 */

export type ScorecardPlayer = { id: string; name: string; score: number };

export type ScorecardRow = ScorecardPlayer & { place: number; gap: number };

/** Competition ranking: equal scores share a place; gap is measured from the leader. */
export function rankScorecard(players: ScorecardPlayer[]): ScorecardRow[] {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const leader = ranked[0]?.score ?? 0;
  let place = 0;
  let last = Number.POSITIVE_INFINITY;
  return ranked.map((player, index) => {
    if (player.score !== last) {
      place = index + 1;
      last = player.score;
    }
    return { ...player, place, gap: leader - player.score };
  });
}

/** Plain-text scorecard for copying into a chat app. Arabic labels, no markup. */
export function buildScorecardText(input: { roomCode: string; rows: ScorecardRow[]; top?: number }): string {
  const top = input.rows.slice(0, input.top ?? 10);
  const lines = top.map((row) => `${row.place}. ${row.name} — ${row.score}${row.gap === 0 ? " 👑" : ""}`);
  return ["🏆 نتيجة اللعبة", `غرفة ${input.roomCode}`, ...lines, "", "العش · al3sh.app"].join("\n");
}
