import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import physicalAuthHandler from "../api/_lib/physical-auth-handler.js";

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

async function invoke({ method = "GET", body } = {}) {
  const req = { method, body, headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  const res = responseRecorder();
  await physicalAuthHandler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body || "{}") };
}

test("Google marketplace sign-in is exposed site-wide and reports configuration safely", async () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    const unconfigured = await invoke();
    assert.equal(unconfigured.status, 200);
    assert.equal(unconfigured.body.googleClientId, "");

    const rejected = await invoke({ method: "POST", body: { action: "google", credential: "missing" } });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.code, "GOOGLE_NOT_CONFIGURED");

    process.env.GOOGLE_CLIENT_ID = "fraxb-test.apps.googleusercontent.com";
    const configured = await invoke();
    assert.equal(configured.body.googleClientId, "fraxb-test.apps.googleusercontent.com");

    const [html, client] = await Promise.all([
      fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
      fs.readFile(new URL("../physical-market.js", import.meta.url), "utf8"),
    ]);
    assert.match(html, /id="siteAccountButton"/);
    assert.match(html, /id="settingsSiteAccountButton"/);
    assert.match(client, /google\.accounts\.id\.renderButton/);
    assert.match(client, /id="physicalGoogleZone"/);
  } finally {
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  }
});
