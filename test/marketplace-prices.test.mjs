import assert from "node:assert/strict";
import test from "node:test";

import pricesHandler, { normalizeMarketQuery, searchSkinportItems } from "../api/marketplace/prices.js";

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

test("external market search tolerates punctuation and small misspellings", () => {
  const items = [
    { market_hash_name: "AK-47 | Redline (Field-Tested)", min_price: 12.5, quantity: 7, item_page: "https://skinport.com/item/csgo/redline" },
    { market_hash_name: "AWP | Asiimov (Battle-Scarred)", min_price: 70, quantity: 2, item_page: "https://skinport.com/item/csgo/asiimov" },
    { market_hash_name: "Unsafe", min_price: 1, quantity: 1, item_page: "https://example.com/not-skinport" },
  ];

  assert.equal(normalizeMarketQuery("  AK-47 | Redline "), "ak 47 redline");
  const results = searchSkinportItems(items, "redlien");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "AK-47 | Redline (Field-Tested)");
  assert.equal(results[0].priceUsd, 12.5);
  assert.equal(searchSkinportItems(items, "unsafe").length, 0);
});

test("external price API uses Skinport public data with shared caching", async () => {
  const originalFetch = globalThis.fetch;
  let acceptEncoding = "";
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.skinport\.com\/v1\/items/);
    acceptEncoding = options.headers["Accept-Encoding"];
    return Response.json([
      { market_hash_name: "AK-47 | Redline (Field-Tested)", min_price: 13.25, quantity: 4, item_page: "https://skinport.com/item/csgo/redline" },
    ]);
  };

  try {
    const req = { method: "GET", url: "/api/marketplace/prices?query=redline", headers: {} };
    const res = responseRecorder();
    await pricesHandler(req, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(acceptEncoding, "br");
    assert.equal(body.provider, "Skinport");
    assert.equal(body.results[0].priceUsd, 13.25);
    assert.match(res.headers.get("cache-control"), /s-maxage=300/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("external price API rejects short searches before contacting a provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch should not run"); };
  try {
    const req = { method: "GET", url: "/api/marketplace/prices?query=a", headers: {} };
    const res = responseRecorder();
    await pricesHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).code, "INVALID_QUERY");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
