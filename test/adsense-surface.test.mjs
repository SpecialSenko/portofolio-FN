import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("AdSense remains configuration-gated inside the advertisement rail", async () => {
  const [html, client, envExample] = await Promise.all([
    fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../adsense.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="googleAdSlot"[^>]*hidden/);
  assert.match(html, /src="\/adsense\.js"/);
  assert.match(client, /VITE_ADSENSE_CLIENT/);
  assert.match(client, /VITE_ADSENSE_SLOT/);
  assert.match(client, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  assert.match(client, /dataset\.fullWidthResponsive = "true"/);
  assert.match(envExample, /VITE_ADSENSE_CLIENT=/);
  assert.match(envExample, /VITE_ADSENSE_SLOT=/);
});
