const DEFAULT_PAGE_SIZE = 150;
const MAX_PAGE_SIZE = 250;
const REQUEST_TIMEOUT_MS = 8_000;

export function parsePageSize(value) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(parsed, 25), MAX_PAGE_SIZE);
}

function inferCategory(description, appid) {
  if (appid !== "730") return "other";
  const tags = Array.isArray(description.tags)
    ? description.tags.map((tag) => `${tag.category || ""} ${tag.internal_name || ""} ${tag.localized_tag_name || ""}`)
    : [];
  const searchable = `${description.market_hash_name || ""} ${description.name || ""} ${description.type || ""} ${tags.join(" ")}`.toLowerCase();

  if (/sticker/.test(searchable)) return "stickers";
  if (/charm|keychain/.test(searchable)) return "charms";
  if (/\bcase\b|weaponcase|container/.test(searchable)) return "cases";
  if (/glove|handwrap/.test(searchable)) return "gloves";
  if (/knife|bayonet|karambit|daggers/.test(searchable)) return "knives";
  if (/pistol|glock|usp|deagle|desert eagle|p250|tec-9|five-seven|cz75|dual berettas|revolver/.test(searchable)) return "pistols";
  if (/rifle|ak-47|m4a|famas|galil|aug|sg 553|awp|ssg 08|scar-20|g3sg1/.test(searchable)) return "rifles";
  return "other";
}

function inferTier(description) {
  const name = `${description.market_hash_name || ""} ${description.name || ""}`;
  return /StatTrak/i.test(name) ? "stattrak" : "normal";
}

function iconUrl(iconPath) {
  if (typeof iconPath !== "string" || !iconPath) return "";
  return `https://community.fastly.steamstatic.com/economy/image/${iconPath}/128fx96f`;
}

function normalizeInventory(payload, appid) {
  const descriptions = new Map();
  for (const description of payload.descriptions || []) {
    descriptions.set(`${description.classid}:${description.instanceid || "0"}`, description);
  }

  const items = [];
  for (const asset of payload.assets || []) {
    const description = descriptions.get(`${asset.classid}:${asset.instanceid || "0"}`) || {};
    items.push({
      id: String(asset.assetid || ""),
      name: description.market_hash_name || description.name || "Unknown Steam item",
      type: description.type || "Steam item",
      icon: iconUrl(description.icon_url),
      tradable: description.tradable === 1,
      marketable: description.marketable === 1,
      category: inferCategory(description, appid),
      tier: inferTier(description),
      amount: Number.parseInt(asset.amount || "1", 10) || 1,
    });
  }

  return {
    items,
    total: Number.parseInt(payload.total_inventory_count || items.length, 10) || items.length,
    more: Boolean(payload.more_items),
    next: payload.more_items && payload.last_assetid ? String(payload.last_assetid) : null,
  };
}

export async function fetchSteamInventory({ steamid, appid, contextid, count, startAssetId = "" }) {
  const url = new URL(`https://steamcommunity.com/inventory/${steamid}/${appid}/${contextid}`);
  url.searchParams.set("l", "english");
  url.searchParams.set("count", String(count));
  if (startAssetId) url.searchParams.set("start_assetid", startAssetId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "fraxb-market/1.0",
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) return { private: true };
    if (!response.ok) throw new Error(`Steam inventory returned HTTP ${response.status}`);

    const payload = await response.json();
    if (payload.success !== 1 && payload.success !== true) {
      throw new Error("Steam inventory response was unsuccessful");
    }

    return normalizeInventory(payload, appid);
  } finally {
    clearTimeout(timeout);
  }
}

function safeSteamImage(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".steamstatic.com") ? url.href : "";
  } catch {
    return "";
  }
}

export function parseSteamInventoryCatalog(html) {
  const match = String(html || "").match(/var\s+g_rgAppContextData\s*=\s*(\{[^\r\n]*\});/);
  if (!match) return [];

  let contextData;
  try {
    contextData = JSON.parse(match[1]);
  } catch {
    return [];
  }

  return Object.values(contextData)
    .map((app) => {
      const contexts = Object.values(app?.rgContexts || {})
        .filter((context) => !context?.hide_context)
        .map((context) => ({
          id: String(context.id || ""),
          name: String(context.name || "Inventory"),
          count: Number.parseInt(context.asset_count || "0", 10) || 0,
        }))
        .filter((context) => /^\d{1,12}$/.test(context.id));
      if (!contexts.length) return null;

      const preferredContext = contexts.reduce((largest, current) =>
        current.count > largest.count ? current : largest
      );
      return {
        appid: String(app.appid || ""),
        name: String(app.name || `Steam app ${app.appid}`),
        icon: safeSteamImage(app.icon),
        count: Number.parseInt(app.asset_count || preferredContext.count, 10) || preferredContext.count,
        contextid: preferredContext.id,
        contextName: preferredContext.name,
      };
    })
    .filter((game) => game && /^\d{1,12}$/.test(game.appid))
    .sort((a, b) => {
      if (a.appid === "730") return -1;
      if (b.appid === "730") return 1;
      return b.count - a.count || a.name.localeCompare(b.name);
    });
}

export async function fetchSteamInventoryCatalog(steamid) {
  const url = `https://steamcommunity.com/profiles/${steamid}/inventory/?l=english`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "Accept-Encoding": "identity",
        "User-Agent": "fraxb-market/1.0",
      },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { private: true, games: [] };
    if (!response.ok) throw new Error(`Steam inventory page returned HTTP ${response.status}`);

    const html = await response.text();
    const games = parseSteamInventoryCatalog(html);
    const privateInventory = games.length === 0 && /inventory[^<]{0,80}(private|not available)/i.test(html);
    return { private: privateInventory, games };
  } finally {
    clearTimeout(timeout);
  }
}
