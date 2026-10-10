import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanName, clamp, hex, iso, jparse, num, rid, ROOM_CODE_ALPHABET, stamp, tokensMatch } from "./util.ts";

describe("jparse", () => {
  it("returns the fallback for null and undefined", () => {
    assert.equal(jparse(null, 5), 5);
    assert.equal(jparse(undefined, "x"), "x");
  });
  it("parses valid JSON strings", () => {
    assert.deepEqual(jparse<{ a: number }>('{"a":1}', { a: 0 }), { a: 1 });
  });
  it("returns the fallback for invalid JSON", () => {
    assert.deepEqual(jparse("{oops", []), []);
  });
  it("passes through values that are already parsed", () => {
    const obj = { a: 1 };
    assert.equal(jparse(obj, {}), obj);
  });
});

describe("num and clamp", () => {
  it("num coerces numbers and numeric strings, otherwise falls back", () => {
    assert.equal(num(4), 4);
    assert.equal(num("7"), 7);
    assert.equal(num("abc", 3), 3);
    assert.equal(num(Infinity, 9), 9);
    assert.equal(num(undefined), 0);
  });
  it("clamp rounds and keeps the value in range", () => {
    assert.equal(clamp(5.6, 1, 10, 0), 6);
    assert.equal(clamp(-4, 1, 10, 0), 1);
    assert.equal(clamp(99, 1, 10, 0), 10);
  });
  it("clamp uses the fallback for non-numeric input, then clamps it", () => {
    assert.equal(clamp("x", 1, 10, 4), 4);
    assert.equal(clamp(undefined, 5, 10, 2), 5);
  });
});

describe("iso and stamp", () => {
  it("normalises Date objects and date strings to ISO", () => {
    assert.equal(iso(new Date("2026-01-02T03:04:05Z")), "2026-01-02T03:04:05.000Z");
    assert.equal(iso("2026-01-02T03:04:05Z"), "2026-01-02T03:04:05.000Z");
  });
  it("returns null for empty or invalid input", () => {
    assert.equal(iso(null), null);
    assert.equal(iso(""), null);
    assert.equal(iso("not a date"), null);
  });
  it("stamp returns epoch milliseconds, or 0 when invalid", () => {
    assert.equal(stamp("2026-01-02T03:04:05Z"), Date.parse("2026-01-02T03:04:05Z"));
    assert.equal(stamp("nope"), 0);
  });
});

describe("id generators", () => {
  it("rid has the requested length and only unambiguous characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = rid(5);
      assert.equal(code.length, 5);
      for (const ch of code) assert.ok(ROOM_CODE_ALPHABET.includes(ch), `unexpected ${ch}`);
    }
    assert.ok(!/[IO01]/.test(ROOM_CODE_ALPHABET));
  });
  it("hex has twice as many characters as bytes", () => {
    assert.match(hex(16), /^[0-9a-f]{32}$/);
  });
  it("two generated values differ", () => {
    assert.notEqual(hex(16), hex(16));
  });
});

describe("tokensMatch", () => {
  it("accepts an identical token", () => {
    assert.equal(tokensMatch("abc123", "abc123"), true);
  });
  it("rejects a different token of the same length", () => {
    assert.equal(tokensMatch("abc123", "abc124"), false);
  });
  it("rejects missing or different-length tokens", () => {
    assert.equal(tokensMatch("abc123", undefined), false);
    assert.equal(tokensMatch("abc123", ""), false);
    assert.equal(tokensMatch("abc123", "abc12"), false);
  });
});

describe("cleanName", () => {
  it("trims, strips angle brackets and collapses spaces", () => {
    assert.equal(cleanName("  Ali   Ahmed "), "Ali Ahmed");
    assert.equal(cleanName("<b>Sara</b>"), "bSara/b");
  });
  it("accepts Arabic names", () => {
    assert.equal(cleanName("محمد"), "محمد");
  });
  it("rejects names that are too short or too long", () => {
    assert.equal(cleanName("a"), null);
    assert.equal(cleanName("x".repeat(17)), null);
    assert.equal(cleanName("x".repeat(16)), "x".repeat(16));
  });
  it("rejects links", () => {
    assert.equal(cleanName("visit http://x.co"), null);
    assert.equal(cleanName("www.spam.com"), null);
  });
});
