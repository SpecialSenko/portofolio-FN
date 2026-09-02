import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORE_INDEX_KEY = "fraxb:marketplace:stores";
const STORE_KEY_PREFIX = "fraxb:marketplace:store:";
const BID_BUDGET_KEY_PREFIX = "fraxb:marketplace:bid-budget:";
const MAX_STORES = 100;
const MAX_LISTINGS = 100;
export const MAX_BID_BUDGET_CENTS = 100_000_000;
const STORAGE_TIMEOUT_MS = 4_000;
const TESTER_ROLES = new Map([
  ["76561199181595673", "first"],
  ["76561198451781674", "second"],
  ["76561199069715428", "special"],
]);
const defaultLocalFile = fileURLToPath(new URL("../../.data/marketplace.json", import.meta.url));
let localWriteQueue = Promise.resolve();

export class MarketplaceStorageUnavailableError extends Error {
  constructor() {
    super("Marketplace storage is not configured");
    this.name = "MarketplaceStorageUnavailableError";
  }
}

export class MarketplaceBidError extends Error {
  constructor(code, message, currentBidCents = 0) {
    super(message);
    this.name = "MarketplaceBidError";
    this.code = code;
    this.currentBidCents = currentBidCents;
  }
}

function redisConfig() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

function storageMode() {
  if (process.env.MARKETPLACE_STORAGE_DISABLED === "1") return "disabled";
  if (redisConfig()) return "redis";
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return "unavailable";
  return "local";
}

function localFilePath() {
  const configured = String(process.env.MARKETPLACE_DATA_FILE || "").trim();
  return configured ? path.resolve(configured) : defaultLocalFile;
}

function safeSteamImage(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".steamstatic.com") ? url.href : "";
  } catch {
    return "";
  }
}

function cleanText(value, fallback, maxLength) {
  const cleaned = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function isMarkedAltAccount(steamid) {
  return String(process.env.MARKETPLACE_ALT_STEAM_IDS || "")
    .split(/[\s,]+/)
    .some((candidate) => candidate === steamid);
}

function testerRole(steamid) {
  return TESTER_ROLES.get(steamid) || null;
}

function isMarketplaceOwner(steamid) {
  const ownerSteamId = String(process.env.FN_OWNER_STEAM_ID || process.env.STEAM_TRADE_OWNER_ID || "").trim();
  return /^\d{17}$/.test(ownerSteamId) && ownerSteamId === steamid;
}

function normalizeAuction(value) {
  const currentBidCents = Math.max(0, Number.parseInt(value?.currentBidCents || "0", 10) || 0);
  const bidderSteamId = String(value?.bidder?.steamid || "");
  const bidder = currentBidCents > 0 && /^\d{17}$/.test(bidderSteamId)
    ? {
        steamid: bidderSteamId,
        name: cleanText(value?.bidder?.name, "Steam User", 80),
        avatar: safeSteamImage(value?.bidder?.avatar),
      }
    : null;
  const updatedAt = Number(value?.updatedAt);
  return {
    currentBidCents: bidder ? currentBidCents : 0,
    bidCount: bidder ? Math.max(1, Number.parseInt(value?.bidCount || "1", 10) || 1) : 0,
    bidder,
    updatedAt: bidder && Number.isFinite(updatedAt) ? updatedAt : null,
  };
}

function normalizeListing(item) {
  const assetid = String(item?.assetid || "");
  if (!/^\d{1,32}$/.test(assetid)) return null;
  const parsedPriceCents = Number(item?.priceCents);
  const priceCents = Number.isSafeInteger(parsedPriceCents) && parsedPriceCents >= 1 && parsedPriceCents <= 100_000_000
    ? parsedPriceCents
    : null;
  const category = ["rifles", "pistols", "knives", "gloves", "stickers", "charms", "cases"].includes(item?.cat)
    ? item.cat
    : null;
  const auction = normalizeAuction(item?.auction);
  const saleMode = item?.saleMode === "auction" || auction.bidCount > 0 ? "auction" : "fixed";
  return {
    id: `730:2:${assetid}`,
    assetid,
    appid: "730",
    name: cleanText(item?.name, "Steam item", 160),
    type: cleanText(item?.type, "CS2 item", 120),
    icon: safeSteamImage(item?.icon),
    tradable: true,
    marketable: Boolean(item?.marketable),
    tier: item?.tier === "stattrak" ? "stattrak" : "normal",
    cat: category,
    game: "Counter-Strike 2",
    gameShort: "CS2",
    priceCents,
    usd: priceCents === null ? null : priceCents / 100,
    forSale: true,
    saleMode,
    auction: saleMode === "auction" ? auction : normalizeAuction(null),
  };
}

function normalizeStore(value) {
  const steamid = String(value?.steamid || "");
  if (!/^\d{17}$/.test(steamid)) return null;
  const items = (Array.isArray(value?.items) ? value.items : [])
    .slice(0, MAX_LISTINGS)
    .map(normalizeListing)
    .filter(Boolean);
  const rating = Number(value?.rating);
  const joinedAt = Number(value?.joinedAt);
  const updatedAt = Number(value?.updatedAt);
  const lastSeenAt = Number(value?.lastSeenAt);
  return {
    steamid,
    name: cleanText(value?.name, "Steam User", 80),
    avatar: safeSteamImage(value?.avatar),
    isAlt: isMarkedAltAccount(steamid),
    isOwner: isMarketplaceOwner(steamid),
    testerRole: testerRole(steamid),
    rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null,
    ratingCount: Math.max(0, Number.parseInt(value?.ratingCount || "0", 10) || 0),
    listed: items.length,
    items,
    joinedAt: Number.isFinite(joinedAt) ? joinedAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : Date.now(),
  };
}

async function redisCommand(command) {
  const config = redisConfig();
  if (!config) throw new MarketplaceStorageUnavailableError();
  const response = await redisFetch(config.url, config.token, command);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error("Marketplace storage request failed");
  return payload.result;
}

async function redisPipeline(commands) {
  const config = redisConfig();
  if (!config) throw new MarketplaceStorageUnavailableError();
  const response = await redisFetch(`${config.url}/pipeline`, config.token, commands);
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload) || payload.some((entry) => entry.error)) {
    throw new Error("Marketplace storage request failed");
  }
  return payload.map((entry) => entry.result);
}

