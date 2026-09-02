import { createPhysicalSession, physicalSessionCookie, readPhysicalSession } from "./physical-session.js";
import { readSession } from "./session.js";
import { hashPhysicalPassword, verifyPhysicalPassword } from "./physical-password.js";
import { googleSignInConfigured, verifyGoogleIdToken } from "./google-id-token.js";
import {
  clearPhysicalAuthAttempts,
  cancelPhysicalAccountDeletion,
  consumePhysicalAuthAttempt,
  createPhysicalAccount,
  getOrCreateGooglePhysicalAccount,
  getPhysicalAccountByEmail,
  getPhysicalAccountById,
  linkPhysicalAccountToSteam,
  PhysicalAccountExistsError,
  PhysicalGoogleAccountConflictError,
  PhysicalSteamAccountConflictError,
  PhysicalStorageUnavailableError,
  schedulePhysicalAccountDeletion,
  updatePhysicalProfile,
} from "./physical-store.js";

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

function authStatus(account = null) {
  return {
    loggedIn: Boolean(account),
    account,
    paymentsConfigured: paymentStatus(),
    googleClientId: googleSignInConfigured() ? String(process.env.GOOGLE_CLIENT_ID).trim() : "",
  };
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
      if (session && !account) res.setHeader("Set-Cookie", physicalSessionCookie("", { clear: true }));
      sendJson(res, 200, authStatus(account));
    } catch {
      sendJson(res, 200, authStatus());
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
    if (action === "scheduleDeletion" || action === "cancelDeletion") {
      const session = readPhysicalSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Sign in to manage account deletion", code: "AUTH_REQUIRED" });
        return;
      }
      const account = action === "scheduleDeletion"
        ? await schedulePhysicalAccountDeletion(session.accountId)
        : await cancelPhysicalAccountDeletion(session.accountId);
      if (!account) {
        res.setHeader("Set-Cookie", physicalSessionCookie("", { clear: true }));
        sendJson(res, 401, { error: "Seller account is no longer available", code: "AUTH_REQUIRED" });
        return;
      }
      sendJson(res, 200, authStatus(account));
      return;
    }
    if (action === "linkSteam") {
      const physicalSession = readPhysicalSession(req);
      const steamSession = readSession(req.headers?.cookie || "");
      if (!physicalSession || !steamSession) {
        sendJson(res, 401, { error: "Connect both Steam and your local seller account first", code: "AUTH_REQUIRED" });
        return;
      }
      const account = await linkPhysicalAccountToSteam(physicalSession.accountId, steamSession.steamid);
      if (!account) {
        sendJson(res, 401, { error: "Seller session expired", code: "AUTH_REQUIRED" });
        return;
      }
      sendJson(res, 200, authStatus(account));
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
      sendJson(res, 200, authStatus(account));
      return;
    }

    if (action === "google") {
      if (!googleSignInConfigured()) {
        sendJson(res, 503, { error: "Google sign-in is not configured", code: "GOOGLE_NOT_CONFIGURED" });
        return;
      }
      const rateIdentifier = `${requestAddress(req)}:google`;
      const rate = await consumePhysicalAuthAttempt(rateIdentifier, { limit: 20 });
      if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfter));
        sendJson(res, 429, { error: "Too many sign-in attempts. Try again later.", code: "RATE_LIMITED" });
        return;
      }
      const identity = await verifyGoogleIdToken(body?.credential);
      const account = await getOrCreateGooglePhysicalAccount(identity);
      res.setHeader("Set-Cookie", physicalSessionCookie(createPhysicalSession(account.id)));
      await clearPhysicalAuthAttempts(rateIdentifier);
      sendJson(res, 200, authStatus(account));
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
      const valid = stored?.passwordHash ? await verifyPhysicalPassword(normalizedPassword, stored.passwordHash) : false;
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
    sendJson(res, 200, authStatus(account));
  } catch (error) {
    if (error instanceof PhysicalAccountExistsError) {
      sendJson(res, 409, { error: error.message, code: "ACCOUNT_EXISTS" });
      return;
    }
    if (error instanceof PhysicalGoogleAccountConflictError) {
      sendJson(res, 409, { error: error.message, code: "GOOGLE_ACCOUNT_CONFLICT" });
      return;
    }
    if (error instanceof PhysicalSteamAccountConflictError) {
      sendJson(res, 409, { error: error.message, code: "STEAM_ACCOUNT_CONFLICT" });
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
