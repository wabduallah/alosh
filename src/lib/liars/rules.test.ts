import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptsAnswer,
  boardComplete,
  cellKey,
  LATE_GRACE_MS,
  nextPicker,
  parseCategorySelection,
  parseCellKey,
  parseSettings,
  pickHidden,
  pointsForLevel,
  rankPlayers,
  scoreAnswer,
  shouldClose,
  totalCells,
} from "./rules.ts";

describe("points and cells", () => {
  it("maps levels 1..9 to the ladder and rejects others", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(pointsForLevel), [100, 200, 300, 400, 500, 600, 700, 800, 1000]);
    for (const bad of [0, 10, 1.5, -1, Number.NaN]) assert.equal(pointsForLevel(bad), null);
  });
  it("round-trips cell keys, including ids that contain a colon", () => {
    assert.equal(cellKey("science", 4), "science:4");
    assert.deepEqual(parseCellKey("science:4"), { categoryId: "science", level: 4 });
    assert.deepEqual(parseCellKey("a:b:9"), { categoryId: "a:b", level: 9 });
  });
  it("rejects malformed cell keys", () => {
    for (const bad of ["", "science", ":3", "science:0", "science:10", "science:x"]) assert.equal(parseCellKey(bad), null, bad);
  });
  it("counts board cells and completion", () => {
    assert.equal(totalCells(6), 54);
    assert.equal(boardComplete(6, 53), false);
    assert.equal(boardComplete(6, 54), true);
    assert.equal(boardComplete(1, 9), true);
  });
});

describe("parseSettings", () => {
  it("returns defaults for missing or junk input", () => {
    for (const raw of [null, undefined, "x", [], {}]) {
      assert.deepEqual(parseSettings(raw), { timerSeconds: 30, fiftyFifty: true, penalty: false, speedBonus: true, maxPlayers: 14 });
    }
  });
  it("accepts only the offered timer values, including 0 for off", () => {
    assert.equal(parseSettings({ timerSeconds: 0 }).timerSeconds, 0);
    assert.equal(parseSettings({ timerSeconds: 45 }).timerSeconds, 45);
    assert.equal(parseSettings({ timerSeconds: 7 }).timerSeconds, 30);
    assert.equal(parseSettings({ timerSeconds: "20" }).timerSeconds, 20);
  });
  it("keeps booleans only when they are real booleans", () => {
    const s = parseSettings({ fiftyFifty: false, penalty: true, speedBonus: "no" });
    assert.equal(s.fiftyFifty, false);
    assert.equal(s.penalty, true);
    assert.equal(s.speedBonus, true);
  });
  it("clamps max players to 1..14", () => {
    assert.equal(parseSettings({ maxPlayers: 99 }).maxPlayers, 14);
    assert.equal(parseSettings({ maxPlayers: 0 }).maxPlayers, 1);
    assert.equal(parseSettings({ maxPlayers: 6.4 }).maxPlayers, 6);
  });
});

describe("parseCategorySelection", () => {
  const known = new Set(["a", "b", "c", "d", "e", "f", "g", "h"]);
  it("keeps order, drops unknown ids and duplicates", () => {
    assert.deepEqual(parseCategorySelection(["c", "x", "a", "c", 5, "b"], known), ["c", "a", "b"]);
  });
  it("caps the selection at six", () => {
    assert.deepEqual(parseCategorySelection(["a", "b", "c", "d", "e", "f", "g", "h"], known), ["a", "b", "c", "d", "e", "f"]);
  });
  it("returns an empty list for non-arrays", () => {
    assert.deepEqual(parseCategorySelection("a,b", known), []);
  });
});

