import crypto from "node:crypto";
import { notifyMarketplaceDiscord } from "./discord-notify.js";
import {
  activateSupporterPayment,
  getSupporterPayment,
  PhysicalStorageUnavailableError,
  saveSupporterPayment,
} from "./physical-store.js";

const DURATIONS = {
  week: 7 * 24 * 60 * 60 * 1_000,
  month: 30 * 24 * 60 * 60 * 1_000,
  year: 365 * 24 * 60 * 60 * 1_000,
};

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
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
    if (size > 65_536) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function expectedSignature(body, serverKey) {
  return crypto
    .createHash("sha512")
    .update(`${body.order_id}${body.status_code}${body.gross_amount}${serverKey}`)
    .digest("hex");
}

function equalSignature(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const serverKey = String(process.env.MIDTRANS_SERVER_KEY || "").trim();
  if (!serverKey) {
    sendJson(res, 503, { error: "Payment webhook is not configured" });
    return;
  }
  try {
    const body = await readJsonBody(req);
    if (!equalSignature(body.signature_key, expectedSignature(body, serverKey))) {
      sendJson(res, 401, { error: "Invalid payment signature" });
      return;
    }
    const payment = await getSupporterPayment(body.order_id);
    if (!payment || Number(body.gross_amount) !== payment.amountIdr) {
      sendJson(res, 404, { error: "Payment order was not found" });
      return;
    }
    const settled = body.transaction_status === "settlement"
      || (body.transaction_status === "capture" && body.fraud_status === "accept");
    if (!settled) {
      await saveSupporterPayment({ ...payment, status: String(body.transaction_status || "pending") });
      sendJson(res, 200, { received: true, activated: false });
      return;
    }
    const duration = DURATIONS[payment.plan];
    const wasSettled = payment.status === "settlement";
    const account = await activateSupporterPayment(payment, duration);
    if (!account) {
      sendJson(res, 404, { error: "Seller account was not found" });
      return;
    }
    if (!wasSettled) {
      await notifyMarketplaceDiscord({
        title: "Supporter payment received",
        description: `${account.storeName} activated a ${payment.plan} Supporter plan.`,
        fields: [
          { name: "Amount", value: `Rp${payment.amountIdr.toLocaleString("id-ID")}`, inline: true },
          { name: "Order", value: payment.orderId, inline: true },
        ],
      });
    }
    sendJson(res, 200, { received: true, activated: true });
  } catch (error) {
    if (error instanceof PhysicalStorageUnavailableError) {
      sendJson(res, 503, { error: "Payment storage is unavailable" });
      return;
    }
    if (error instanceof SyntaxError || error instanceof RangeError) {
      sendJson(res, 400, { error: "Invalid payment notification" });
      return;
    }
    sendJson(res, 500, { error: "Payment notification failed" });
  }
}