async function redisFetch(url, token, command) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readLocalData() {
  try {
    const value = JSON.parse(await fs.readFile(localFilePath(), "utf8"));
    return value && typeof value === "object" && value.stores && typeof value.stores === "object"
      ? {
          ...value,
          bidBudgets: value.bidBudgets && typeof value.bidBudgets === "object" ? value.bidBudgets : {},
        }
      : { stores: {}, bidBudgets: {} };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return { stores: {} };
    throw error;
  }
}

async function writeLocalData(data) {
  const filePath = localFilePath();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function withLocalWrite(operation) {
  const pending = localWriteQueue.then(operation, operation);
  localWriteQueue = pending.catch(() => {});
  return pending;
}

function parseStoredValue(value) {
  if (typeof value !== "string") return null;
  try {
    return normalizeStore(JSON.parse(value));
  } catch {
    return null;
  }
}

async function getStore(steamid) {
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return null;
  if (mode === "redis") return parseStoredValue(await redisCommand(["GET", `${STORE_KEY_PREFIX}${steamid}`]));
  const data = await readLocalData();
  return normalizeStore(data.stores[steamid]);
}

async function putStore(store) {
  const normalized = normalizeStore(store);
  if (!normalized) throw new Error("Invalid marketplace store");
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new MarketplaceStorageUnavailableError();
  if (mode === "redis") {
    await redisPipeline([
      ["SET", `${STORE_KEY_PREFIX}${normalized.steamid}`, JSON.stringify(normalized)],
      ["ZADD", STORE_INDEX_KEY, normalized.lastSeenAt, normalized.steamid],
    ]);
    return normalized;
  }
  return withLocalWrite(async () => {
    const data = await readLocalData();
    data.stores[normalized.steamid] = normalized;
    await writeLocalData(data);
    return normalized;
  });
}

export function marketplaceStorageMode() {
  return storageMode();
}

function normalizeBidBudget(value) {
  const amountCents = Number(value?.amountCents);
  const updatedAt = Number(value?.updatedAt);
  return {
    amountCents: Number.isSafeInteger(amountCents) && amountCents >= 0 && amountCents <= MAX_BID_BUDGET_CENTS
      ? amountCents
      : 0,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
  };
}

export async function getMarketplaceBidBudget(steamid) {
  if (!/^\d{17}$/.test(String(steamid || ""))) return normalizeBidBudget(null);
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new MarketplaceStorageUnavailableError();
  if (mode === "redis") {
    const raw = await redisCommand(["GET", `${BID_BUDGET_KEY_PREFIX}${steamid}`]);
    try {
      return normalizeBidBudget(JSON.parse(raw || "null"));
    } catch {
      return normalizeBidBudget(null);
    }
  }
  const data = await readLocalData();
  return normalizeBidBudget(data.bidBudgets?.[steamid]);
}

export async function saveMarketplaceBidBudget(steamid, amountCents) {
  if (!/^\d{17}$/.test(String(steamid || ""))) throw new TypeError("Invalid Steam account");
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > MAX_BID_BUDGET_CENTS) {
    throw new TypeError("Bid budget must be between $0 and $1,000,000.00");
  }
  const budget = normalizeBidBudget({ amountCents, updatedAt: Date.now() });
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new MarketplaceStorageUnavailableError();
  if (mode === "redis") {
    await redisCommand(["SET", `${BID_BUDGET_KEY_PREFIX}${steamid}`, JSON.stringify(budget)]);
    return budget;
  }
  return withLocalWrite(async () => {
    const data = await readLocalData();
    data.bidBudgets ||= {};
    data.bidBudgets[steamid] = budget;
    await writeLocalData(data);
    return budget;
  });
}

