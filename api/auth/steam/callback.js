import { createSessionCookie } from "../../_lib/session.js";

function extractSteamId64(claimedId) {
  if (!claimedId) return null;
  const match = claimedId.match(/\/id\/(\d{17})$/) ?? claimedId.match(/(\d{17})$/);
  return match ? match[1] : null;
}

function redirectHome(res, error) {
  res.statusCode = 302;
  res.setHeader("Location", error ? `/?steam_error=${encodeURIComponent(error)}` : "/");
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method not allowed");
    return;
  }

  const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const url = new URL(req.url || "/", origin);
  const params = url.searchParams;

  if (params.get("openid.mode") !== "id_res") {
    redirectHome(res, "denied");
    return;
  }

  const verifyParams = new URLSearchParams(params);
  verifyParams.set("openid.mode", "check_authentication");

  const verifyRes = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });
  const verifyText = await verifyRes.text();

  if (!verifyText.includes("is_valid:true")) {
    redirectHome(res, "invalid");
    return;
  }

  const steamid = extractSteamId64(params.get("openid.claimed_id"));
  if (!steamid) {
    redirectHome(res, "no_id");
    return;
  }

  const profile = await getSteamProfile(steamid);
  const cookie = createSessionCookie({
    steamid,
    name: profile.name,
    avatar: profile.avatar,
    issuedAt: Date.now(),
  });

  res.statusCode = 302;
  res.setHeader("Location", "/");
  res.setHeader("Set-Cookie", cookie);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

async function getSteamProfile(steamid) {
  const apiKey = process.env.STEAM_API_KEY;
  const fallback = { name: "Steam User", avatar: "" };
  if (!apiKey) return fallback;

  const profileRes = await fetch(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamid}`,
  );
  if (!profileRes.ok) return fallback;

  const profileData = await profileRes.json();
  const player = profileData?.response?.players?.[0];
  if (!player) return fallback;

  return {
    name: player.personaname ?? fallback.name,
    avatar: player.avatarfull ?? player.avatar ?? fallback.avatar,
  };
}
