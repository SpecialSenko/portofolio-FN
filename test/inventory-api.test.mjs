import assert from "node:assert/strict";
import test from "node:test";

import inventoryHandler from "../api/steam/inventory.js";
import { createSessionCookie } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "inventory-api-test-secret-with-enough-entropy";

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

async function invoke({ url = "/api/steam/inventory", cookie = "" } = {}) {
  const req = { method: "GET", url, headers: { cookie } };
  const res = responseRecorder();
  await inventoryHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("Steam inventory API is bound to the signed session", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  let fetchCalls = 0;

  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    requestedUrl = new URL(url);
    if (requestedUrl.pathname.includes("76561198000000002")) {
      return new Response("", { status: 403 });
    }
    return new Response(JSON.stringify({
      success: 1,
      total_inventory_count: 4,
      more_items: false,
      assets: [
        { assetid: "9001", classid: "100", instanceid: "0", amount: "1" },
        { assetid: "9002", classid: "101", instanceid: "0", amount: "1" },
        { assetid: "9003", classid: "102", instanceid: "0", amount: "1" },
        { assetid: "9004", classid: "103", instanceid: "0", amount: "1" },
      ],
      descriptions: [
        {
          classid: "100",
          instanceid: "0",
          market_hash_name: "StatTrak AK-47 | Test",
          type: "Rifle",
          icon_url: "test-icon",
          tradable: 1,
          marketable: 1,
          tags: [{ category: "Weapon", localized_tag_name: "Rifle" }],
        },
        {
          classid: "101",
          instanceid: "0",
          market_hash_name: "Sticker | Test",
          type: "High Grade Sticker",
          tradable: 1,
          marketable: 1,
          tags: [{ category: "Type", internal_name: "CSGO_Type_Sticker", localized_tag_name: "Sticker" }],
        },
        {
          classid: "102",
          instanceid: "0",
          market_hash_name: "Charm | Test",
          type: "Exotic Charm",
          tradable: 1,
          marketable: 1,
          tags: [{ category: "Type", internal_name: "CSGO_Tool_Keychain", localized_tag_name: "Charm" }],
        },
        {
          classid: "103",
          instanceid: "0",
          market_hash_name: "Test Weapon Case",
          type: "Base Grade Container",
          tradable: 1,
          marketable: 1,
          tags: [{ category: "Type", internal_name: "CSGO_Type_WeaponCase", localized_tag_name: "Container" }],
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const anonymous = await invoke();
    assert.equal(anonymous.status, 401);
    assert.equal(fetchCalls, 0);

    const steamid = "76561198000000001";
    const cookie = createSessionCookie({
      steamid,
      name: "Signed In User",
      avatar: "https://avatars.fastly.steamstatic.com/avatar.jpg",
      issuedAt: Date.now(),
    }).split(";")[0];

    const switched = await invoke({ url: "/api/steam/inventory?steamid=76561198000000099", cookie });
    assert.equal(switched.status, 400);
    assert.equal(fetchCalls, 0);

    const invalidGame = await invoke({ url: "/api/steam/inventory?appid=not-a-game", cookie });
    assert.equal(invalidGame.status, 400);
    assert.equal(fetchCalls, 0);

    const authenticated = await invoke({ url: "/api/steam/inventory?count=25", cookie });
    assert.equal(authenticated.status, 200);
    assert.equal(fetchCalls, 1);
    assert.equal(requestedUrl.pathname, `/inventory/${steamid}/730/2`);
    assert.equal(requestedUrl.searchParams.get("count"), "25");
    assert.equal(authenticated.body.items[0].id, "9001");
    assert.equal(authenticated.body.items[0].category, "rifles");
    assert.equal(authenticated.body.items[0].tier, "stattrak");
    assert.deepEqual(authenticated.body.items.map((item) => item.category), [
      "rifles",
      "stickers",
      "charms",
      "cases",
    ]);
    assert.equal(authenticated.headers.get("cache-control"), "no-store");

    const privateCookie = createSessionCookie({
      steamid: "76561198000000002",
      name: "Private User",
      avatar: "",
      issuedAt: Date.now(),
    }).split(";")[0];
    const privateInventory = await invoke({ cookie: privateCookie });
    assert.equal(privateInventory.status, 200);
    assert.equal(privateInventory.body.private, true);
    assert.deepEqual(privateInventory.body.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
