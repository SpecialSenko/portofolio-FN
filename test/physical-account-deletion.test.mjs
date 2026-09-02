import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import physicalHandler from "../api/physical.js";
import {
  PHYSICAL_ACCOUNT_DELETE_DELAY_MS,
  schedulePhysicalAccountDeletion,
} from "../api/_lib/physical-store.js";

process.env.SESSION_SECRET = "physical-deletion-test-secret-with-enough-entropy";

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

async function invoke({ method = "GET", body, cookie = "", url = "/api/physical/auth" } = {}) {
  const req = { method, url, headers: { cookie }, body };
  const res = responseRecorder();
  await physicalHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("physical store deletion waits three days, can be cancelled, and removes listings when due", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-physical-delete-"));
  const original = {
    nodeEnv: process.env.NODE_ENV,
    dataFile: process.env.PHYSICAL_MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  process.env.NODE_ENV = "development";
  process.env.PHYSICAL_MARKETPLACE_DATA_FILE = path.join(directory, "physical.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const registration = await invoke({
      method: "POST",
      body: {
        action: "register",
        email: "delete@example.com",
        password: "correct horse battery staple",
        displayName: "Delete Test",
        storeName: "Temporary Store",
        city: "Jakarta",
      },
    });
    assert.equal(registration.status, 200);
    const accountId = registration.body.account.id;
    const cookie = String(registration.headers.get("set-cookie") || "").split(";")[0];

    const scheduled = await invoke({ method: "POST", cookie, body: { action: "scheduleDeletion" } });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.account.deletionScheduledFor - scheduled.body.account.deletionRequestedAt, PHYSICAL_ACCOUNT_DELETE_DELAY_MS);

    const cancelled = await invoke({ method: "POST", cookie, body: { action: "cancelDeletion" } });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.account.deletionScheduledFor, null);

    const listing = await invoke({
      method: "POST",
      url: "/api/physical/listings",
      cookie,
      body: { title: "Temporary item", category: "other", priceIdr: 20_000, stock: 1, fulfillment: ["pickup"] },
    });
    assert.equal(listing.status, 201);

    await schedulePhysicalAccountDeletion(accountId, { now: Date.now() - PHYSICAL_ACCOUNT_DELETE_DELAY_MS - 1_000 });
    const finalized = await invoke({ cookie });
    assert.equal(finalized.status, 200);
    assert.equal(finalized.body.loggedIn, false);
    assert.match(String(finalized.headers.get("set-cookie") || ""), /Max-Age=0/);

    const publicListings = await invoke({ url: "/api/physical/listings" });
    assert.deepEqual(publicListings.body.listings, []);

    const login = await invoke({
      method: "POST",
      body: { action: "login", email: "delete@example.com", password: "correct horse battery staple" },
    });
    assert.equal(login.status, 401);
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.dataFile === undefined) delete process.env.PHYSICAL_MARKETPLACE_DATA_FILE; else process.env.PHYSICAL_MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("store settings expose the deletion deadline and cancellation controls", async () => {
  const client = await fs.readFile(new URL("../physical-market.js", import.meta.url), "utf8");

  assert.match(client, /id="physicalDeleteStore"/);
  assert.match(client, /id="physicalCancelDeletion"/);
  assert.match(client, /action: "scheduleDeletion"/);
  assert.match(client, /action: "cancelDeletion"/);
  assert.match(client, /Deletion is scheduled for/);
  assert.match(client, /external Steam and Google accounts are not deleted/);
});
