import { readSession } from "../_lib/session.js";
import { fetchSteamInventory, parsePageSize } from "../_lib/steam-inventory.js";

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
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

  const requestUrl = new URL(req.url || "/api/steam/inventory", "http://localhost");
  if (requestUrl.searchParams.has("steamid")) {
    sendJson(res, 400, { error: "Steam account is selected from the signed session", code: "SESSION_ACCOUNT_ONLY" });
    return;
  }

  const startAssetId = requestUrl.searchParams.get("start_assetid") || "";
  if (startAssetId && !/^\d{1,32}$/.test(startAssetId)) {
    sendJson(res, 400, { error: "Invalid inventory cursor", code: "INVALID_CURSOR" });
    return;
  }

  const appid = requestUrl.searchParams.get("appid") || "730";
  const contextid = requestUrl.searchParams.get("contextid") || "2";
  if (!/^\d{1,12}$/.test(appid) || !/^\d{1,12}$/.test(contextid)) {
    sendJson(res, 400, { error: "Invalid Steam inventory selection", code: "INVALID_GAME" });
    return;
  }

  const count = parsePageSize(requestUrl.searchParams.get("count"));
  try {
    const inventory = await fetchSteamInventory({
      steamid: session.steamid,
      appid,
      contextid,
      count,
      startAssetId,
    });
    if (inventory.private) {
      const privateResponse = {
        items: [],
        total: 0,
        more: false,
        next: null,
        private: true,
        appid,
        contextid,
      };
      sendJson(res, 200, privateResponse);
      return;
    }

    const data = { ...inventory, private: false, appid, contextid };
    sendJson(res, 200, data);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Steam inventory request timed out" : "Steam inventory is temporarily unavailable",
      code: timedOut ? "STEAM_TIMEOUT" : "STEAM_UNAVAILABLE",
    });
  }
}
