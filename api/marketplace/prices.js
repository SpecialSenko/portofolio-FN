const SKINPORT_ITEMS_URL = "https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=true";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7_000;
const MAX_RESULTS = 8;

let skinportCache = null;

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

export function normalizeMarketQuery(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function fuzzyTokenScore(queryToken, candidateTokens) {
  let best = Number.POSITIVE_INFINITY;
  for (const token of candidateTokens) {
    if (token === queryToken) return 0;
    if (token.includes(queryToken) || queryToken.includes(token)) best = Math.min(best, 1);
    const tolerance = queryToken.length >= 7 ? 2 : queryToken.length >= 4 ? 1 : 0;
    if (Math.abs(token.length - queryToken.length) <= tolerance) {
      const distance = editDistance(queryToken, token);
      if (distance <= tolerance) best = Math.min(best, 2 + distance);
    }
  }
  return best;
}

function itemScore(itemName, query) {
  const name = normalizeMarketQuery(itemName);
  if (!name || !query) return Number.POSITIVE_INFINITY;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  const candidateTokens = name.split(" ");
  const scores = query.split(" ").map((token) => fuzzyTokenScore(token, candidateTokens));
  return scores.every(Number.isFinite) ? 3 + scores.reduce((total, score) => total + score, 0) : Number.POSITIVE_INFINITY;
}

function safeSkinportUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (url.hostname === "skinport.com" || url.hostname.endsWith(".skinport.com")) ? url.href : "";
  } catch {
    return "";
  }
}

function finitePrice(...values) {
  for (const value of values) {
    const price = Number(value);
    if (Number.isFinite(price) && price >= 0) return price;
  }
  return null;
}

export function searchSkinportItems(items, rawQuery, limit = MAX_RESULTS) {
  const query = normalizeMarketQuery(rawQuery);
  if (!query) return [];
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const name = String(item?.market_hash_name || "").slice(0, 180);
      const score = itemScore(name, query);
      const priceUsd = finitePrice(item?.min_price, item?.suggested_price, item?.median_price);
      const url = safeSkinportUrl(item?.item_page || item?.market_page);
      if (!Number.isFinite(score) || priceUsd === null || !url) return null;
      return {
        source: "Skinport",
        name,
        priceUsd,
        quantity: Math.max(0, Number.parseInt(item?.quantity || "0", 10) || 0),
        url,
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score || left.priceUsd - right.priceUsd || left.name.localeCompare(right.name))
    .slice(0, Math.min(Math.max(Number.parseInt(limit || MAX_RESULTS, 10) || MAX_RESULTS, 1), MAX_RESULTS))
    .map(({ score, ...item }) => item);
}

async function loadSkinportItems() {
  if (skinportCache && Date.now() - skinportCache.createdAt < CACHE_TTL_MS) return skinportCache.items;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SKINPORT_ITEMS_URL, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "br",
        "User-Agent": "fraxb-market/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Skinport returned HTTP ${response.status}`);
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error("Skinport returned an invalid response");
    skinportCache = { createdAt: Date.now(), items };
    return items;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET", "Cache-Control": "no-store" });
    return;
  }

  const requestUrl = new URL(req.url || "/api/marketplace/prices", "https://fraxb.invalid");
  const query = String(requestUrl.searchParams.get("query") || "").trim();
  if (query.length < 2 || query.length > 120) {
    sendJson(res, 400, { error: "Search with 2 to 120 characters", code: "INVALID_QUERY" }, { "Cache-Control": "no-store" });
    return;
  }

  try {
    const results = searchSkinportItems(await loadSkinportItems(), query);
    sendJson(res, 200, {
      query,
      currency: "USD",
      provider: "Skinport",
      results,
    }, { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "External price request timed out" : "External prices are temporarily unavailable",
      code: timedOut ? "PRICE_TIMEOUT" : "PRICE_UNAVAILABLE",
    }, { "Cache-Control": "no-store" });
  }
}
