import assert from "node:assert/strict";
import test from "node:test";

import { getSteamProfile } from "../api/_lib/steam-profile.js";

test("Steam profile falls back to the public profile feed without an API key", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.STEAM_API_KEY;
  delete process.env.STEAM_API_KEY;

  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://steamcommunity.com/profiles/76561198000000001?xml=1");
    return new Response(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <profile>
        <steamID><![CDATA[Fraxb User]]></steamID>
        <avatarFull><![CDATA[http://avatars.fastly.steamstatic.com/test_full.jpg]]></avatarFull>
      </profile>`, { status: 200, headers: { "Content-Type": "application/xml" } });
  };

  try {
    const profile = await getSteamProfile("76561198000000001");
    assert.deepEqual(profile, {
      name: "Fraxb User",
      avatar: "https://avatars.fastly.steamstatic.com/test_full.jpg",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.STEAM_API_KEY;
    else process.env.STEAM_API_KEY = originalApiKey;
  }
});
