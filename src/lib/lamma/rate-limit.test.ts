import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rate-limit.ts";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("createRateLimiter", () => {
  it("allows up to max hits in a window, then blocks", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    assert.equal(limiter.allow("k", 3, 1000), true);
    assert.equal(limiter.allow("k", 3, 1000), true);
    assert.equal(limiter.allow("k", 3, 1000), true);
    assert.equal(limiter.allow("k", 3, 1000), false);
    assert.equal(limiter.allow("k", 3, 1000), false);
  });

  it("starts a new window once the old one has passed", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    limiter.allow("k", 1, 1000);
    assert.equal(limiter.allow("k", 1, 1000), false);
    c.advance(1001);
    assert.equal(limiter.allow("k", 1, 1000), true);
  });

  it("keeps keys independent", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    limiter.allow("a", 1, 1000);
    assert.equal(limiter.allow("a", 1, 1000), false);
    assert.equal(limiter.allow("b", 1, 1000), true);
  });

  it("does not prune below the soft limit", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now, softLimit: 100 });
    for (let i = 0; i < 50; i += 1) limiter.allow(`k${i}`, 1, 10);
    c.advance(60_000);
    limiter.allow("fresh", 1, 10);
    assert.equal(limiter.size(), 51);
  });

  it("drops expired keys once the soft limit is reached, and keeps live ones", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now, softLimit: 10, pruneEveryMs: 1000 });
    for (let i = 0; i < 10; i += 1) limiter.allow(`old${i}`, 1, 100);
    limiter.allow("long", 1, 1_000_000);
    c.advance(5000);
    limiter.allow("trigger", 1, 100);
    // The 10 short-window keys expired and were pruned; "long" is still live; "trigger" is new.
    assert.equal(limiter.size(), 2);
    assert.equal(limiter.allow("long", 1, 1_000_000), false);
  });

  it("prunes at most once per interval", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now, softLimit: 5, pruneEveryMs: 10_000 });
    // The 6th insert crosses the soft limit and runs a prune (nothing has expired yet).
    for (let i = 0; i < 6; i += 1) limiter.allow(`a${i}`, 1, 10);
    assert.equal(limiter.size(), 6);
    // Their windows are over, but a prune ran moments ago, so nothing is removed yet.
    c.advance(1000);
    limiter.allow("b", 1, 10);
    assert.equal(limiter.size(), 7);
    // Once the interval has passed, the next call prunes every expired key.
    c.advance(10_000);
    limiter.allow("c", 1, 10);
    assert.equal(limiter.size(), 1);
  });
});
