import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACCOUNT_KEY_PREFIX = "fraxb:physical:account:";
const EMAIL_KEY_PREFIX = "fraxb:physical:email:";
const GOOGLE_KEY_PREFIX = "fraxb:physical:google:";
const STEAM_KEY_PREFIX = "fraxb:physical:steam:";
const LISTING_KEY_PREFIX = "fraxb:physical:listing:";
const LISTING_INDEX_KEY = "fraxb:physical:listings";
const PAYMENT_KEY_PREFIX = "fraxb:physical:payment:";
const AUTH_RATE_KEY_PREFIX = "fraxb:physical:auth-rate:";
const MAX_LISTINGS = 200;
const STORAGE_TIMEOUT_MS = 4_000;
const defaultLocalFile = fileURLToPath(new URL("../../.data/physical-marketplace.json", import.meta.url));
let localWriteQueue = Promise.resolve();
const localAuthAttempts = new Map();

export class PhysicalStorageUnavailableError extends Error {
  constructor() {
    super("Physical marketplace storage is not configured");
    this.name = "PhysicalStorageUnavailableError";
  }
}

export class PhysicalAccountExistsError extends Error {
  constructor() {
    super("An account already exists for this email address");
    this.name = "PhysicalAccountExistsError";
  }
}

export class PhysicalGoogleAccountConflictError extends Error {
  constructor() {
    super("This email is already used by another seller account");
    this.name = "PhysicalGoogleAccountConflictError";
  }
}

export class PhysicalSteamAccountConflictError extends Error {
  constructor() {
    super("This Steam account is already linked to another local seller account");
    this.name = "PhysicalSteamAccountConflictError";
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
  const configured = String(process.env.PHYSICAL_MARKETPLACE_DATA_FILE || "").trim();
  return configured ? path.resolve(configured) : defaultLocalFile;
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function emailKey(email) {
  return crypto.createHash("sha256").update(email).digest("hex");
}

function googleKey(sub) {
  return crypto.createHash("sha256").update(sub).digest("hex");
}

function normalizeGoogleSub(value) {
  const sub = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,255}$/.test(sub) ? sub : "";
}

function normalizeSteamId(value) {
  const steamid = String(value || "").trim();
  return /^\d{17}$/.test(steamid) ? steamid : "";
}

function safeUrl(value, { image = false } = {}) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return "";
    if (image && !/\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url.pathname + url.search)) return "";
    return url.href.slice(0, 800);
  } catch {
    return "";
  }
}

