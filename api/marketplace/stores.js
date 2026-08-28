import { fetchSteamInventory } from "../_lib/steam-inventory.js";
import {
  listMarketplaceStores,
  marketplaceStorageMode,
  MarketplaceStorageUnavailableError,
  saveMarketplaceListings,
} from "../_lib/marketplace-store.js";
import { readSession } from "../_lib/session.js";

const MAX_LISTINGS = 100;
const MAX_BODY_BYTES = 16_384;
const MAX_INVENTORY_PAGES = 20;
const MAX_PRICE_CENTS = 100_000_000;

function sendJson(res, status, data, { cache = "no-store", headers = {} } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", cache);
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    const bodyText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
    return bodyText ? JSON.parse(bodyText) : {};
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  const bodyText = Buffer.concat(chunks).toString("utf8");
  return bodyText ? JSON.parse(bodyText) : {};
}

function parseListings(body) {
  if (body?.steamid !== undefined) {
    const error = new Error("Steam account is selected from the signed session");
    error.code = "SESSION_ACCOUNT_ONLY";
    throw error;
  }
  if (body?.listings !== undefined) {
    if (!Array.isArray(body.listings) || body.listings.length > MAX_LISTINGS) {
      const error = new Error(`listings must be an array with no more than ${MAX_LISTINGS} items`);
      error.code = "INVALID_LISTINGS";
      throw error;
    }
    const listings = body.listings.map((listing) => {
      const assetid = String(listing?.assetid || "");
      const priceCents = listing?.priceCents === null ? null : Number(listing?.priceCents);
      if (!/^\d{1,32}$/.test(assetid)) {
        const error = new Error("Every listing must contain a valid Steam asset ID");
        error.code = "INVALID_LISTINGS";
        throw error;
      }
      if (priceCents !== null && (!Number.isSafeInteger(priceCents) || priceCents < 1 || priceCents > MAX_PRICE_CENTS)) {
        const error = new Error("Every price must be between $0.01 and $1,000,000.00 USD");
        error.code = "INVALID_LISTINGS";
        throw error;
      }
      return { assetid, priceCents };
    });
    if (new Set(listings.map((listing) => listing.assetid)).size !== listings.length) {
      const error = new Error("Each Steam asset can only appear once");
      error.code = "INVALID_LISTINGS";
      throw error;
    }
    return listings;
  }

  if (!Array.isArray(body?.assetids) || body.assetids.length > MAX_LISTINGS) {
    const error = new Error(`assetids must be an array with no more than ${MAX_LISTINGS} items`);
    error.code = "INVALID_LISTINGS";
    throw error;
  }
  const assetids = [...new Set(body.assetids.map(String))];
  if (assetids.some((assetid) => !/^\d{1,32}$/.test(assetid))) {
    const error = new Error("Every listing must contain a valid Steam asset ID");
    error.code = "INVALID_LISTINGS";
    throw error;
  }
  return assetids.map((assetid) => ({ assetid, priceCents: null }));
}

function marketplaceItem(item) {
  return {
    assetid: item.id,
    name: item.name,
    type: item.type,
    icon: item.icon,
    tradable: true,
    marketable: Boolean(item.marketable),
    tier: item.tier === "stattrak" ? "stattrak" : "normal",
    cat: ["rifles", "pistols", "knives", "gloves", "stickers", "charms", "cases"].includes(item.category)
      ? item.category
      : null,
  };
}

async function verifyListings(steamid, requestedAssetIds) {
  if (requestedAssetIds.length === 0) return [];
  const remaining = new Set(requestedAssetIds);
  const verified = new Map();
  let startAssetId = "";

  for (let page = 0; page < MAX_INVENTORY_PAGES && remaining.size > 0; page += 1) {
    const inventory = await fetchSteamInventory({
      steamid,
      appid: "730",
      contextid: "2",
      count: 250,
      startAssetId,
    });
    if (inventory.private) {
      const error = new Error("Your CS2 inventory must be public before items can be listed");
      error.code = "INVENTORY_PRIVATE";
      throw error;
    }

    for (const item of inventory.items || []) {
      if (remaining.has(item.id) && item.tradable) {
        verified.set(item.id, marketplaceItem(item));
        remaining.delete(item.id);
      }
    }
    if (!inventory.more || !inventory.next) break;
    startAssetId = inventory.next;
  }

  if (remaining.size > 0) {
    const error = new Error("One or more selected items are missing or no longer tradable");
    error.code = "LISTING_NOT_TRADABLE";
    throw error;
  }
  return requestedAssetIds.map((assetid) => verified.get(assetid));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const stores = await listMarketplaceStores();
      sendJson(res, 200, {
        stores,
        persistent: !["disabled", "unavailable"].includes(marketplaceStorageMode()),
      }, { cache: "public, max-age=0, s-maxage=15, stale-while-revalidate=60" });
    } catch {
      sendJson(res, 502, { error: "Marketplace stores are temporarily unavailable", code: "STORES_UNAVAILABLE" });
    }
    return;
  }

  if (req.method !== "PUT") {
    sendJson(res, 405, { error: "Method not allowed" }, { headers: { Allow: "GET, PUT" } });
    return;
  }

  const session = readSession(req.headers.cookie || null);
  if (!session) {
    sendJson(res, 401, { error: "Connect Steam to manage store listings", code: "AUTH_REQUIRED" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const requestedListings = parseListings(body);
    const assetids = requestedListings.map((listing) => listing.assetid);
    const prices = new Map(requestedListings.map((listing) => [listing.assetid, listing.priceCents]));
    const items = (await verifyListings(session.steamid, assetids)).map((item) => ({
      ...item,
      priceCents: prices.get(item.assetid) ?? null,
    }));
    const store = await saveMarketplaceListings(session, items);
    sendJson(res, 200, { store }, { headers: { Vary: "Cookie" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "Request body must be valid JSON", code: "INVALID_JSON" });
      return;
    }
    if (error instanceof RangeError) {
      sendJson(res, 413, { error: error.message, code: "BODY_TOO_LARGE" });
      return;
    }
    if (error instanceof MarketplaceStorageUnavailableError) {
      sendJson(res, 503, { error: "Persistent marketplace storage is not configured", code: "STORAGE_NOT_CONFIGURED" });
      return;
    }
    if (["SESSION_ACCOUNT_ONLY", "INVALID_LISTINGS"].includes(error?.code)) {
      sendJson(res, 400, { error: error.message, code: error.code });
      return;
    }
    if (error?.code === "INVENTORY_PRIVATE" || error?.code === "LISTING_NOT_TRADABLE") {
      sendJson(res, 409, { error: error.message, code: error.code });
      return;
    }
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Steam inventory verification timed out" : "Store listings could not be saved",
      code: timedOut ? "STEAM_TIMEOUT" : "LISTINGS_UNAVAILABLE",
    });
  }
}
