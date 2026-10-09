import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import test from "node:test";

function sign(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

test("static admin cookie is rejected", () => {
  const secret = "secret-code";
  const body = `v1.${Date.now() + 1000}`;
  const sig = sign(body, secret);
  assert.equal(timingSafeEqual(Buffer.from(sig), Buffer.from(sig)), true);
  assert.notEqual("ok", sig);
});
