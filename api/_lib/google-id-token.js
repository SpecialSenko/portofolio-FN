import { OAuth2Client } from "google-auth-library";

let client;

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || "").trim();
}

export function googleSignInConfigured() {
  return Boolean(googleClientId());
}

export async function verifyGoogleIdToken(credential) {
  const audience = googleClientId();
  const idToken = String(credential || "").trim();
  if (!audience) throw new Error("Google sign-in is not configured");
  if (!idToken || idToken.length > 8_192) throw new TypeError("Google credential is missing or invalid");
  client ||= new OAuth2Client();
  let ticket;
  try {
    ticket = await client.verifyIdToken({ idToken, audience });
  } catch {
    throw new TypeError("Google credential could not be verified");
  }
  const payload = ticket.getPayload();
  const issuer = String(payload?.iss || "");
  const sub = String(payload?.sub || "");
  const email = String(payload?.email || "").trim().toLowerCase();
  if (!["accounts.google.com", "https://accounts.google.com"].includes(issuer)) {
    throw new TypeError("Google credential issuer is invalid");
  }
  if (!payload?.email_verified || !sub || !email) throw new TypeError("Google email is not verified");
  return {
    sub,
    email,
    name: String(payload?.name || "").trim(),
    authoritativeEmail: email.endsWith("@gmail.com") || Boolean(payload?.hd),
  };
}