export async function listMarketplaceStores() {
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return [];
  if (mode === "redis") {
    const steamids = await redisCommand(["ZREVRANGE", STORE_INDEX_KEY, 0, MAX_STORES - 1]);
    if (!Array.isArray(steamids) || steamids.length === 0) return [];
    const values = await redisCommand(["MGET", ...steamids.map((steamid) => `${STORE_KEY_PREFIX}${steamid}`)]);
    return (Array.isArray(values) ? values : []).map(parseStoredValue).filter(Boolean);
  }
  const data = await readLocalData();
  return Object.values(data.stores)
    .map(normalizeStore)
    .filter(Boolean)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, MAX_STORES);
}

export async function upsertMarketplaceProfile(profile) {
  if (storageMode() === "disabled" || storageMode() === "unavailable") return null;
  const now = Date.now();
  const existing = await getStore(profile.steamid);
  return putStore({
    ...(existing || {}),
    steamid: profile.steamid,
    name: profile.name,
    avatar: profile.avatar,
    items: existing?.items || [],
    joinedAt: existing?.joinedAt || now,
    updatedAt: existing?.updatedAt || now,
    lastSeenAt: now,
  });
}

export async function saveMarketplaceListings(profile, items) {
  const now = Date.now();
  const existing = await getStore(profile.steamid);
  const existingItems = new Map((existing?.items || []).map((item) => [item.assetid, item]));
  const listingsWithAuctions = items.map((item) => ({
    ...item,
    saleMode: item.saleMode === "auction" ? "auction" : "fixed",
    auction: item.saleMode === "auction" && existingItems.get(String(item.assetid || ""))?.saleMode === "auction"
      ? existingItems.get(String(item.assetid || "")).auction
      : normalizeAuction(null),
  }));
  return putStore({
    ...(existing || {}),
    steamid: profile.steamid,
    name: profile.name,
    avatar: profile.avatar,
    items: listingsWithAuctions,
    joinedAt: existing?.joinedAt || now,
    updatedAt: now,
    lastSeenAt: now,
  });
}

