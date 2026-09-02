import {
  getMarketplaceBidBudget,
  MarketplaceBidError,
  MarketplaceStorageUnavailableError,
  placeMarketplaceBid,
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
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
    return;
  }

  const session = readSession(req.headers.cookie || null);
  if (!session) {
    sendJson(res, 401, { error: "Connect Steam to place a bid", code: "AUTH_REQUIRED" });
    return;
  }

  try {
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
    if (["SESSION_ACCOUNT_ONLY", "INVALID_BID"].includes(error?.code)) {
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
