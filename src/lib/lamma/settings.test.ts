import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asSettings } from "./settings.ts";

describe("asSettings", () => {
  it("returns playable defaults for empty or malformed input", () => {
    for (const input of [null, undefined, "", "{oops", {}, []]) {
      const s = asSettings(input);
      assert.equal(s.rounds, 6);
      assert.equal(s.seconds, 30);
      assert.equal(s.difficulty, "mixed");
      assert.equal(s.maxPlayers, 2);
      assert.equal(s.locale, "ar");
      assert.equal(s.hostIsPlayer, true);
      assert.equal(s.hostMode, "player");
      assert.equal(s.sound, true);
      assert.equal(s.music, false);
    }
  });

  it("clamps numeric settings into their allowed ranges", () => {
    const s = asSettings({ rounds: 99, seconds: 1, maxPlayers: 50, pointsPerCorrect: -5, targetScore: 10_000_000 });
    assert.equal(s.rounds, 15);
    assert.equal(s.seconds, 8);
    assert.equal(s.maxPlayers, 14);
    assert.equal(s.pointsPerCorrect, 0);
    assert.equal(s.targetScore, 100000);
  });

  it("accepts settings stored as a JSON string", () => {
    const s = asSettings('{"rounds":4,"seconds":45,"locale":"en","difficulty":"hard"}');
    assert.equal(s.rounds, 4);
    assert.equal(s.seconds, 45);
    assert.equal(s.locale, "en");
    assert.equal(s.difficulty, "hard");
  });

  it("falls back for an unknown difficulty, preferring the supplied fallback", () => {
    assert.equal(asSettings({ difficulty: "extreme" }).difficulty, "mixed");
    assert.equal(asSettings({ difficulty: "extreme" }, { difficulty: "easy" }).difficulty, "easy");
  });

  it("uses fallback numbers only when the stored value is missing", () => {
    const s = asSettings({}, { rounds: 8, seconds: 20, maxPlayers: 6 });
    assert.equal(s.rounds, 8);
    assert.equal(s.seconds, 20);
    assert.equal(s.maxPlayers, 6);
    assert.equal(asSettings({ rounds: 3 }, { rounds: 8 }).rounds, 3);
  });

  it("derives hostIsPlayer from the legacy hostMode when the boolean is absent", () => {
    assert.equal(asSettings({ hostMode: "narrator" }).hostIsPlayer, false);
    assert.equal(asSettings({ hostMode: "narrator" }).hostMode, "narrator");
    assert.equal(asSettings({ hostMode: "player" }).hostIsPlayer, true);
  });

  it("lets an explicit hostIsPlayer win over hostMode", () => {
    const s = asSettings({ hostIsPlayer: true, hostMode: "narrator" });
    assert.equal(s.hostIsPlayer, true);
    assert.equal(s.hostMode, "player");
  });

  it("treats feature flags as off unless strictly true", () => {
    const off = asSettings({ streakMultiplier: "yes", eliminationMode: 1, reactionBonus: "true", majorityMode: null });
    assert.equal(off.streakMultiplier, false);
    assert.equal(off.eliminationMode, false);
    assert.equal(off.reactionBonus, false);
    assert.equal(off.majorityMode, false);
    const on = asSettings({ streakMultiplier: true, eliminationMode: true, reactionBonus: true, majorityMode: true, music: true });
    assert.equal(on.streakMultiplier && on.eliminationMode && on.reactionBonus && on.majorityMode && on.music, true);
  });

  it("keeps sound on unless explicitly false", () => {
    assert.equal(asSettings({ sound: false }).sound, false);
    assert.equal(asSettings({ sound: 0 }).sound, true);
  });

  it("truncates the category to 40 characters and ignores non-strings", () => {
    assert.equal(asSettings({ category: "x".repeat(60) }).category.length, 40);
    assert.equal(asSettings({ category: 5 }).category, "");
  });
});
