import assert from "node:assert/strict";
import test from "node:test";

import authMeHandler from "../api/auth/me.js";
import { createSessionCookie } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "auth-me-test-secret-with-enough-entropy";
process.env.MARKETPLACE_STORAGE_DISABLED = "1";
delete process.env.STEAM_API_KEY;

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(body = "") {
      this.body = body;
    },
    headers,
    body: "",
  };
}

test("auth status refreshes an old Steam User session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`
    <profile>
      <steamID><![CDATA[Actual Steam Name]]></steamID>
      <avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/actual_full.jpg]]></avatarFull>
    </profile>`, { status: 200, headers: { "Content-Type": "application/xml" } });

  const cookie = createSessionCookie({
    steamid: "76561198000000003",
    name: "Steam User",
    avatar: "",
    issuedAt: Date.now(),
  }).split(";")[0];
  const req = { method: "GET", url: "/api/auth/me", headers: { cookie } };
  const res = responseRecorder();

  try {
    await authMeHandler(req, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.loggedIn, true);
    assert.equal(body.name, "Actual Steam Name");
    assert.equal(body.avatar, "https://avatars.fastly.steamstatic.com/actual_full.jpg");
    assert.match(res.headers.get("set-cookie"), /^session=/);
    assert.match(res.headers.get("set-cookie"), /Max-Age=15552000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
