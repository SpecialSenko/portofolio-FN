import {
  getMarketplaceBidBudget,
  MAX_BID_BUDGET_CENTS,
  MarketplaceBidError,
  MarketplaceStorageUnavailableError,
  placeMarketplaceBid,
  saveMarketplaceBidBudget,
} from "../_lib/marketplace-store.js";
import { readSession } from "../_lib/session.js";

const MAX_BODY_BYTES = 8_192;
const MAX_BID_CENTS = 100_000_000;

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
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

function parseBid(body) {
  if (body?.steamid !== undefined || body?.bidderSteamId !== undefined) {
    const error = new Error("Bidder account is selected from the signed session");
    error.code = "SESSION_ACCOUNT_ONLY";
    throw error;
  }
  const sellerSteamId = String(body?.sellerSteamId || "");
  const assetid = String(body?.assetid || "");
  const amountCents = Number(body?.amountCents);
  if (!/^\d{17}$/.test(sellerSteamId) || !/^\d{1,32}$/.test(assetid)) {
    const error = new Error("A valid seller and Steam asset are required");
    error.code = "INVALID_BID";
    throw error;
  }
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_BID_CENTS) {
    const error = new Error("Bid must be between $0.01 and $1,000,000.00");
    error.code = "INVALID_BID";
    throw error;
  }
  return { sellerSteamId, assetid, amountCents };
}

export default async function handler(req, res) {
  const session = readSession(req.headers.cookie || null);
  if (!session) {
    sendJson(res, 401, {
      error: req.method === "POST" ? "Connect Steam to place a bid" : "Connect Steam to manage your bid budget",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  try {
    if (req.method === "GET") {
      sendJson(res, 200, { budget: await getMarketplaceBidBudget(session.steamid) });
      return;
    }
    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      if (body?.steamid !== undefined) {
        sendJson(res, 400, { error: "Budget account is selected from the signed session", code: "SESSION_ACCOUNT_ONLY" });
        return;
      }
      const amountCents = Number(body?.amountCents);
      if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > MAX_BID_BUDGET_CENTS) {
        sendJson(res, 400, { error: "Bid budget must be between $0 and $1,000,000.00", code: "INVALID_BUDGET" });
        return;
      }
      sendJson(res, 200, { budget: await saveMarketplaceBidBudget(session.steamid, amountCents) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST, PUT" });
      return;
    }
    const body = await readJsonBody(req);
    const bid = parseBid(body);
    const budget = await getMarketplaceBidBudget(session.steamid);
    if (budget.amountCents < 1) {
      sendJson(res, 409, { error: "Set a bid budget before placing bids", code: "BUDGET_REQUIRED", budget });
      return;
    }
    if (bid.amountCents > budget.amountCents) {
      sendJson(res, 409, {
        error: "This bid is higher than your saved bid budget",
        code: "BUDGET_EXCEEDED",
        budget,
      });
      return;
    }
    const auction = await placeMarketplaceBid({ ...bid, bidder: session });
    sendJson(res, 200, {
      sellerSteamId: bid.sellerSteamId,
      assetid: bid.assetid,
      auction,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "Request body must be valid JSON", code: "INVALID_JSON" });
      return;
    }
    if (error instanceof RangeError) {
      sendJson(res, 413, { error: error.message, code: "BODY_TOO_LARGE" });
      return;
    }
    if (["SESSION_ACCOUNT_ONLY", "INVALID_BID", "INVALID_BUDGET"].includes(error?.code)) {
      sendJson(res, 400, { error: error.message, code: error.code });
      return;
    }
    if (error instanceof MarketplaceStorageUnavailableError) {
      sendJson(res, 503, { error: "Persistent marketplace storage is not configured", code: "STORAGE_NOT_CONFIGURED" });
      return;
    }
    if (error instanceof MarketplaceBidError) {
      const status = error.code === "SELF_BID" ? 403
        : ["BID_TOO_LOW", "LISTING_NOT_AUCTION"].includes(error.code) ? 409
          : 404;
      sendJson(res, status, {
        error: error.message,
        code: error.code,
        currentBidCents: error.currentBidCents,
      });
      return;
    }
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Bid storage request timed out" : "Bid could not be placed",
      code: timedOut ? "STORAGE_TIMEOUT" : "BID_UNAVAILABLE",
    });
  }
}