describe("scoreAnswer", () => {
  const base = { points: 400, timerSeconds: 20 };
  it("gives the cell points for a correct answer without bonus", () => {
    assert.equal(scoreAnswer({ ...base, correct: true, responseMs: 5000, settings: { penalty: false, speedBonus: false } }), 400);
  });
  it("adds up to 50% for an instant correct answer and nothing at the deadline", () => {
    const s = { penalty: false, speedBonus: true };
    assert.equal(scoreAnswer({ ...base, correct: true, responseMs: 0, settings: s }), 600);
    assert.equal(scoreAnswer({ ...base, correct: true, responseMs: 10_000, settings: s }), 500);
    assert.equal(scoreAnswer({ ...base, correct: true, responseMs: 20_000, settings: s }), 400);
    assert.equal(scoreAnswer({ ...base, correct: true, responseMs: 99_000, settings: s }), 400);
    assert.equal(scoreAnswer({ ...base, correct: true, responseMs: -50, settings: s }), 600);
  });
  it("uses a 30 second reference window when the timer is off", () => {
    assert.equal(scoreAnswer({ points: 1000, timerSeconds: 0, correct: true, responseMs: 15_000, settings: { penalty: false, speedBonus: true } }), 1250);
  });
  it("costs half the points for a wrong answer only with the penalty", () => {
    assert.equal(scoreAnswer({ ...base, correct: false, responseMs: 0, settings: { penalty: true, speedBonus: true } }), -200);
    assert.equal(scoreAnswer({ ...base, correct: false, responseMs: 0, settings: { penalty: false, speedBonus: true } }), 0);
  });
});

describe("nextPicker", () => {
  const players = [
    { id: "p3", seat: 3 },
    { id: "p1", seat: 1 },
    { id: "p2", seat: 2 },
  ];
  it("starts with the lowest seat", () => {
    assert.equal(nextPicker(players, null), "p1");
  });
  it("moves to the next seat and wraps around", () => {
    assert.equal(nextPicker(players, "p1"), "p2");
    assert.equal(nextPicker(players, "p3"), "p1");
  });
  it("falls back to the first seat when the current picker left", () => {
    assert.equal(nextPicker(players, "gone"), "p1");
  });
  it("returns null with no players", () => {
    assert.equal(nextPicker([], "p1"), null);
  });
});

describe("closing and late answers", () => {
  it("closes after the deadline plus grace", () => {
    assert.equal(shouldClose({ now: 1000 + LATE_GRACE_MS - 1, endsAt: 1000, answered: 0, connected: 3 }), false);
    assert.equal(shouldClose({ now: 1000 + LATE_GRACE_MS, endsAt: 1000, answered: 0, connected: 3 }), true);
  });
  it("closes early when every connected player answered", () => {
    assert.equal(shouldClose({ now: 0, endsAt: 99_999, answered: 3, connected: 3 }), true);
    assert.equal(shouldClose({ now: 0, endsAt: null, answered: 2, connected: 3 }), false);
  });
  it("never closes an untimed question with nobody connected", () => {
    assert.equal(shouldClose({ now: 0, endsAt: null, answered: 0, connected: 0 }), false);
  });
  it("accepts answers until the deadline plus grace, always when untimed", () => {
    assert.equal(acceptsAnswer(1000 + LATE_GRACE_MS, 1000), true);
    assert.equal(acceptsAnswer(1001 + LATE_GRACE_MS, 1000), false);
    assert.equal(acceptsAnswer(10 ** 12, null), true);
  });
});

describe("pickHidden", () => {
  it("hides two wrong options of four and never the correct one", () => {
    for (let correct = 0; correct < 4; correct += 1) {
      for (let seed = 0; seed < 20; seed += 1) {
        let x = seed / 20;
        const hidden = pickHidden(4, correct, () => (x = (x * 9301 + 0.4927) % 1));
        assert.equal(hidden.length, 2);
        assert.ok(!hidden.includes(correct));
        assert.equal(new Set(hidden).size, 2);
        for (const h of hidden) assert.ok(h >= 0 && h < 4);
      }
    }
  });
  it("always leaves at least one wrong option", () => {
    assert.equal(pickHidden(3, 0, Math.random).length, 1);
    assert.equal(pickHidden(2, 1, Math.random).length, 0);
  });
});

describe("rankPlayers", () => {
  it("orders by score, then fewer wrong answers, then seat", () => {
    const ranked = rankPlayers([
      { id: "a", score: 500, wrong: 2, seat: 1 },
      { id: "b", score: 900, wrong: 0, seat: 2 },
      { id: "c", score: 500, wrong: 1, seat: 3 },
      { id: "d", score: 500, wrong: 1, seat: 0 },
    ]);
    assert.deepEqual(ranked.map((p) => p.id), ["b", "d", "c", "a"]);
  });
});
