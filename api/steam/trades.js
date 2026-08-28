import { readSession } from "../_lib/session.js";

const REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_TRADE_LIMIT = 25;
const MAX_TRADE_LIMIT = 50;

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

function parseLimit(value) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TRADE_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_TRADE_LIMIT);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "fraxb-market/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Steam API returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function steamIconUrl(iconPath) {
  if (typeof iconPath !== "string" || !iconPath) return "";
  return `https://community.fastly.steamstatic.com/economy/image/${iconPath}/96fx96f`;
}

function tradeStatus(value) {
  const statuses = {
    0: "Initializing",
    1: "Pre-committed",
    2: "Committed",
    3: "Complete",
    4: "Failed",
    5: "Partially complete",
    6: "Rolled back",
    7: "Rollback failed",
    8: "In escrow",
    9: "Escrow rollback",
    10: "In escrow",
    11: "Escrow rollback",
  };
  return statuses[Number(value)] || "Unknown";
}

function normalizeItems(assets, descriptions) {
  return (Array.isArray(assets) ? assets : []).map((asset) => {
    const key = `${asset.appid || ""}:${asset.classid || ""}:${asset.instanceid || "0"}`;
    const description = descriptions.get(key) || {};
    return {
      appid: String(asset.appid || ""),
      assetid: String(asset.assetid || asset.new_assetid || ""),
      name: description.market_hash_name || description.name || "Steam item",
      icon: steamIconUrl(description.icon_url),
      amount: Number.parseInt(asset.amount || "1", 10) || 1,
    };
  });
}

async function loadPartnerProfiles(apiKey, steamids) {
  if (!steamids.length) return new Map();
  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamids", steamids.join(","));
  try {
    const payload = await fetchJson(url);
    return new Map((payload?.response?.players || []).map((player) => [
      String(player.steamid),
      {
        name: player.personaname || "Steam user",
        avatar: player.avatarfull || player.avatar || "",
      },
    ]));
  } catch {
    return new Map();
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  const session = readSession(req.headers.cookie || null);
  if (!session) {
    sendJson(res, 401, { error: "Connect Steam to load private trades", code: "AUTH_REQUIRED" });
    return;
  }

  const requestUrl = new URL(req.url || "/api/steam/trades", "http://localhost");
  if (requestUrl.searchParams.has("steamid")) {
    sendJson(res, 400, { error: "Steam account is selected from the signed session", code: "SESSION_ACCOUNT_ONLY" });
    return;
  }

  const ownerSteamId = String(process.env.STEAM_TRADE_OWNER_ID || "").trim();
  if (!/^\d{17}$/.test(ownerSteamId)) {
    sendJson(res, 503, { error: "Private Steam trade history is not configured", code: "TRADE_HISTORY_NOT_CONFIGURED" });
    return;
  }
  if (session.steamid !== ownerSteamId) {
    sendJson(res, 403, { error: "Private Steam trade history is available only to its owner", code: "TRADE_HISTORY_OWNER_ONLY" });
    return;
  }

  const apiKey = String(process.env.STEAM_API_KEY || "").trim();
  if (!apiKey) {
    sendJson(res, 503, { error: "Private Steam trade history requires a server-side Steam API key", code: "STEAM_API_KEY_REQUIRED" });
    return;
  }

  const limit = parseLimit(requestUrl.searchParams.get("limit"));
  const tradeUrl = new URL("https://api.steampowered.com/IEconService/GetTradeHistory/v1/");
  tradeUrl.searchParams.set("key", apiKey);
  tradeUrl.searchParams.set("max_trades", String(limit));
  tradeUrl.searchParams.set("get_descriptions", "true");
  tradeUrl.searchParams.set("language", "english");
  tradeUrl.searchParams.set("include_failed", "true");
  tradeUrl.searchParams.set("include_total", "true");

  try {
    const payload = await fetchJson(tradeUrl);
    const history = payload?.response || {};
    const descriptions = new Map((history.descriptions || []).map((description) => [
      `${description.appid || ""}:${description.classid || ""}:${description.instanceid || "0"}`,
      description,
    ]));
    const rawTrades = Array.isArray(history.trades) ? history.trades : [];
    const partnerIds = [...new Set(rawTrades.map((trade) => String(trade.steamid_other || "")).filter((id) => /^\d{17}$/.test(id)))];
    const profiles = await loadPartnerProfiles(apiKey, partnerIds);

    const trades = rawTrades.map((trade) => {
      const partnerSteamId = String(trade.steamid_other || "");
      const profile = profiles.get(partnerSteamId) || { name: "Steam user", avatar: "" };
      return {
        id: String(trade.tradeid || ""),
        time: Number.parseInt(trade.time_init || "0", 10) || 0,
        status: tradeStatus(trade.status),
        partner: {
          steamid: partnerSteamId,
          name: profile.name,
          avatar: profile.avatar,
          profileUrl: /^\d{17}$/.test(partnerSteamId)
            ? `https://steamcommunity.com/profiles/${partnerSteamId}`
            : "",
        },
        sent: normalizeItems(trade.assets_given, descriptions),
        received: normalizeItems(trade.assets_received, descriptions),
      };
    });

    const parsedTotal = Number.parseInt(history.total_trades, 10);
    sendJson(res, 200, {
      private: true,
      owner: session.steamid,
      total: Number.isFinite(parsedTotal) ? parsedTotal : trades.length,
      more: history.more === true || history.more === 1 || history.more === "1",
      trades,
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Steam trade history request timed out" : "Steam trade history is temporarily unavailable",
      code: timedOut ? "STEAM_TIMEOUT" : "STEAM_UNAVAILABLE",
    });
  }
}
