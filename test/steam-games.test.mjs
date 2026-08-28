import assert from "node:assert/strict";
import test from "node:test";

import gamesHandler from "../api/steam/games.js";
import { parseSteamInventoryCatalog } from "../api/_lib/steam-inventory.js";
import { createSessionCookie } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "steam-games-test-secret-with-enough-entropy";

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

async function invoke({ url = "/api/steam/games", cookie = "" } = {}) {
  const req = { method: "GET", url, headers: { cookie } };
  const res = responseRecorder();
  await gamesHandler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test("Steam inventory catalog parser returns games, contexts, and counts", () => {
  const html = `<script>var g_rgAppContextData = {"753":{"appid":753,"name":"Steam","icon":"https:\/\/shared.fastly.steamstatic.com\/steam.jpg","asset_count":164,"rgContexts":{"6":{"asset_count":164,"id":"6","name":"Community","hide_context":false}}},"730":{"appid":730,"name":"Counter-Strike 2","icon":"https:\/\/shared.fastly.steamstatic.com\/cs2.jpg","asset_count":151,"rgContexts":{"2":{"asset_count":151,"id":"2","name":"Inventory","hide_context":false}}}};</script>`;
  const games = parseSteamInventoryCatalog(html);

  assert.equal(games.length, 2);
  assert.deepEqual(games[0], {
    appid: "730",
    name: "Counter-Strike 2",
    icon: "https://shared.fastly.steamstatic.com/cs2.jpg",
    count: 151,
    contextid: "2",
    contextName: "Inventory",
  });
  assert.equal(games[1].appid, "753");
  assert.equal(games[1].count, 164);
});

test("Steam game catalog API is bound to the signed session", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    requestedUrl = new URL(url);
    return new Response(
      '<script>var g_rgAppContextData = {"730":{"appid":730,"name":"Counter-Strike 2","asset_count":7,"rgContexts":{"2":{"asset_count":7,"id":"2","name":"Inventory","hide_context":false}}}};</script>',
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  };

  try {
    const anonymous = await invoke();
    assert.equal(anonymous.status, 401);
    assert.equal(fetchCalls, 0);

    const steamid = "76561198000000001";
    const cookie = createSessionCookie({
      steamid,
      name: "Signed In User",
      avatar: "",
      issuedAt: Date.now(),
    }).split(";")[0];

    const switched = await invoke({ url: "/api/steam/games?steamid=76561198000000099", cookie });
    assert.equal(switched.status, 400);
    assert.equal(fetchCalls, 0);

    const authenticated = await invoke({ cookie });
    assert.equal(authenticated.status, 200);
    assert.equal(fetchCalls, 1);
    assert.equal(requestedUrl.pathname, `/profiles/${steamid}/inventory/`);
    assert.equal(authenticated.body.games[0].count, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
