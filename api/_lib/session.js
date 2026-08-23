import crypto from "node:crypto";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Generate one with `openssl rand -hex 32`.");
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function cookieSecurityAttributes() {
  return process.env.NODE_ENV === "production" ? ["Secure"] : [];
}

export function createSessionCookie(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = sign(payload);
  const value = `${payload}.${signature}`;

  return [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    ...cookieSecurityAttributes(),
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    ...cookieSecurityAttributes(),
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function readSession(cookieHeader) {
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;

  const value = cookie.slice(COOKIE_NAME.length + 1);
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (!isSessionData(data)) return null;
    if (Date.now() - data.issuedAt > MAX_AGE_SECONDS * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

function isSessionData(data) {
  return Boolean(
    data &&
      typeof data.steamid === "string" &&
      typeof data.name === "string" &&
      typeof data.avatar === "string" &&
      typeof data.issuedAt === "number",
  );
}
