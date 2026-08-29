import crypto from "node:crypto";
import { readPhysicalSession } from "../_lib/physical-session.js";
import {
  getPhysicalAccountById,
  PhysicalStorageUnavailableError,
  saveSupporterPayment,
} from "../_lib/physical-store.js";

const PLANS = {
  week: { amountIdr: 10_000, label: "1 week" },
  month: { amountIdr: 100_000, label: "1 month" },
  year: { amountIdr: 1_000_000, label: "1 year" },
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
    if (size > 4_096) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function midtransEndpoint() {
  return process.env.MIDTRANS_ENV === "production"
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const session = readPhysicalSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Sign in to support your local store", code: "AUTH_REQUIRED" });
    return;
  }
  const serverKey = String(process.env.MIDTRANS_SERVER_KEY || "").trim();
  if (!serverKey) {
    sendJson(res, 503, {
      error: "Supporter payments are not configured yet",
      code: "PAYMENTS_NOT_CONFIGURED",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const plan = PLANS[String(body?.plan || "")];
    if (!plan) {
      sendJson(res, 400, { error: "Choose a valid Supporter plan", code: "INVALID_PLAN" });
      return;
    }
    const account = await getPhysicalAccountById(session.accountId, { includeSecrets: true });
    if (!account) {
      sendJson(res, 401, { error: "Seller session expired", code: "AUTH_REQUIRED" });
      return;
    }
    const orderId = `FRAXB-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const payment = await saveSupporterPayment({
      orderId,
      accountId: account.id,
      plan: Object.entries(PLANS).find(([, value]) => value === plan)?.[0],
      amountIdr: plan.amountIdr,
      status: "pending",
      createdAt: Date.now(),
    });
    const response = await fetch(midtransEndpoint(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: plan.amountIdr },
        item_details: [{
          id: `supporter-${payment.plan}`,
          price: plan.amountIdr,
          quantity: 1,
          name: `Fraxb Supporter - ${plan.label}`,
          category: "Marketplace Supporter",
        }],
        customer_details: {
          first_name: account.displayName,
          email: account.email,
          billing_address: { city: account.city, country_code: "IDN" },
        },
        credit_card: { secure: true },
        page_expiry: { duration: 30, unit: "minutes" },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.redirect_url) {
      sendJson(res, 502, { error: "Payment provider could not start checkout", code: "PAYMENT_PROVIDER_ERROR" });
      return;
    }
    sendJson(res, 201, { orderId, redirectUrl: data.redirect_url, amountIdr: plan.amountIdr });
  } catch (error) {
    if (error instanceof PhysicalStorageUnavailableError) {
      sendJson(res, 503, { error: "Supporter payments are temporarily unavailable", code: "STORAGE_UNAVAILABLE" });
      return;
    }
    if (error instanceof SyntaxError || error instanceof RangeError) {
      sendJson(res, 400, { error: error.message || "Invalid request", code: "INVALID_REQUEST" });
      return;
    }
    sendJson(res, 500, { error: "Supporter checkout could not be started", code: "CHECKOUT_FAILED" });
  }
}