function isVerifiedBusiness(account) {
  const verifiedEmails = String(process.env.PHYSICAL_VERIFIED_EMAILS || "")
    .split(/[\s,]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  return verifiedEmails.includes(account.email);
}

function normalizeAccount(value) {
  const id = String(value?.id || "");
  const email = normalizeEmail(value?.email);
  const passwordHash = String(value?.passwordHash || "");
  const googleSub = normalizeGoogleSub(value?.googleSub);
  if (!/^[a-f0-9-]{36}$/.test(id) || !email || (!passwordHash && !googleSub)) return null;
  const supporterUntil = Number(value?.supporterUntil);
  const createdAt = Number(value?.createdAt);
  const updatedAt = Number(value?.updatedAt);
  return {
    id,
    email,
    passwordHash,
    googleSub,
    steamid: normalizeSteamId(value?.steamid),
    displayName: cleanText(value?.displayName, "Local seller", 80),
    storeName: cleanText(value?.storeName, "Local store", 100),
    city: cleanText(value?.city, "", 80),
    description: cleanText(value?.description, "", 300),
    contactUrl: safeUrl(value?.contactUrl),
    supporterUntil: Number.isFinite(supporterUntil) ? supporterUntil : null,
    supporterPlan: ["week", "month", "year"].includes(value?.supporterPlan) ? value.supporterPlan : null,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function normalizeListing(value) {
  const id = String(value?.id || "");
  const sellerId = String(value?.sellerId || "");
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(sellerId)) return null;
  const priceIdr = Number(value?.priceIdr);
  const stock = Number(value?.stock);
  if (!Number.isSafeInteger(priceIdr) || priceIdr < 1_000 || priceIdr > 1_000_000_000) return null;
  const fulfillment = [...new Set((Array.isArray(value?.fulfillment) ? value.fulfillment : [])
    .filter((item) => ["pickup", "local_delivery", "shipping"].includes(item)))]
    .slice(0, 3);
  if (fulfillment.length === 0) fulfillment.push("pickup");
  const createdAt = Number(value?.createdAt);
  const updatedAt = Number(value?.updatedAt);
  return {
    id,
    sellerId,
    title: cleanText(value?.title, "Local item", 120),
    description: cleanText(value?.description, "", 600),
    category: ["food", "daily", "fashion", "electronics", "services", "other"].includes(value?.category)
      ? value.category
      : "other",
    priceIdr,
    stock: Number.isSafeInteger(stock) && stock >= 0 && stock <= 100_000 ? stock : 1,
    fulfillment,
    area: cleanText(value?.area, "", 100),
    imageUrl: safeUrl(value?.imageUrl, { image: true }),
    active: value?.active !== false,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function publicAccount(account) {
  const normalized = normalizeAccount(account);
  if (!normalized) return null;
  return {
    id: normalized.id,
    displayName: normalized.displayName,
    storeName: normalized.storeName,
    city: normalized.city,
    description: normalized.description,
    contactUrl: normalized.contactUrl,
    steamid: normalized.steamid,
    isSupporter: Boolean(normalized.supporterUntil && normalized.supporterUntil > Date.now()),
    supporterUntil: normalized.supporterUntil,
    isVerified: isVerifiedBusiness(normalized),
  };
}

function privateAccount(account) {
  const publicValue = publicAccount(account);
  const normalized = normalizeAccount(account);
  return publicValue && normalized
    ? {
        ...publicValue,
        email: normalized.email,
        supporterPlan: normalized.supporterPlan,
        signInMethod: normalized.googleSub ? "google" : "password",
      }
    : null;
}

async function redisFetch(url, token, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function redisCommand(command) {
  const config = redisConfig();
  if (!config) throw new PhysicalStorageUnavailableError();
  const response = await redisFetch(config.url, config.token, command);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error("Physical marketplace storage request failed");
  return payload.result;
}

async function redisPipeline(commands) {
  const config = redisConfig();
  if (!config) throw new PhysicalStorageUnavailableError();
  const response = await redisFetch(`${config.url}/pipeline`, config.token, commands);
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload) || payload.some((entry) => entry.error)) {
    throw new Error("Physical marketplace storage request failed");
  }
  return payload.map((entry) => entry.result);
}

async function readLocalData() {
  try {
    const value = JSON.parse(await fs.readFile(localFilePath(), "utf8"));
    return value && typeof value === "object"
      ? {
          accounts: value.accounts || {},
          emailIndex: value.emailIndex || {},
          googleIndex: value.googleIndex || {},
          steamIndex: value.steamIndex || {},
          listings: value.listings || {},
          payments: value.payments || {},
        }
      : { accounts: {}, emailIndex: {}, googleIndex: {}, steamIndex: {}, listings: {}, payments: {} };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return { accounts: {}, emailIndex: {}, googleIndex: {}, steamIndex: {}, listings: {}, payments: {} };
    }
    throw error;
  }
}

async function writeLocalData(data) {
  const filePath = localFilePath();
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function withLocalWrite(operation) {
  const pending = localWriteQueue.then(operation, operation);
  localWriteQueue = pending.catch(() => {});
  return pending;
}

export function physicalStorageMode() {
  return storageMode();
}

export async function consumePhysicalAuthAttempt(identifier, { limit = 10, windowSeconds = 15 * 60 } = {}) {
  const key = crypto.createHash("sha256").update(String(identifier || "unknown")).digest("hex");
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new PhysicalStorageUnavailableError();
  if (mode === "redis") {
    const result = await redisCommand([
      "EVAL",
      "local count = redis.call('INCR', KEYS[1]) if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return {count, redis.call('TTL', KEYS[1])}",
      1,
      `${AUTH_RATE_KEY_PREFIX}${key}`,
      windowSeconds,
    ]);
    const count = Number(Array.isArray(result) ? result[0] : result) || 1;
    const retryAfter = Math.max(1, Number(Array.isArray(result) ? result[1] : windowSeconds) || windowSeconds);
    return { allowed: count <= limit, retryAfter };
  }
  const now = Date.now();
  const current = localAuthAttempts.get(key);
  const entry = !current || current.expiresAt <= now
    ? { count: 1, expiresAt: now + windowSeconds * 1_000 }
    : { ...current, count: current.count + 1 };
  localAuthAttempts.set(key, entry);
  return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.expiresAt - now) / 1_000)) };
}

