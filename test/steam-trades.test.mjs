import assert from "node:assert/strict";
import test from "node:test";

import tradesHandler from "../api/steam/trades.js";
import { createSessionCookie } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "steam-trades-test-secret-with-enough-entropy";

const ownerSteamId = "76561198000000001";
const partnerSteamId = "76561198000000002";

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

function sessionCookie(steamid = ownerSteamId) {
  return createSessionCookie({
    steamid,
    name: "Signed In User",
    avatar: "https://avatars.fastly.steamstatic.com/avatar.jpg",
    issuedAt: Date.now(),
  }).split(";")[0];
}

async function invoke({ url = "/api/steam/trades", cookie = "" } = {}) {
  const req = { method: "GET", url, headers: { cookie } };
  const res = responseRecorder();
  await tradesHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("Steam trade history is private, session-bound, and owner-only", async () => {
  const originalFetch = globalThis.fetch;
  const originalOwner = process.env.STEAM_TRADE_OWNER_ID;
  const originalApiKey = process.env.STEAM_API_KEY;
  let fetchCalls = 0;

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Steam should not be called");
  };

  try {
    const anonymous = await invoke();
    assert.equal(anonymous.status, 401);

    const switched = await invoke({
      url: `/api/steam/trades?steamid=${partnerSteamId}`,
      cookie: sessionCookie(),
    });
    assert.equal(switched.status, 400);

    delete process.env.STEAM_TRADE_OWNER_ID;
    const unconfigured = await invoke({ cookie: sessionCookie() });
    assert.equal(unconfigured.status, 503);
    assert.equal(unconfigured.body.code, "TRADE_HISTORY_NOT_CONFIGURED");

    process.env.STEAM_TRADE_OWNER_ID = ownerSteamId;
    const wrongOwner = await invoke({ cookie: sessionCookie(partnerSteamId) });
    assert.equal(wrongOwner.status, 403);
    assert.equal(wrongOwner.body.code, "TRADE_HISTORY_OWNER_ONLY");

    delete process.env.STEAM_API_KEY;
    const missingKey = await invoke({ cookie: sessionCookie() });
    assert.equal(missingKey.status, 503);
    assert.equal(missingKey.body.code, "STEAM_API_KEY_REQUIRED");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOwner === undefined) delete process.env.STEAM_TRADE_OWNER_ID;
    else process.env.STEAM_TRADE_OWNER_ID = originalOwner;
    if (originalApiKey === undefined) delete process.env.STEAM_API_KEY;
    else process.env.STEAM_API_KEY = originalApiKey;
  }
});

test("Steam trade history normalizes private owner trades and partner profiles", async () => {
  const originalFetch = globalThis.fetch;
  const originalOwner = process.env.STEAM_TRADE_OWNER_ID;
  const originalApiKey = process.env.STEAM_API_KEY;
  const requestedUrls = [];

  process.env.STEAM_TRADE_OWNER_ID = ownerSteamId;
  process.env.STEAM_API_KEY = "server-only-test-key";
  globalThis.fetch = async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);

    if (requestedUrl.pathname.includes("GetTradeHistory")) {
      return new Response(JSON.stringify({
        response: {
          total_trades: 1,
          more: false,
          trades: [{
            tradeid: "501",
            steamid_other: partnerSteamId,
            time_init: "1720000000",
            status: 3,
            assets_given: [{ appid: 730, assetid: "1001", classid: "10", instanceid: "0", amount: "1" }],
            assets_received: [{ appid: 730, assetid: "1002", classid: "20", instanceid: "0", amount: "1" }],
          }],
          descriptions: [
            { appid: 730, classid: "10", instanceid: "0", market_hash_name: "AK-47 | Test", icon_url: "ak-icon" },
            { appid: 730, classid: "20", instanceid: "0", market_hash_name: "M4A4 | Test", icon_url: "m4-icon" },
          ],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      response: {
        players: [{
          steamid: partnerSteamId,
          personaname: "Trade Partner",
          avatarfull: "https://avatars.fastly.steamstatic.com/partner.jpg",
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await invoke({ url: "/api/steam/trades?limit=25", cookie: sessionCookie() });

    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("vary"), "Cookie");
    assert.equal(result.body.private, true);
    assert.equal(result.body.owner, ownerSteamId);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.more, false);
    assert.equal(result.body.trades[0].partner.name, "Trade Partner");
    assert.equal(result.body.trades[0].sent[0].name, "AK-47 | Test");
    assert.equal(result.body.trades[0].received[0].name, "M4A4 | Test");

    const historyUrl = requestedUrls[0];
    assert.equal(historyUrl.searchParams.get("key"), "server-only-test-key");
    assert.equal(historyUrl.searchParams.get("max_trades"), "25");
    assert.equal(historyUrl.searchParams.get("get_descriptions"), "true");
    assert.equal(historyUrl.searchParams.has("input_json"), false);
    assert.equal(requestedUrls[1].searchParams.get("steamids"), partnerSteamId);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOwner === undefined) delete process.env.STEAM_TRADE_OWNER_ID;
    else process.env.STEAM_TRADE_OWNER_ID = originalOwner;
    if (originalApiKey === undefined) delete process.env.STEAM_API_KEY;
    else process.env.STEAM_API_KEY = originalApiKey;
  }
});
