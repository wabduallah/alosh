import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOutcome, champion, decide, pairKey, pickMiniGame, planRound, ranking, type DuelPlayer, type MetCounts } from "./nest-duel.ts";

const mk = (n: number): DuelPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `لاعب ${i}`, points: 0, wins: 0, draws: 0, losses: 0, rests: 0 }));

test("decide: fouls, missing results, better values", () => {
  assert.equal(decide("reflex", { foul: true }, undefined), "b");
  assert.equal(decide("reflex", { value: 300 }, { foul: true }), "a");
  assert.equal(decide("reflex", { foul: true }, { foul: true }), "draw");
  assert.equal(decide("reflex", { value: 250 }, { value: 300 }), "a");
  assert.equal(decide("taps", { value: 25 }, { value: 30 }), "b");
  assert.equal(decide("taps", { value: 30 }, { value: 30 }), "draw");
  assert.equal(decide("memory", undefined, { value: 2100 }), "b");
  assert.equal(decide("memory", undefined, undefined), "draw");
  assert.equal(decide("precision", { value: 0.01 }, { value: 0.2 }), "a");
});

test("points: win 1, draw ½, loss 0, and the champion", () => {
  let ps = mk(3);
  ps = applyOutcome(ps, "p0", "p1", "a");
  ps = applyOutcome(ps, "p1", "p2", "draw");
  assert.deepEqual(ps.map((p) => p.points), [1, 0.5, 0.5]);
  assert.equal(ranking(ps)[0].id, "p0");
  assert.equal(champion(ps, 1)?.id, "p0");
  assert.equal(champion(ps, 2), null);
});

test("a round pairs everyone; odd counts rest one player, never twice in a row", () => {
  for (const n of [2, 3, 4, 5, 7, 13, 14]) {
    const ps = mk(n);
    const met: MetCounts = {};
    let lastRest: string | null = null;
    for (let r = 0; r < 30; r++) {
      const { pairs, rest } = planRound(ps, met, lastRest);
      const seen = pairs.flat();
      assert.equal(new Set(seen).size, seen.length, "no one plays twice in a round");
      assert.equal(seen.length + (rest ? 1 : 0), n, "everyone plays or rests");
      assert.equal(!!rest, n % 2 === 1);
      if (rest) {
        assert.notEqual(rest, lastRest, `n=${n}: same rest twice`);
        ps.find((p) => p.id === rest)!.rests++;
      }
      lastRest = rest;
      for (const [x, y] of pairs) met[pairKey(x, y)] = (met[pairKey(x, y)] ?? 0) + 1;
    }
    if (n % 2) {
      const rests = ps.map((p) => p.rests);
      assert.ok(Math.max(...rests) - Math.min(...rests) <= 1, `n=${n}: rests are shared ${rests}`);
    }
  }
});

test("pairs spread out: in 4 players, 3 rounds meet all 3 opponents", () => {
  const ps = mk(4);
  const met: MetCounts = {};
  for (let r = 0; r < 3; r++) {
    for (const [x, y] of planRound(ps, met, null).pairs) met[pairKey(x, y)] = (met[pairKey(x, y)] ?? 0) + 1;
  }
  assert.equal(Object.keys(met).length, 6);
  assert.ok(Object.values(met).every((v) => v === 1));
});

test("the mini-game never repeats twice in a row", () => {
  let last = pickMiniGame(null);
  for (let i = 0; i < 200; i++) {
    const next = pickMiniGame(last);
    assert.notEqual(next, last);
    last = next;
  }
});
