import assert from "node:assert/strict";
import test from "node:test";

import {
  listMarketplaceStores,
  placeMarketplaceBid,
  upsertMarketplaceProfile,
} from "../api/_lib/marketplace-store.js";

const steamid = "76561198000000021";

test("marketplace storage uses server-only Upstash REST credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;
  const originalDisabled = process.env.MARKETPLACE_STORAGE_DISABLED;
  const calls = [];

  process.env.NODE_ENV = "production";
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "server-only-redis-token";
  delete process.env.MARKETPLACE_STORAGE_DISABLED;

  globalThis.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    calls.push({ url: String(url), authorization: options.headers.Authorization, command });
    if (String(url).endsWith("/pipeline")) {
      return new Response(JSON.stringify([{ result: "OK" }, { result: 1 }]), { status: 200 });
    }
    if (command[0] === "GET") {
      return new Response(JSON.stringify({ result: null }), { status: 200 });
    }
    if (command[0] === "ZREVRANGE") {
      return new Response(JSON.stringify({ result: [steamid] }), { status: 200 });
    }
    if (command[0] === "MGET") {
      return new Response(JSON.stringify({
        result: [JSON.stringify({
          steamid,
          name: "Redis Seller",
          avatar: "",
          items: [],
          joinedAt: 1,
          updatedAt: 2,
          lastSeenAt: 3,
        })],
      }), { status: 200 });
    }
    if (command[0] === "EVAL") {
      return new Response(JSON.stringify({
        result: JSON.stringify({
          currentBidCents: 1250,
          bidCount: 1,
          bidder: { steamid: "76561198000000022", name: "Redis Bidder", avatar: "" },
          updatedAt: 10,
        }),
      }), { status: 200 });
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`);
  };

  try {
    const saved = await upsertMarketplaceProfile({ steamid, name: "Redis Seller", avatar: "" });
    assert.equal(saved.steamid, steamid);
    assert.equal(calls[0].command[0], "GET");
    assert.equal(calls[1].url, "https://example.upstash.io/pipeline");
    assert.equal(calls[1].authorization, "Bearer server-only-redis-token");
    assert.deepEqual(calls[1].command[1].slice(0, 2), ["ZADD", "fraxb:marketplace:stores"]);

    const stores = await listMarketplaceStores();
    assert.equal(stores.length, 1);
    assert.equal(stores[0].name, "Redis Seller");
    assert.equal(calls[2].command[0], "ZREVRANGE");
    assert.equal(calls[3].command[0], "MGET");

    const auction = await placeMarketplaceBid({
      sellerSteamId: steamid,
      assetid: "5001",
      amountCents: 1250,
      bidder: { steamid: "76561198000000022", name: "Redis Bidder", avatar: "" },
    });
    assert.equal(auction.currentBidCents, 1250);
    assert.equal(calls[4].command[0], "EVAL");
    assert.equal(calls[4].command[3], `fraxb:marketplace:store:${steamid}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalToken;
    if (originalDisabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED;
    else process.env.MARKETPLACE_STORAGE_DISABLED = originalDisabled;
  }
});
