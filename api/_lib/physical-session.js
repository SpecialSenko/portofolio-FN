import crypto from "node:crypto";

const COOKIE_NAME = "fraxb_physical_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  const value = String(process.env.PHYSICAL_SESSION_SECRET || process.env.SESSION_SECRET || "").trim();
  if (value.length < 32) throw new Error("Physical seller sessions are not configured");
  return value;
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function cookies(req) {
  return String(req.headers?.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((result, part) => {
      const separator = part.indexOf("=");
      if (separator !== -1) result[part.slice(0, separator)] = part.slice(separator + 1);
      return result;
    }, {});
}

export function createPhysicalSession(accountId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(JSON.stringify({ accountId, issuedAt: now, expiresAt: now + SESSION_AGE_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

export function readPhysicalSession(req) {
  const token = cookies(req)[COOKIE_NAME];
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator === -1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const session = JSON.parse(decode(payload));
    if (!/^[a-f0-9-]{36}$/.test(String(session.accountId || ""))) return null;
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function physicalSessionCookie(token, { clear = false } = {}) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const parts = [
    `${COOKIE_NAME}=${clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${SESSION_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