const PLACE_BID_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'ERR_STORE_NOT_FOUND' end
local store = cjson.decode(raw)
if tostring(store.steamid) == ARGV[2] then return 'ERR_SELF_BID' end
local requested = tonumber(ARGV[5])
for _, item in ipairs(store.items or {}) do
  if tostring(item.assetid) == ARGV[1] then
    local current = 0
    local count = 0
    if item.auction then
      current = tonumber(item.auction.currentBidCents) or 0
      count = tonumber(item.auction.bidCount) or 0
    end
    local isAuction = item.saleMode == 'auction' or (item.saleMode == nil and count > 0)
    if not isAuction then return 'ERR_LISTING_NOT_AUCTION' end
    local minimumFloor = current
    if current == 0 then minimumFloor = math.max((tonumber(item.priceCents) or 1) - 1, 0) end
    if requested <= minimumFloor then return 'ERR_BID_TOO_LOW:' .. tostring(minimumFloor) end
    item.auction = {
      currentBidCents = requested,
      bidCount = count + 1,
      bidder = { steamid = ARGV[2], name = ARGV[3], avatar = ARGV[4] },
      updatedAt = tonumber(ARGV[6])
    }
    store.updatedAt = tonumber(ARGV[6])
    redis.call('SET', KEYS[1], cjson.encode(store))
    return cjson.encode(item.auction)
  end
end
return 'ERR_LISTING_NOT_FOUND'
`;

function bidError(result) {
  if (result === "ERR_STORE_NOT_FOUND") {
    return new MarketplaceBidError("STORE_NOT_FOUND", "This seller store is no longer available");
  }
  if (result === "ERR_LISTING_NOT_FOUND") {
    return new MarketplaceBidError("LISTING_NOT_FOUND", "This item is no longer listed");
  }
  if (result === "ERR_SELF_BID") {
    return new MarketplaceBidError("SELF_BID", "You cannot bid on your own item");
  }
  if (result === "ERR_LISTING_NOT_AUCTION") {
    return new MarketplaceBidError("LISTING_NOT_AUCTION", "This item is listed at a fixed price and does not accept bids");
  }
  if (typeof result === "string" && result.startsWith("ERR_BID_TOO_LOW:")) {
    const current = Number.parseInt(result.split(":")[1] || "0", 10) || 0;
    return new MarketplaceBidError("BID_TOO_LOW", "Your bid must be higher than the current bid", current);
  }
  return null;
}

export async function placeMarketplaceBid({ sellerSteamId, assetid, bidder, amountCents }) {
  if (sellerSteamId === bidder.steamid) {
    throw new MarketplaceBidError("SELF_BID", "You cannot bid on your own item");
  }
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new MarketplaceStorageUnavailableError();
  const now = Date.now();

  if (mode === "redis") {
    const result = await redisCommand([
      "EVAL",
      PLACE_BID_SCRIPT,
      1,
      `${STORE_KEY_PREFIX}${sellerSteamId}`,
      assetid,
      bidder.steamid,
      cleanText(bidder.name, "Steam User", 80),
      safeSteamImage(bidder.avatar),
      amountCents,
      now,
    ]);
    const error = bidError(result);
    if (error) throw error;
    try {
      return normalizeAuction(JSON.parse(result));
    } catch {
      throw new Error("Marketplace bid response was invalid");
    }
  }

  return withLocalWrite(async () => {
    const data = await readLocalData();
    const store = normalizeStore(data.stores[sellerSteamId]);
    if (!store) throw new MarketplaceBidError("STORE_NOT_FOUND", "This seller store is no longer available");
    const item = store.items.find((listing) => listing.assetid === assetid);
    if (!item) throw new MarketplaceBidError("LISTING_NOT_FOUND", "This item is no longer listed");
    if (item.saleMode !== "auction") {
      throw new MarketplaceBidError("LISTING_NOT_AUCTION", "This item is listed at a fixed price and does not accept bids");
    }
    const currentBidCents = item.auction.currentBidCents;
    const minimumFloor = currentBidCents || Math.max((item.priceCents || 1) - 1, 0);
    if (amountCents <= minimumFloor) {
      throw new MarketplaceBidError("BID_TOO_LOW", "Your bid must meet the starting price or beat the current bid", minimumFloor);
    }
    item.auction = normalizeAuction({
      currentBidCents: amountCents,
      bidCount: item.auction.bidCount + 1,
      bidder,
      updatedAt: now,
    });
    store.updatedAt = now;
    data.stores[sellerSteamId] = store;
    await writeLocalData(data);
    return item.auction;
  });
}
