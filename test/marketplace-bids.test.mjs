import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listMarketplaceStores,
  saveMarketplaceListings,
  upsertMarketplaceProfile,
} from "../api/_lib/marketplace-store.js";
import { createSessionCookie } from "../api/_lib/session.js";
import bidsHandler from "../api/marketplace/bids.js";

process.env.SESSION_SECRET = "marketplace-bids-test-secret-with-enough-entropy";

const sellerSteamId = "76561198000000031";
const bidderSteamId = "76561198000000032";

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

function sessionCookie(steamid, name) {
  return createSessionCookie({ steamid, name, avatar: "", issuedAt: Date.now() }).split(";")[0];
}

async function invoke({ cookie = "", body = {} } = {}) {
  const req = { method: "POST", url: "/api/marketplace/bids", headers: { cookie }, body };
  const res = responseRecorder();
  await bidsHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("open marketplace auctions accept only higher session-bound bids", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDataFile = process.env.MARKETPLACE_DATA_FILE;
  const originalDisabled = process.env.MARKETPLACE_STORAGE_DISABLED;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-bids-test-"));

  process.env.NODE_ENV = "development";
  process.env.MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "marketplace.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const listing = {
    assetid: "7001",
    name: "AWP | Open Auction",
    type: "Sniper Rifle",
    icon: "",
    marketable: true,
    tier: "normal",
    cat: "rifles",
  };

  try {
    await upsertMarketplaceProfile({ steamid: sellerSteamId, name: "Auction Seller", avatar: "" });
    await saveMarketplaceListings({ steamid: sellerSteamId, name: "Auction Seller", avatar: "" }, [listing]);

    const anonymous = await invoke({ body: { sellerSteamId, assetid: "7001", amountCents: 500 } });
    assert.equal(anonymous.status, 401);

    const tamperedBidder = await invoke({
      cookie: sessionCookie(bidderSteamId, "Bidder"),
      body: { sellerSteamId, assetid: "7001", amountCents: 500, bidderSteamId: sellerSteamId },
    });
    assert.equal(tamperedBidder.status, 400);
    assert.equal(tamperedBidder.body.code, "SESSION_ACCOUNT_ONLY");

    const selfBid = await invoke({
      cookie: sessionCookie(sellerSteamId, "Auction Seller"),
      body: { sellerSteamId, assetid: "7001", amountCents: 500 },
    });
    assert.equal(selfBid.status, 403);
    assert.equal(selfBid.body.code, "SELF_BID");

    const firstBid = await invoke({
      cookie: sessionCookie(bidderSteamId, "Bidder"),
      body: { sellerSteamId, assetid: "7001", amountCents: 500 },
    });
    assert.equal(firstBid.status, 200);
    assert.equal(firstBid.body.auction.currentBidCents, 500);
    assert.equal(firstBid.body.auction.bidCount, 1);
    assert.equal(firstBid.body.auction.bidder.steamid, bidderSteamId);
    assert.equal(firstBid.headers.get("cache-control"), "no-store");

    const staleBid = await invoke({
      cookie: sessionCookie("76561198000000033", "Second Bidder"),
      body: { sellerSteamId, assetid: "7001", amountCents: 500 },
    });
    assert.equal(staleBid.status, 409);
    assert.equal(staleBid.body.code, "BID_TOO_LOW");
    assert.equal(staleBid.body.currentBidCents, 500);

    await Promise.all([
      invoke({
        cookie: sessionCookie(bidderSteamId, "Bidder"),
        body: { sellerSteamId, assetid: "7001", amountCents: 800 },
      }),
      invoke({
        cookie: sessionCookie("76561198000000033", "Second Bidder"),
        body: { sellerSteamId, assetid: "7001", amountCents: 900 },
      }),
    ]);

    let stores = await listMarketplaceStores();
    assert.equal(stores[0].items[0].auction.currentBidCents, 900);
    assert.equal(stores[0].items[0].auction.bidder.name, "Second Bidder");

    await saveMarketplaceListings({ steamid: sellerSteamId, name: "Auction Seller", avatar: "" }, [listing]);
    stores = await listMarketplaceStores();
    assert.equal(stores[0].items[0].auction.currentBidCents, 900);
    assert.ok(stores[0].items[0].auction.bidCount >= 2);
  } finally {
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
