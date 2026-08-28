import { clearSessionCookie, createSessionCookie, readSession } from "../_lib/session.js";
import { upsertMarketplaceProfile } from "../_lib/marketplace-store.js";
import { getSteamProfile } from "../_lib/steam-profile.js";

const STORE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const session = readSession(req.headers.cookie || null);

    if (!session) {
      sendJson(res, 200, { loggedIn: false });
      return;
    }

    let account = { ...session, issuedAt: Date.now() };
    if (session.name === "Steam User" || !session.avatar) {
      const profile = await getSteamProfile(session.steamid);
      const name = profile.name !== "Steam User" ? profile.name : session.name;
      const avatar = profile.avatar || session.avatar;
      account = { ...account, name, avatar };
    }
    const needsStoreSync = !Number.isFinite(account.storeSyncedAt)
      || Date.now() - account.storeSyncedAt >= STORE_SYNC_INTERVAL_MS;
    if (needsStoreSync) {
      const stored = await upsertMarketplaceProfile(account).catch(() => null);
      if (stored) account.storeSyncedAt = Date.now();
    }

    sendJson(res, 200, {
      loggedIn: true,
      steamid: account.steamid,
      name: account.name,
      avatar: account.avatar,
    }, { "Set-Cookie": createSessionCookie(account) });
    return;
  }

  if (req.method === "POST") {
    sendJson(res, 200, { loggedIn: false }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
}
