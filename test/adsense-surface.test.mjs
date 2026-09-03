import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("AdSense remains configuration-gated inside the advertisement rail", async () => {
  const [html, client, envExample, adsTxt] = await Promise.all([
    fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../adsense.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../.env.example", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/ads.txt", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="googleAdSlot"[^>]*hidden/);
  assert.match(html, /src="\/adsense\.js"/);
  assert.match(html, /const showAdRail = \["global", "market", "physical"\]\.includes\(name\)/);
  assert.match(client, /VITE_ADSENSE_CLIENT/);
  assert.match(client, /VITE_ADSENSE_SLOT/);
  assert.match(client, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  assert.match(html, /adsbygoogle\.js\?client=ca-pub-6419232461977756/);
  assert.match(html, /id="openImageAd"/);
  assert.match(html, /id="openVideoAd"/);
  assert.match(client, /VITE_SPONSORED_VIDEO_URL/);
  assert.match(client, /watchedSeconds >= 30/);
  assert.match(client, /fn-sponsored-ad-complete/);
  assert.match(client, /dataset\.fullWidthResponsive = "true"/);
  assert.match(envExample, /VITE_ADSENSE_CLIENT=/);
  assert.match(envExample, /VITE_ADSENSE_SLOT=/);
  assert.equal(
    adsTxt.trim(),
    "google.com, pub-6419232461977756, DIRECT, f08c47fec0942fa0",
  );
});
