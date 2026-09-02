import {
  getMarketplaceBidBudget,
  MarketplaceStorageUnavailableError,
  MAX_BID_BUDGET_CENTS,
  saveMarketplaceBidBudget,
} from "../_lib/marketplace-store.js";
import { readSession } from "../_lib/session.js";

const MAX_BODY_BYTES = 4_096;

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
    return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export default async function handler(req, res) {
  const session = readSession(req.headers.cookie || null);
  if (!session) {
    sendJson(res, 401, { error: "Connect Steam to manage your bid budget", code: "AUTH_REQUIRED" });
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
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, PUT" });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      sendJson(res, 400, { error: error.message || "Invalid budget", code: "INVALID_BUDGET" });
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
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Budget storage request timed out" : "Bid budget is temporarily unavailable",
      code: timedOut ? "STORAGE_TIMEOUT" : "BUDGET_UNAVAILABLE",
    });
  }
}