export async function clearPhysicalAuthAttempts(identifier) {
  const key = crypto.createHash("sha256").update(String(identifier || "unknown")).digest("hex");
  if (storageMode() === "redis") await redisCommand(["DEL", `${AUTH_RATE_KEY_PREFIX}${key}`]);
  else localAuthAttempts.delete(key);
}

export async function createPhysicalAccount(input) {
  const account = normalizeAccount({ ...input, id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now() });
  if (!account) throw new TypeError("Invalid physical seller account");
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new PhysicalStorageUnavailableError();
  const lookupKey = emailKey(account.email);
  if (mode === "redis") {
    const result = await redisCommand([
      "EVAL",
      "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end redis.call('SET', KEYS[1], ARGV[1]) redis.call('SET', KEYS[2], ARGV[2]) return 1",
      2,
      `${EMAIL_KEY_PREFIX}${lookupKey}`,
      `${ACCOUNT_KEY_PREFIX}${account.id}`,
      account.id,
      JSON.stringify(account),
    ]);
    if (Number(result) !== 1) throw new PhysicalAccountExistsError();
    return privateAccount(account);
  }
  return withLocalWrite(async () => {
    const data = await readLocalData();
    if (data.emailIndex[lookupKey]) throw new PhysicalAccountExistsError();
    data.emailIndex[lookupKey] = account.id;
    data.accounts[account.id] = account;
    await writeLocalData(data);
    return privateAccount(account);
  });
}

