import { readSession } from "../_lib/session.js";
import { fetchSteamInventoryCatalog } from "../_lib/steam-inventory.js";

const catalogCache = new Map();
const CACHE_TTL_MS = 60_000;

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "private, max-age=30");
  res.setHeader("Vary", "Cookie");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  const session = readSession(req.headers.cookie || null);
  if (!session) {
    sendJson(res, 401, { error: "Connect Steam to load inventory", code: "AUTH_REQUIRED" });
    return;
  }

  const requestUrl = new URL(req.url || "/api/steam/games", "http://localhost");
  if (requestUrl.searchParams.has("steamid")) {
    sendJson(res, 400, { error: "Steam account is selected from the signed session", code: "SESSION_ACCOUNT_ONLY" });
    return;
  }

  const cached = catalogCache.get(session.steamid);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    sendJson(res, 200, cached.data);
    return;
  }

  try {
    const catalog = await fetchSteamInventoryCatalog(session.steamid);
    const data = { private: Boolean(catalog.private), games: catalog.games || [] };
    catalogCache.set(session.steamid, { createdAt: Date.now(), data });
    sendJson(res, 200, data);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Steam inventory request timed out" : "Steam inventory catalog is temporarily unavailable",
      code: timedOut ? "STEAM_TIMEOUT" : "STEAM_UNAVAILABLE",
    });
  }
}
