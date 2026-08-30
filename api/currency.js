const ECB_DAILY_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const OPEN_USD_RATES_URL = "https://open.er-api.com/v6/latest/USD";
const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "IDR", "JPY", "AUD", "MYR", "TWD",
  "CNY", "SGD", "THB", "KRW", "CAD", "NZD", "PHP", "HKD",
];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let rateCache = null;

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

export function parseEcbRates(xml) {
  const date = String(xml || "").match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] || "";
  const eurRates = { EUR: 1 };
  const ratePattern = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;
  for (const match of String(xml || "").matchAll(ratePattern)) {
    const rate = Number.parseFloat(match[2]);
    if (Number.isFinite(rate) && rate > 0) eurRates[match[1]] = rate;
  }

  if (!date || !Number.isFinite(eurRates.USD)) throw new Error("ECB rate feed is incomplete");
  const rates = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    const eurRate = eurRates[currency];
    if (Number.isFinite(eurRate)) rates[currency] = eurRate / eurRates.USD;
  }
  return { base: "USD", date, rates };
}

export function parseOpenRates(payload) {
  if (payload?.result !== "success" || payload?.base_code !== "USD" || !payload?.rates) {
    throw new Error("Open currency rate feed is incomplete");
  }
  const rates = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    const rate = Number(payload.rates[currency]);
    if (Number.isFinite(rate) && rate > 0) rates[currency] = rate;
  }
  if (rates.USD !== 1 || !Number.isFinite(rates.TWD) || !Number.isFinite(rates.MYR)) {
    throw new Error("Open currency rate feed is incomplete");
  }
  const updatedAt = Number(payload.time_last_update_unix);
  const date = Number.isFinite(updatedAt)
    ? new Date(updatedAt * 1000).toISOString().slice(0, 10)
    : "";
  return { base: "USD", date, rates };
}

async function fetchEcbRates(signal) {
  const response = await fetch(ECB_DAILY_RATES_URL, {
    headers: {
      Accept: "application/xml, text/xml",
      "Accept-Encoding": "identity",
      "User-Agent": "fraxb-market/1.0",
    },
    signal,
  });
  if (!response.ok) throw new Error(`ECB rate feed returned HTTP ${response.status}`);
  return parseEcbRates(await response.text());
}

async function fetchOpenRates(signal) {
  const response = await fetch(OPEN_USD_RATES_URL, {
    headers: { Accept: "application/json", "User-Agent": "fraxb-market/1.0" },
    signal,
  });
  if (!response.ok) throw new Error(`Open rate feed returned HTTP ${response.status}`);
  return parseOpenRates(await response.json());
}

async function loadRates() {
  if (rateCache && Date.now() - rateCache.createdAt < CACHE_TTL_MS) return rateCache.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const [ecbResult, openResult] = await Promise.allSettled([
      fetchEcbRates(controller.signal),
      fetchOpenRates(controller.signal),
    ]);
    const ecb = ecbResult.status === "fulfilled" ? ecbResult.value : null;
    const open = openResult.status === "fulfilled" ? openResult.value : null;
    if (!ecb && !open) {
      if (controller.signal.aborted) throw new DOMException("Currency rate request timed out", "AbortError");
      throw new Error("Currency rate feeds are unavailable");
    }
    const data = {
      base: "USD",
      date: ecb?.date || open?.date || "",
      rates: { ...(open?.rates || {}), ...(ecb?.rates || {}) },
      sources: [ecb ? "ECB" : null, open ? "ExchangeRate-API" : null].filter(Boolean),
    };
    rateCache = { createdAt: Date.now(), data };
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  try {
    const data = await loadRates();
    sendJson(res, 200, data, {
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    sendJson(res, 502, {
      error: timedOut ? "Currency rate request timed out" : "Currency rates are temporarily unavailable",
      code: timedOut ? "RATE_TIMEOUT" : "RATE_UNAVAILABLE",
    }, { "Cache-Control": "no-store" });
  }
}
