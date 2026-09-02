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
  assert.match(html, /activateMarketPage\("physical", \{ scope: physicalSellerScope\(entry\.listing\) \}\)/);
  assert.match(html, /activePage === "physical" && marketStoreScope/);
  assert.match(html, /showPage\("market"\)/);
  assert.match(html, /\.physical-head \.market-mode-switch[\s\S]*?width: 168px/);
  const inventoryPage = html.indexOf('<section class="page" data-page="inventory" hidden>');
  const inventoryBanner = html.indexOf('id="inventoryBanner"');
  const tradesPage = html.indexOf('<section class="page" data-page="trades" hidden>');
  assert.ok(inventoryPage < inventoryBanner && inventoryBanner < tradesPage);
  assert.ok(html.indexOf('id="physicalGrid"') < html.indexOf('id="physicalSellerGrid"'));
  assert.doesNotMatch(html, /physical-profile-grid/);
  assert.doesNotMatch(html, /viewAllPhysicalStores|All physical stores/);
  assert.ok(html.indexOf('id="physicalCartButton"') < html.indexOf('id="steamAuth"'));
  assert.match(physicalClient, /fn-physical-search/);
  assert.match(physicalClient, /fn-physical-store-scope/);
  assert.match(physicalClient, /sellerIdMatches/);
  assert.match(physicalClient, /FraxbSearch\?\.matches/);
  const listingCard = physicalClient.match(/function listingCard\(listing\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(listingCard, /physical-card is-image-only/);
  assert.match(listingCard, /card\.appendChild\(image\)/);
  assert.doesNotMatch(listingCard, /physical-card-body|Add to cart|Your listing/);
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
