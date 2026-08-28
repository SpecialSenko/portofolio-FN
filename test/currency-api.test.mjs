import assert from "node:assert/strict";
import test from "node:test";

import currencyHandler, { parseEcbRates } from "../api/currency.js";

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

test("ECB rates are converted from EUR base to USD base", () => {
  const data = parseEcbRates("<Cube time='2026-08-26'><Cube currency='USD' rate='1.25'/><Cube currency='GBP' rate='0.75'/><Cube currency='IDR' rate='20000'/></Cube>");
  assert.equal(data.base, "USD");
  assert.equal(data.date, "2026-08-26");
  assert.equal(data.rates.USD, 1);
  assert.equal(data.rates.EUR, 0.8);
  assert.equal(data.rates.GBP, 0.6);
  assert.equal(data.rates.IDR, 16000);
});

test("currency API returns normalized rates with shared cache headers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "<Cube time='2026-08-26'><Cube currency='USD' rate='1.25'/><Cube currency='GBP' rate='0.75'/><Cube currency='IDR' rate='20000'/><Cube currency='JPY' rate='180'/><Cube currency='AUD' rate='1.9'/></Cube>",
    { status: 200 },
  );

  try {
    const req = { method: "GET", headers: {} };
    const res = responseRecorder();
    await currencyHandler(req, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.base, "USD");
    assert.equal(body.rates.AUD, 1.52);
    assert.match(res.headers.get("cache-control"), /s-maxage=21600/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
