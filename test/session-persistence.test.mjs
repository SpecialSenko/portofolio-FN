import assert from "node:assert/strict";
import test from "node:test";

import { createSessionCookie, readSession } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "session-persistence-test-secret-with-enough-entropy";

function account(issuedAt) {
  return {
    steamid: "76561198000000010",
    name: "Persistent User",
    avatar: "",
    issuedAt,
  };
}

test("site sessions persist independently for 180 days", () => {
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const persistentCookie = createSessionCookie(account(ninetyDaysAgo));
  assert.match(persistentCookie, /Max-Age=15552000/);
  assert.equal(readSession(persistentCookie)?.steamid, "76561198000000010");

  const expiredAt = Date.now() - 181 * 24 * 60 * 60 * 1000;
  const expiredCookie = createSessionCookie(account(expiredAt));
  assert.equal(readSession(expiredCookie), null);
});
