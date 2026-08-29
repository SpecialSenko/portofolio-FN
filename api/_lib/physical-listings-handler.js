import { notifyMarketplaceDiscord } from "./discord-notify.js";
import { readPhysicalSession } from "./physical-session.js";
import {
  listPhysicalListings,
  PhysicalStorageUnavailableError,
  savePhysicalListing,
} from "./physical-store.js";

const MAX_BODY_BYTES = 24_576;

function sendJson(res, status, data, cache = "no-store") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", cache);
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

function listingInput(body) {
  const fulfillment = Array.isArray(body?.fulfillment) ? body.fulfillment : [];
  const priceIdr = Number(body?.priceIdr);
  const stock = Number(body?.stock);
  if (!String(body?.title || "").trim()) throw new TypeError("Item name is required");
  if (!Number.isSafeInteger(priceIdr) || priceIdr < 1_000 || priceIdr > 1_000_000_000) {
    throw new TypeError("Price must be between Rp1,000 and Rp1,000,000,000");
  }
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 100_000) throw new TypeError("Stock must be between 0 and 100,000");
  if (!fulfillment.some((value) => ["pickup", "local_delivery", "shipping"].includes(value))) {
    throw new TypeError("Choose pickup, local delivery, or shipping");
  }
  return {
    title: String(body.title).trim().slice(0, 120),
    description: String(body?.description || "").trim().slice(0, 600),
    category: String(body?.category || "other"),
    priceIdr,
    stock,
    fulfillment,
    area: String(body?.area || "").trim().slice(0, 100),
    imageUrl: String(body?.imageUrl || "").trim().slice(0, 800),
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const listings = await listPhysicalListings();
      sendJson(res, 200, { listings }, "public, max-age=30, stale-while-revalidate=120");
    } catch (error) {
      const status = error instanceof PhysicalStorageUnavailableError ? 503 : 502;
      sendJson(res, status, { error: "Local marketplace listings are temporarily unavailable", code: "LISTINGS_UNAVAILABLE" });
    }
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const session = readPhysicalSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Sign in with your seller account to add a physical item", code: "AUTH_REQUIRED" });
    return;
  }
  try {
    const listing = await savePhysicalListing(session.accountId, listingInput(await readJsonBody(req)));
    if (!listing) {
      sendJson(res, 401, { error: "Seller session expired", code: "AUTH_REQUIRED" });
      return;
    }
    await notifyMarketplaceDiscord({
      title: "New physical listing",
      description: `${listing.seller.storeName} listed ${listing.title}`,
      fields: [
        { name: "Price", value: `Rp${listing.priceIdr.toLocaleString("id-ID")}`, inline: true },
        { name: "Area", value: listing.area || listing.seller.city || "Not specified", inline: true },
      ],
    });
    sendJson(res, 201, { listing });
  } catch (error) {
    if (error instanceof PhysicalStorageUnavailableError) {
      sendJson(res, 503, { error: "Local marketplace storage is temporarily unavailable", code: "STORAGE_UNAVAILABLE" });
      return;
    }
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError) {
      sendJson(res, 400, { error: error.message || "Invalid listing", code: "INVALID_LISTING" });
      return;
    }
    sendJson(res, 500, { error: "Physical item could not be listed", code: "LISTING_FAILED" });
  }
}
