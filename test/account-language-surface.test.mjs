import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("account and language controls use unified responsive dialogs", async () => {
  const [html, physicalClient] = await Promise.all([
    fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../physical-market.js", import.meta.url), "utf8"),
  ]);

  assert.equal((html.match(/id="steamConnectBtn"/g) || []).length, 1);
  assert.equal((html.match(/id="unifiedAccountAction"/g) || []).length, 1);
  assert.match(html, /function logoutAllAccounts\(\)/);
  assert.match(html, /Promise\.allSettled/);
  assert.match(html, /fn-marketplace-logout-all/);
  assert.match(physicalClient, /fn-marketplace-logout-all/);

  assert.match(html, /id="languageModal"/);
  assert.match(html, /id="languageSearch"/);
  assert.match(html, /id="languageChoices"/);
  assert.match(html, /function setupLanguageDialog\(\)/);
  assert.doesNotMatch(html, /id="languageMenu"/);

  assert.match(html, /@media \(max-width: 1100px\)/);
  assert.match(html, /@media \(max-width: 880px\) and \(min-width: 761px\)/);
});
