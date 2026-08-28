const FALLBACK_PROFILE = { name: "Steam User", avatar: "" };
const PROFILE_CACHE_TTL_MS = 5 * 60_000;
const FALLBACK_CACHE_TTL_MS = 30_000;

const profileCache = globalThis.__fraxbSteamProfileCache || new Map();
globalThis.__fraxbSteamProfileCache = profileCache;

export async function getSteamProfile(steamid) {
  if (!/^\d{17}$/.test(steamid)) return FALLBACK_PROFILE;

  const cached = profileCache.get(steamid);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const profile = await fetchSteamWebApiProfile(steamid) || await fetchSteamCommunityProfile(steamid) || FALLBACK_PROFILE;
  const resolved = profile.name !== FALLBACK_PROFILE.name || Boolean(profile.avatar);
  profileCache.set(steamid, {
    profile,
    expiresAt: Date.now() + (resolved ? PROFILE_CACHE_TTL_MS : FALLBACK_CACHE_TTL_MS),
  });
  return profile;
}

async function fetchSteamWebApiProfile(steamid) {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) return null;

  try {
    const profileRes = await fetchWithTimeout(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamid}`,
      { headers: { Accept: "application/json" } },
    );
    if (!profileRes.ok) return null;

    const profileData = await profileRes.json();
    const player = profileData?.response?.players?.[0];
    if (!player) return null;
    return {
      name: player.personaname || FALLBACK_PROFILE.name,
      avatar: player.avatarfull || player.avatar || "",
    };
  } catch {
    return null;
  }
}

async function fetchSteamCommunityProfile(steamid) {
  try {
    const profileRes = await fetchWithTimeout(
      `https://steamcommunity.com/profiles/${steamid}?xml=1`,
      { headers: { Accept: "application/xml,text/xml" } },
    );
    if (!profileRes.ok) return null;

    const profileXml = await profileRes.text();
    const name = readXmlValue(profileXml, "steamID") || FALLBACK_PROFILE.name;
    const avatar = readXmlValue(profileXml, "avatarFull").replace(/^http:\/\//, "https://");
    return { name, avatar };
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function readXmlValue(xml, tagName) {
  const openingTag = `<${tagName}>`;
  const closingTag = `</${tagName}>`;
  const start = xml.indexOf(openingTag);
  if (start === -1) return "";
  const contentStart = start + openingTag.length;
  const end = xml.indexOf(closingTag, contentStart);
  if (end === -1) return "";

  const raw = xml.slice(contentStart, end).trim();
  if (raw.startsWith("<![CDATA[") && raw.endsWith("]]>")) {
    return raw.slice(9, -3).trim();
  }
  return raw;
}
