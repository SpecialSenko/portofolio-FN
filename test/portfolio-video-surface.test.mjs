import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("portfolio videos accept owner-managed HTTPS links and safe playback modes", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /data-blog-tab="videos">Videos/);
  assert.match(html, /id="portfolioVideoForm"/);
  assert.match(html, /name="videoUrl" type="url"/);
  assert.match(html, /category: "video"/);
  assert.match(html, /www\.youtube-nocookie\.com\/embed/);
  assert.match(html, /player\.vimeo\.com\/video/);
  assert.match(html, /type: "video"/);
  assert.match(html, /id="deletePortfolioVideo"/);
  assert.match(html, /portfolioVideoForm\.addEventListener\("submit", publishPortfolioVideo\)/);
});
