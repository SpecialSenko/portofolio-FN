import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSessionCookie } from "../api/_lib/session.js";
import budgetHandler from "../api/marketplace/bids.js";

process.env.SESSION_SECRET = "marketplace-budget-test-secret-with-enough-entropy";

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(body = "") { this.body = body; },
    headers,
    body: "",
  };
}

function sessionCookie(steamid = "76561198000000041") {
  return createSessionCookie({ steamid, name: "Budget User", avatar: "", issuedAt: Date.now() }).split(";")[0];
}

async function invoke({ method = "GET", cookie = "", body } = {}) {
  const req = { method, url: "/api/marketplace/bids", headers: { cookie }, body };
  const res = responseRecorder();
  await budgetHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("bid budgets are private, session-bound, and persistent", async () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    dataFile: process.env.MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-budget-test-"));
  process.env.NODE_ENV = "development";
  process.env.MARKETPLACE_DATA_FILE = path.join(directory, "marketplace.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const anonymous = await invoke();
    assert.equal(anonymous.status, 401);

    const cookie = sessionCookie();
    const initial = await invoke({ cookie });
    assert.equal(initial.status, 200);
    assert.equal(initial.body.budget.amountCents, 0);

    const tampered = await invoke({ method: "PUT", cookie, body: { steamid: "76561198000000099", amountCents: 50_000 } });
    assert.equal(tampered.status, 400);
    assert.equal(tampered.body.code, "SESSION_ACCOUNT_ONLY");

    const saved = await invoke({ method: "PUT", cookie, body: { amountCents: 50_000 } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.budget.amountCents, 50_000);
    assert.equal(saved.headers.get("cache-control"), "no-store");

    const reloaded = await invoke({ cookie });
    assert.equal(reloaded.body.budget.amountCents, 50_000);
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.dataFile === undefined) delete process.env.MARKETPLACE_DATA_FILE; else process.env.MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
