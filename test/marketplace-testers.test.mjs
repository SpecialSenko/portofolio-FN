import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listMarketplaceStores, upsertMarketplaceProfile } from "../api/_lib/marketplace-store.js";

test("tester roles are assigned by the server-controlled Steam ID list", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-testers-"));
  const original = {
    dataFile: process.env.MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  process.env.MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "marketplace.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const testers = [
      ["76561199181595673", "First", "first"],
      ["76561198451781674", "Second", "second"],
      ["76561199069715428", "Special", "special"],
      ["76561199088840145", "Owner", null],
    ];
    for (const [steamid, name] of testers) await upsertMarketplaceProfile({ steamid, name, avatar: "" });
    const stores = await listMarketplaceStores();
    for (const [steamid, , role] of testers) {
      assert.equal(stores.find((store) => store.steamid === steamid)?.testerRole ?? null, role);
    }
  } finally {
    if (original.dataFile === undefined) delete process.env.MARKETPLACE_DATA_FILE; else process.env.MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