export async function getOrCreateGooglePhysicalAccount(identity) {
  const sub = normalizeGoogleSub(identity?.sub);
  const email = normalizeEmail(identity?.email);
  if (!sub || !email) throw new TypeError("Invalid verified Google account");
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new PhysicalStorageUnavailableError();
  const googleLookupKey = googleKey(sub);
  const emailLookupKey = emailKey(email);
  const displayName = cleanText(identity?.name, email.split("@")[0], 80);

  if (mode === "redis") {
    const existingGoogleId = await redisCommand(["GET", `${GOOGLE_KEY_PREFIX}${googleLookupKey}`]);
    if (existingGoogleId) return getPhysicalAccountById(existingGoogleId);

    const existingEmailId = await redisCommand(["GET", `${EMAIL_KEY_PREFIX}${emailLookupKey}`]);
    if (existingEmailId) {
      if (!identity.authoritativeEmail) throw new PhysicalGoogleAccountConflictError();
      const existing = await getPhysicalAccountById(existingEmailId, { includeSecrets: true });
      if (!existing) throw new TypeError("Invalid physical seller account");
      if (existing.googleSub && existing.googleSub !== sub) throw new PhysicalGoogleAccountConflictError();
      const linked = normalizeAccount({ ...existing, googleSub: sub, updatedAt: Date.now() });
      const result = await redisCommand([
        "EVAL",
        "local owner = redis.call('GET', KEYS[1]) if owner and owner ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[1]) redis.call('SET', KEYS[2], ARGV[2]) return 1",
        2,
        `${GOOGLE_KEY_PREFIX}${googleLookupKey}`,
        `${ACCOUNT_KEY_PREFIX}${linked.id}`,
        linked.id,
        JSON.stringify(linked),
      ]);
      if (Number(result) !== 1) throw new PhysicalGoogleAccountConflictError();
      return privateAccount(linked);
    }

    const account = normalizeAccount({
      id: crypto.randomUUID(),
      email,
      googleSub: sub,
      displayName,
      storeName: `${displayName}'s Store`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const result = await redisCommand([
      "EVAL",
      "if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end redis.call('SET', KEYS[1], ARGV[1]) redis.call('SET', KEYS[2], ARGV[1]) redis.call('SET', KEYS[3], ARGV[2]) return 1",
      3,
      `${GOOGLE_KEY_PREFIX}${googleLookupKey}`,
      `${EMAIL_KEY_PREFIX}${emailLookupKey}`,
      `${ACCOUNT_KEY_PREFIX}${account.id}`,
      account.id,
      JSON.stringify(account),
    ]);
    if (Number(result) !== 1) return getOrCreateGooglePhysicalAccount(identity);
    return privateAccount(account);
  }

  return withLocalWrite(async () => {
    const data = await readLocalData();
    const googleAccountId = data.googleIndex[googleLookupKey];
    if (googleAccountId) return privateAccount(data.accounts[googleAccountId]);
    const emailAccountId = data.emailIndex[emailLookupKey];
    if (emailAccountId) {
      if (!identity.authoritativeEmail) throw new PhysicalGoogleAccountConflictError();
      const existing = normalizeAccount(data.accounts[emailAccountId]);
      if (!existing) throw new TypeError("Invalid physical seller account");
      if (existing.googleSub && existing.googleSub !== sub) throw new PhysicalGoogleAccountConflictError();
      const linked = normalizeAccount({ ...existing, googleSub: sub, updatedAt: Date.now() });
      data.accounts[linked.id] = linked;
      data.googleIndex[googleLookupKey] = linked.id;
      await writeLocalData(data);
      return privateAccount(linked);
    }
    const account = normalizeAccount({
      id: crypto.randomUUID(),
      email,
      googleSub: sub,
      displayName,
      storeName: `${displayName}'s Store`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    data.accounts[account.id] = account;
    data.emailIndex[emailLookupKey] = account.id;
    data.googleIndex[googleLookupKey] = account.id;
    await writeLocalData(data);
    return privateAccount(account);
  });
}

export async function getPhysicalAccountById(accountId, { includeSecrets = false } = {}) {
  const id = String(accountId || "");
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return null;
  const raw = mode === "redis"
    ? await redisCommand(["GET", `${ACCOUNT_KEY_PREFIX}${id}`])
    : (await readLocalData()).accounts[id];
  let account;
  try {
    account = normalizeAccount(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    account = null;
  }
  if (!account) return null;
  return includeSecrets ? account : privateAccount(account);
}

export async function getPhysicalAccountByEmail(email, { includeSecrets = false } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return null;
  const lookupKey = emailKey(normalizedEmail);
  const accountId = mode === "redis"
    ? await redisCommand(["GET", `${EMAIL_KEY_PREFIX}${lookupKey}`])
    : (await readLocalData()).emailIndex[lookupKey];
  return accountId ? getPhysicalAccountById(accountId, { includeSecrets }) : null;
}

async function putAccount(value) {
  const account = normalizeAccount(value);
  if (!account) throw new TypeError("Invalid physical seller account");
  if (storageMode() === "redis") {
    await redisCommand(["SET", `${ACCOUNT_KEY_PREFIX}${account.id}`, JSON.stringify(account)]);
  } else {
    await withLocalWrite(async () => {
      const data = await readLocalData();
      data.accounts[account.id] = account;
      await writeLocalData(data);
    });
  }
  return account;
}

export async function linkPhysicalAccountToSteam(accountId, steamIdValue) {
  const steamid = normalizeSteamId(steamIdValue);
  if (!steamid) throw new TypeError("Invalid verified Steam account");
  const account = await getPhysicalAccountById(accountId, { includeSecrets: true });
  if (!account) return null;
  if (account.steamid && account.steamid !== steamid) throw new PhysicalSteamAccountConflictError();
  const linked = normalizeAccount({ ...account, steamid, updatedAt: Date.now() });
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new PhysicalStorageUnavailableError();

  if (mode === "redis") {
    const result = await redisCommand([
      "EVAL",
      "local owner = redis.call('GET', KEYS[1]) if owner and owner ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[1]) redis.call('SET', KEYS[2], ARGV[2]) return 1",
      2,
      `${STEAM_KEY_PREFIX}${steamid}`,
      `${ACCOUNT_KEY_PREFIX}${linked.id}`,
      linked.id,
      JSON.stringify(linked),
    ]);
    if (Number(result) !== 1) throw new PhysicalSteamAccountConflictError();
    return privateAccount(linked);
  }

  return withLocalWrite(async () => {
    const data = await readLocalData();
    const owner = data.steamIndex[steamid] || Object.values(data.accounts)
      .map(normalizeAccount)
      .find((candidate) => candidate?.steamid === steamid)?.id;
    if (owner && owner !== linked.id) throw new PhysicalSteamAccountConflictError();
    data.steamIndex[steamid] = linked.id;
    data.accounts[linked.id] = linked;
    await writeLocalData(data);
    return privateAccount(linked);
  });
}

export async function updatePhysicalProfile(accountId, changes) {
  const account = await getPhysicalAccountById(accountId, { includeSecrets: true });
  if (!account) return null;
  const updated = await putAccount({
    ...account,
    displayName: changes.displayName ?? account.displayName,
    storeName: changes.storeName ?? account.storeName,
    city: changes.city ?? account.city,
    description: changes.description ?? account.description,
    contactUrl: changes.contactUrl ?? account.contactUrl,
    updatedAt: Date.now(),
  });
  return privateAccount(updated);
}

export async function listPhysicalListings() {
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return [];
  let listingValues;
  if (mode === "redis") {
    const ids = await redisCommand(["ZREVRANGE", LISTING_INDEX_KEY, 0, MAX_LISTINGS - 1]);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    listingValues = await redisCommand(["MGET", ...ids.map((id) => `${LISTING_KEY_PREFIX}${id}`)]);
  } else {
    listingValues = Object.values((await readLocalData()).listings);
  }
  const listings = (Array.isArray(listingValues) ? listingValues : [])
    .map((value) => {
      try {
        return normalizeListing(typeof value === "string" ? JSON.parse(value) : value);
      } catch {
        return null;
      }
    })
    .filter((listing) => listing?.active)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_LISTINGS);
  const sellerIds = [...new Set(listings.map((listing) => listing.sellerId))];
  const accounts = new Map();
  if (mode === "redis" && sellerIds.length) {
    const values = await redisCommand(["MGET", ...sellerIds.map((id) => `${ACCOUNT_KEY_PREFIX}${id}`)]);
    sellerIds.forEach((id, index) => {
      try {
        const account = normalizeAccount(JSON.parse(values[index] || "null"));
        if (account) accounts.set(id, publicAccount(account));
      } catch {}
    });
  } else {
    const data = await readLocalData();
    sellerIds.forEach((id) => {
      const account = publicAccount(data.accounts[id]);
      if (account) accounts.set(id, account);
    });
  }
  return listings
    .map((listing) => ({ ...listing, seller: accounts.get(listing.sellerId) || null }))
    .filter((listing) => listing.seller);
}

export async function savePhysicalListing(accountId, input) {
  const account = await getPhysicalAccountById(accountId, { includeSecrets: true });
  if (!account) return null;
  const listing = normalizeListing({
    ...input,
    id: crypto.randomUUID(),
    sellerId: account.id,
    active: true,
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  if (!listing) throw new TypeError("Invalid physical listing");
  const mode = storageMode();
  if (mode === "redis") {
    await redisPipeline([
      ["SET", `${LISTING_KEY_PREFIX}${listing.id}`, JSON.stringify(listing)],
      ["ZADD", LISTING_INDEX_KEY, listing.updatedAt, listing.id],
    ]);
  } else {
    await withLocalWrite(async () => {
      const data = await readLocalData();
      const existing = normalizeListing(data.listings[listing.id]);
      if (existing && existing.sellerId !== account.id) throw new Error("Listing belongs to another seller");
      data.listings[listing.id] = listing;
      await writeLocalData(data);
    });
  }
  return { ...listing, seller: publicAccount(account) };
}

export async function saveSupporterPayment(payment) {
  const normalized = {
    orderId: cleanText(payment.orderId, "", 50),
    accountId: String(payment.accountId || ""),
    plan: ["week", "month", "year"].includes(payment.plan) ? payment.plan : "",
    amountIdr: Number(payment.amountIdr),
    status: cleanText(payment.status, "pending", 30),
    createdAt: Number(payment.createdAt) || Date.now(),
  };
  if (!normalized.orderId || !/^[a-f0-9-]{36}$/.test(normalized.accountId) || !normalized.plan || !Number.isSafeInteger(normalized.amountIdr)) {
    throw new TypeError("Invalid supporter payment");
  }
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new PhysicalStorageUnavailableError();
  if (mode === "redis") {
    await redisCommand(["SET", `${PAYMENT_KEY_PREFIX}${normalized.orderId}`, JSON.stringify(normalized), "EX", 60 * 60 * 24 * 3]);
  } else {
    await withLocalWrite(async () => {
      const data = await readLocalData();
      data.payments[normalized.orderId] = normalized;
      await writeLocalData(data);
    });
  }
  return normalized;
}

export async function getSupporterPayment(orderId) {
  const id = cleanText(orderId, "", 50);
  if (!id) return null;
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return null;
  const raw = mode === "redis"
    ? await redisCommand(["GET", `${PAYMENT_KEY_PREFIX}${id}`])
    : (await readLocalData()).payments[id];
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw || null;
  } catch {
    return null;
  }
}

export async function activateSupporterPayment(payment, durationMs) {
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new PhysicalStorageUnavailableError();
  const now = Date.now();
  if (mode === "redis") {
    const result = await redisCommand([
      "EVAL",
      "local paymentRaw = redis.call('GET', KEYS[2]) if not paymentRaw then return 'ERR_PAYMENT' end local payment = cjson.decode(paymentRaw) if payment.status == 'settlement' then return 'ALREADY' end local accountRaw = redis.call('GET', KEYS[1]) if not accountRaw then return 'ERR_ACCOUNT' end local account = cjson.decode(accountRaw) local current = tonumber(account.supporterUntil) or 0 local now = tonumber(ARGV[1]) local base = current > now and current or now account.supporterUntil = base + tonumber(ARGV[2]) account.supporterPlan = ARGV[3] account.updatedAt = now payment.status = 'settlement' redis.call('SET', KEYS[1], cjson.encode(account)) redis.call('SET', KEYS[2], cjson.encode(payment), 'EX', 31536000) return cjson.encode(account)",
      2,
      `${ACCOUNT_KEY_PREFIX}${payment.accountId}`,
      `${PAYMENT_KEY_PREFIX}${payment.orderId}`,
      now,
      durationMs,
      payment.plan,
    ]);
    if (result === "ALREADY") return getPhysicalAccountById(payment.accountId);
    if (result === "ERR_PAYMENT" || result === "ERR_ACCOUNT") return null;
    try {
      return privateAccount(JSON.parse(result));
    } catch {
      throw new Error("Supporter activation response was invalid");
    }
  }
  return withLocalWrite(async () => {
    const data = await readLocalData();
    const storedPayment = data.payments[payment.orderId];
    const account = normalizeAccount(data.accounts[payment.accountId]);
    if (!storedPayment || !account) return null;
    if (storedPayment.status === "settlement") return privateAccount(account);
    const base = Math.max(now, Number(account.supporterUntil) || 0);
    account.supporterPlan = payment.plan;
    account.supporterUntil = base + durationMs;
    account.updatedAt = now;
    data.accounts[account.id] = account;
    data.payments[payment.orderId] = { ...storedPayment, status: "settlement" };
    await writeLocalData(data);
    return privateAccount(account);
  });
}
