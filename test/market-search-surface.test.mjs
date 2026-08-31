import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("market search tolerates spacing and common misspellings", async () => {
  const source = await fs.readFile(new URL("../public/search-utils.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const { matches, normalize } = context.window.FraxbSearch;

  assert.equal(normalize("   AK-47   Redline  "), "ak 47 redline");
  assert.equal(matches("  redline ", "AK-47 | Redline"), true);
  assert.equal(matches("redlien", "AK-47 | Redline"), true);
  assert.equal(matches("phsyical", "Physical market"), true);
  assert.equal(matches("dragon lore", "AWP | Asiimov"), false);
});

test("global, digital, and physical searches stay separate and route to stores", async () => {
  const [html, physicalClient] = await Promise.all([
    fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../physical-market.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /marketSearchValues = \{ global: "", market: "", physical: "" \}/);
  assert.match(html, /Search digital and physical listings/);
  assert.match(html, /Search this digital store/);
  assert.match(html, /Search physical products/);
  assert.match(html, /id="globalResultGrid"/);
  assert.match(html, /viewSeller\(entry\.seller, entry\.item\.name\)/);
  assert.match(html, /marketSearchValues\.physical = sellerQuery/);
  assert.match(html, /\.physical-page > \.market-mode-switch[\s\S]*?margin: 12px 0 12px auto/);
  assert.ok(html.indexOf('id="physicalCartButton"') < html.indexOf('id="steamAuth"'));
  assert.match(physicalClient, /fn-physical-search/);
  assert.match(physicalClient, /FraxbSearch\?\.matches/);
});

test("buyers receive only the listing action selected by the seller", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /const isAuction = hasListing && it\.saleMode === "auction"/);
  assert.match(html, /if \(isAuction\) openBidModal\(it, seller\);\s*else openFixedListing\(it, seller\);/);
  assert.match(html, /first: "1st Tester", second: "2nd Tester"/);
});

test("unconfigured checkout never collects raw payment credentials", async () => {
  const client = await fs.readFile(new URL("../physical-market.js", import.meta.url), "utf8");
  assert.match(client, /Secure checkout setup required/);
  assert.match(client, /never stores card numbers or online-banking credentials/);
  assert.doesNotMatch(client, /card_number|bank_account_number|bankPassword/i);
});
