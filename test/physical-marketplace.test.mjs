import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import physicalHandler from "../api/physical.js";
import { createSessionCookie } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "physical-marketplace-test-secret-with-enough-entropy";

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

async function invoke(handler, { method = "GET", body, cookie = "", url = "/api/physical" } = {}) {
  const req = { method, url, headers: { cookie }, body };
  const res = responseRecorder();
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

test("physical seller accounts keep credentials private and publish account-bound listings", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-physical-test-"));
  const original = {
    nodeEnv: process.env.NODE_ENV,
    dataFile: process.env.PHYSICAL_MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  process.env.NODE_ENV = "development";
  process.env.PHYSICAL_MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "physical.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const registration = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/auth",
      body: {
        action: "register",
        email: "seller@example.com",
        password: "correct horse battery staple",
        displayName: "Local Seller",
        storeName: "Daily Corner",
        city: "Jakarta",
        contactUrl: "https://example.com/order",
      },
    });
    assert.equal(registration.status, 200);
    assert.equal(registration.body.account.email, "seller@example.com");
    assert.equal("passwordHash" in registration.body.account, false);
    const cookie = cookieFrom(registration);
    assert.match(cookie, /^fraxb_physical_session=/);

    const me = await invoke(physicalHandler, { cookie, url: "/api/physical/auth" });
    assert.equal(me.body.loggedIn, true);
    assert.equal(me.body.account.storeName, "Daily Corner");

    const anonymousListing = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/listings",
      body: { title: "Rice bowl", priceIdr: 20_000, stock: 5, fulfillment: ["local_delivery"] },
    });
    assert.equal(anonymousListing.status, 401);

    const created = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/listings",
      cookie,
      body: {
        title: "Rice bowl",
        description: "Cooked today",
        category: "food",
        priceIdr: 20_000,
        stock: 5,
        fulfillment: ["pickup", "local_delivery"],
        area: "Central Jakarta",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.listing.seller.storeName, "Daily Corner");
    assert.equal(created.body.listing.seller.email, undefined);

    const publicListings = await invoke(physicalHandler, { url: "/api/physical/listings" });
    assert.equal(publicListings.status, 200);
    assert.equal(publicListings.body.listings.length, 1);
    assert.equal(publicListings.body.listings[0].title, "Rice bowl");
    assert.equal(publicListings.body.listings[0].seller.email, undefined);

    const logout = await invoke(physicalHandler, { method: "POST", cookie, body: { action: "logout" }, url: "/api/physical/auth" });
    assert.equal(logout.status, 200);
    const login = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/auth",
      body: { action: "login", email: "seller@example.com", password: "correct horse battery staple" },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.account.storeName, "Daily Corner");
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.dataFile === undefined) delete process.env.PHYSICAL_MARKETPLACE_DATA_FILE; else process.env.PHYSICAL_MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("physical seller identity links only from verified Steam and seller sessions", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-physical-steam-link-"));
  const original = {
    nodeEnv: process.env.NODE_ENV,
    dataFile: process.env.PHYSICAL_MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  process.env.NODE_ENV = "development";
  process.env.PHYSICAL_MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "physical.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const registration = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/auth",
      body: {
        action: "register",
        email: "linked@example.com",
        password: "correct horse battery staple",
        displayName: "Linked Seller",
        storeName: "Linked Store",
        city: "Taipei",
      },
    });
    const physicalCookie = cookieFrom(registration);
    const withoutSteam = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/auth",
      cookie: physicalCookie,
      body: { action: "linkSteam", steamid: "76561198000000000" },
    });
    assert.equal(withoutSteam.status, 401);

    const verifiedSteamId = "76561198123456789";
    const steamCookie = createSessionCookie({
      steamid: verifiedSteamId,
      name: "Verified Steam Seller",
      avatar: "",
      issuedAt: Date.now(),
    }).split(";")[0];
    const linked = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/auth",
      cookie: `${physicalCookie}; ${steamCookie}`,
      body: { action: "linkSteam", steamid: "76561198000000000" },
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.account.steamid, verifiedSteamId);

    const created = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/listings",
      cookie: physicalCookie,
      body: { title: "Linked item", category: "other", priceIdr: 50_000, stock: 1, fulfillment: ["shipping"] },
    });
    assert.equal(created.body.listing.seller.steamid, verifiedSteamId);
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.dataFile === undefined) delete process.env.PHYSICAL_MARKETPLACE_DATA_FILE; else process.env.PHYSICAL_MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("supporter checkout verifies the paid amount and activates only once", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-supporter-test-"));
  const originalFetch = globalThis.fetch;
  const original = {
    nodeEnv: process.env.NODE_ENV,
    dataFile: process.env.PHYSICAL_MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
    midtrans: process.env.MIDTRANS_SERVER_KEY,
    midtransEnv: process.env.MIDTRANS_ENV,
  };
  process.env.NODE_ENV = "development";
  process.env.PHYSICAL_MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "physical.json");
  process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-test-key";
  process.env.MIDTRANS_ENV = "sandbox";
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://app.sandbox.midtrans.com/snap/v1/transactions");
    assert.match(options.headers.Authorization, /^Basic /);
    const request = JSON.parse(options.body);
    assert.equal(request.transaction_details.gross_amount, 10_000);
    return new Response(JSON.stringify({ token: "snap-token", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/test" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const registration = await invoke(physicalHandler, {
      method: "POST",
      url: "/api/physical/auth",
      body: {
        action: "register",
        email: "supporter@example.com",
        password: "long enough password",
        displayName: "Supporter",
        storeName: "Supporter Store",
        city: "Bandung",
      },
    });
    const cookie = cookieFrom(registration);
    const checkout = await invoke(physicalHandler, { method: "POST", cookie, body: { plan: "week" }, url: "/api/physical/supporter" });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.amountIdr, 10_000);

    globalThis.fetch = originalFetch;
    const notification = {
      order_id: checkout.body.orderId,
      status_code: "200",
      gross_amount: "10000.00",
      transaction_status: "settlement",
      fraud_status: "accept",
    };
    notification.signature_key = crypto
      .createHash("sha512")
      .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
      .digest("hex");
    const first = await invoke(physicalHandler, { method: "POST", body: notification, url: "/api/physical/supporter-webhook" });
    assert.equal(first.status, 200);
    assert.equal(first.body.activated, true);
    const afterFirst = await invoke(physicalHandler, { cookie, url: "/api/physical/auth" });
    assert.equal(afterFirst.body.account.isSupporter, true);
    const supporterUntil = afterFirst.body.account.supporterUntil;

    const repeated = await invoke(physicalHandler, { method: "POST", body: notification, url: "/api/physical/supporter-webhook" });
    assert.equal(repeated.status, 200);
    const afterRepeat = await invoke(physicalHandler, { cookie, url: "/api/physical/auth" });
    assert.equal(afterRepeat.body.account.supporterUntil, supporterUntil);
  } finally {
    globalThis.fetch = originalFetch;
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.dataFile === undefined) delete process.env.PHYSICAL_MARKETPLACE_DATA_FILE; else process.env.PHYSICAL_MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    if (original.midtrans === undefined) delete process.env.MIDTRANS_SERVER_KEY; else process.env.MIDTRANS_SERVER_KEY = original.midtrans;
    if (original.midtransEnv === undefined) delete process.env.MIDTRANS_ENV; else process.env.MIDTRANS_ENV = original.midtransEnv;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
