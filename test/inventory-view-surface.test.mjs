import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("inventory availability uses explicit stable view controls", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /data-inventory-view="tradable"[^>]*aria-pressed="true"/);
  assert.match(html, /data-inventory-view="all"[^>]*aria-pressed="false"/);
  assert.match(html, /showUnavailableInventoryItems = button\.dataset\.inventoryView === "all"/);
  assert.match(html, /button\.setAttribute\("aria-pressed", String\(active\)\)/);
  assert.doesNotMatch(html, /id="showUnavailableInventory"/);
  assert.doesNotMatch(html, /filterBar\.hidden = unavailableCount === 0/);
});

test("global search keeps external prices separate and uses the server adapter", async () => {
  const [html, localServer] = await Promise.all([
    fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../scripts/local-auth-server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="externalPricePanel"/);
  assert.match(html, /id="externalPriceGrid"/);
  assert.match(html, /\/api\/marketplace\/prices\?query=/);
  assert.match(html, /trustedExternalMarketUrl/);
  assert.match(html, /No Fraxb listings match that search/);
  assert.match(localServer, /\/api\/marketplace\/prices/);
});
