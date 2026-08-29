import { createPhysicalSession, physicalSessionCookie, readPhysicalSession } from "../_lib/physical-session.js";
import { hashPhysicalPassword, verifyPhysicalPassword } from "../_lib/physical-password.js";
import {
  clearPhysicalAuthAttempts,
  consumePhysicalAuthAttempt,
  createPhysicalAccount,
  getPhysicalAccountByEmail,
  getPhysicalAccountById,
  PhysicalAccountExistsError,
  PhysicalStorageUnavailableError,
  updatePhysicalProfile,
} from "../_lib/physical-store.js";

const MAX_BODY_BYTES = 16_384;

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
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

function email(value) {
  const result = String(value || "").trim().toLowerCase();
  return result.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : "";
}

function password(value) {
  const result = String(value || "");
  return result.length >= 10 && result.length <= 128 ? result : "";
}

function profileInput(body) {
  return {
    displayName: String(body?.displayName || "").trim().slice(0, 80),
    storeName: String(body?.storeName || "").trim().slice(0, 100),
    city: String(body?.city || "").trim().slice(0, 80),
    description: String(body?.description || "").trim().slice(0, 300),
    contactUrl: String(body?.contactUrl || "").trim().slice(0, 800),
  };
}

function paymentStatus() {
  return Boolean(String(process.env.MIDTRANS_SERVER_KEY || "").trim());
}

function requestAddress(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.socket?.remoteAddress || "unknown");
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const session = readPhysicalSession(req);
      const account = session ? await getPhysicalAccountById(session.accountId) : null;
      sendJson(res, 200, { loggedIn: Boolean(account), account, paymentsConfigured: paymentStatus() });
    } catch {
      sendJson(res, 200, { loggedIn: false, account: null, paymentsConfigured: paymentStatus() });
    }
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const action = String(body?.action || "");
    if (action === "logout") {
      res.setHeader("Set-Cookie", physicalSessionCookie("", { clear: true }));
      sendJson(res, 200, { loggedIn: false });
      return;
    }
    if (action === "profile") {
      const session = readPhysicalSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Sign in to update your local store", code: "AUTH_REQUIRED" });
        return;
      }
      const account = await updatePhysicalProfile(session.accountId, profileInput(body));
      if (!account) {
        sendJson(res, 401, { error: "Seller session expired", code: "AUTH_REQUIRED" });
        return;
      }
      sendJson(res, 200, { loggedIn: true, account, paymentsConfigured: paymentStatus() });
      return;
    }

    const normalizedEmail = email(body?.email);
    const normalizedPassword = password(body?.password);
    if (!normalizedEmail || !normalizedPassword) {
      sendJson(res, 400, { error: "Use a valid email and a password with at least 10 characters", code: "INVALID_ACCOUNT" });
      return;
    }
    const rateIdentifier = `${requestAddress(req)}:${normalizedEmail}`;
    const rate = await consumePhysicalAuthAttempt(rateIdentifier);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      sendJson(res, 429, { error: "Too many sign-in attempts. Try again later.", code: "RATE_LIMITED" });
      return;
    }

    let account;
    if (action === "register") {
      const profile = profileInput(body);
      if (!profile.displayName || !profile.storeName || !profile.city) {
        sendJson(res, 400, { error: "Name, store name, and city are required", code: "INVALID_ACCOUNT" });
        return;
      }
      account = await createPhysicalAccount({
        email: normalizedEmail,
        passwordHash: await hashPhysicalPassword(normalizedPassword),
        ...profile,
      });
    } else if (action === "login") {
      const stored = await getPhysicalAccountByEmail(normalizedEmail, { includeSecrets: true });
      const valid = stored ? await verifyPhysicalPassword(normalizedPassword, stored.passwordHash) : false;
      if (!valid) {
        sendJson(res, 401, { error: "Email or password is incorrect", code: "LOGIN_FAILED" });
        return;
      }
      account = await getPhysicalAccountById(stored.id);
    } else {
      sendJson(res, 400, { error: "Unknown account action", code: "INVALID_ACTION" });
      return;
    }

    res.setHeader("Set-Cookie", physicalSessionCookie(createPhysicalSession(account.id)));
    await clearPhysicalAuthAttempts(rateIdentifier);
    sendJson(res, 200, { loggedIn: true, account, paymentsConfigured: paymentStatus() });
  } catch (error) {
    if (error instanceof PhysicalAccountExistsError) {
      sendJson(res, 409, { error: error.message, code: "ACCOUNT_EXISTS" });
      return;
    }
    if (error instanceof PhysicalStorageUnavailableError) {
      sendJson(res, 503, { error: "Local marketplace accounts are temporarily unavailable", code: "STORAGE_UNAVAILABLE" });
      return;
    }
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError) {
      sendJson(res, 400, { error: error.message || "Invalid request", code: "INVALID_REQUEST" });
      return;
    }
    sendJson(res, 500, { error: "Seller account request failed", code: "ACCOUNT_FAILED" });
  }
}
