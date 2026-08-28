import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { listMarketplaceStores, upsertMarketplaceProfile } from "../api/_lib/marketplace-store.js";

test("marketplace alt badges come from the server-controlled Steam ID list", async () => {
  const steamid = "76561198000000031";
  const originalDataFile = process.env.MARKETPLACE_DATA_FILE;
  const originalAltIds = process.env.MARKETPLACE_ALT_STEAM_IDS;
  const originalDisabled = process.env.MARKETPLACE_STORAGE_DISABLED;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-alt-test-"));

  process.env.MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "marketplace.json");
  process.env.MARKETPLACE_ALT_STEAM_IDS = `invalid, ${steamid}`;
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    await upsertMarketplaceProfile({ steamid, name: "Alt Test", avatar: "" });
    const stores = await listMarketplaceStores();
    assert.equal(stores[0].steamid, steamid);
    assert.equal(stores[0].isAlt, true);

    process.env.MARKETPLACE_ALT_STEAM_IDS = "";
    const unmarkedStores = await listMarketplaceStores();
    assert.equal(unmarkedStores[0].isAlt, false);
  } finally {
    if (originalDataFile === undefined) delete process.env.MARKETPLACE_DATA_FILE;
    else process.env.MARKETPLACE_DATA_FILE = originalDataFile;
    if (originalAltIds === undefined) delete process.env.MARKETPLACE_ALT_STEAM_IDS;
    else process.env.MARKETPLACE_ALT_STEAM_IDS = originalAltIds;
    if (originalDisabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED;
    else process.env.MARKETPLACE_STORAGE_DISABLED = originalDisabled;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
