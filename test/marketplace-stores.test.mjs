import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { upsertMarketplaceProfile } from "../api/_lib/marketplace-store.js";
import { createSessionCookie } from "../api/_lib/session.js";
import storesHandler from "../api/marketplace/stores.js";

process.env.SESSION_SECRET = "marketplace-stores-test-secret-with-enough-entropy";

const ownerSteamId = "76561198000000011";

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

function sessionCookie() {
  return createSessionCookie({
    steamid: ownerSteamId,
    name: "Persistent Seller",
    avatar: "https://avatars.fastly.steamstatic.com/seller.jpg",
    issuedAt: Date.now(),
  }).split(";")[0];
}

async function invoke({ method = "GET", body, cookie = "", url = "/api/marketplace/stores" } = {}) {
  const req = { method, url, headers: { cookie }, body };
  const res = responseRecorder();
  await storesHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("marketplace stores persist and listings are verified against the signed Steam account", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDataFile = process.env.MARKETPLACE_DATA_FILE;
  const originalDisabled = process.env.MARKETPLACE_STORAGE_DISABLED;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-market-test-"));
  let fetchCalls = 0;

  process.env.NODE_ENV = "development";
  process.env.MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "marketplace.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    assert.match(String(url), new RegExp(`/inventory/${ownerSteamId}/730/2`));
    return new Response(JSON.stringify({
      success: 1,
      total_inventory_count: 1,
      more_items: false,
      assets: [{ assetid: "9001", classid: "100", instanceid: "0", amount: "1" }],
      descriptions: [{
        classid: "100",
        instanceid: "0",
        market_hash_name: "AK-47 | Persistent Test",
        type: "Rifle",
        icon_url: "verified-icon",
        tradable: 1,
        marketable: 1,
        tags: [{ category: "Weapon", localized_tag_name: "Rifle" }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await upsertMarketplaceProfile({
      steamid: ownerSteamId,
      name: "Persistent Seller",
      avatar: "https://avatars.fastly.steamstatic.com/seller.jpg",
    });

    const publicProfile = await invoke();
    assert.equal(publicProfile.status, 200);
    assert.equal(publicProfile.body.persistent, true);
    assert.equal(publicProfile.body.stores[0].steamid, ownerSteamId);
    assert.equal(publicProfile.body.stores[0].listed, 0);

    const anonymousUpdate = await invoke({ method: "PUT", body: { assetids: [] } });
    assert.equal(anonymousUpdate.status, 401);
    assert.equal(fetchCalls, 0);

    const switchedAccount = await invoke({
      method: "PUT",
      cookie: sessionCookie(),
      body: { steamid: "76561198000000012", assetids: [] },
    });
    assert.equal(switchedAccount.status, 400);
    assert.equal(switchedAccount.body.code, "SESSION_ACCOUNT_ONLY");
    assert.equal(fetchCalls, 0);

    const saved = await invoke({
      method: "PUT",
      cookie: sessionCookie(),
      body: { listings: [{ assetid: "9001", priceCents: 12345 }] },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.store.steamid, ownerSteamId);
    assert.equal(saved.body.store.listed, 1);
    assert.equal(saved.body.store.items[0].name, "AK-47 | Persistent Test");
    assert.equal(saved.body.store.items[0].priceCents, 12345);
    assert.equal(saved.body.store.items[0].usd, 123.45);
    assert.equal(fetchCalls, 1);

    const publicStores = await invoke();
    assert.equal(publicStores.status, 200);
    assert.equal(publicStores.body.stores[0].listed, 1);
    assert.equal(publicStores.body.stores[0].items[0].assetid, "9001");
    assert.equal(publicStores.body.stores[0].items[0].priceCents, 12345);
    assert.match(publicStores.headers.get("cache-control"), /s-maxage=15/);

    const invalidPrice = await invoke({
      method: "PUT",
      cookie: sessionCookie(),
      body: { listings: [{ assetid: "9001", priceCents: 0 }] },
    });
    assert.equal(invalidPrice.status, 400);
    assert.equal(invalidPrice.body.code, "INVALID_LISTINGS");
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDataFile === undefined) delete process.env.MARKETPLACE_DATA_FILE;
    else process.env.MARKETPLACE_DATA_FILE = originalDataFile;
    if (originalDisabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED;
    else process.env.MARKETPLACE_STORAGE_DISABLED = originalDisabled;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
