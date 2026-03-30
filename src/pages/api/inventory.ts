import type { APIRoute } from "astro";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const prerender = false;

const STEAM_ID = "76561199088840145";
const APP_ID = 730;
const CONTEXT_ID = 2;
const CACHE_DURATION = 10 * 60 * 1000;
const STEAM_IMAGE_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";
const STEAM_COMMUNITY_URL = `https://steamcommunity.com/inventory/${STEAM_ID}/${APP_ID}/${CONTEXT_ID}?l=english&count=75`;
const STEAM_LEGACY_URL = `https://steamcommunity.com/profiles/${STEAM_ID}/inventory/json/${APP_ID}/${CONTEXT_ID}/?start=0`;
const CSFLOAT_STALL_URL = `https://csfloat.com/stall/${STEAM_ID}`;
const CSFLOAT_LISTINGS_URL = `https://csfloat.com/api/v1/listings?user_id=${STEAM_ID}&limit=50&sort_by=most_recent`;
const execFileAsync = promisify(execFile);

type InventorySource = "steam" | "steam-legacy" | "csfloat" | "cache" | "none";

type InventoryItem = {
  src: string;
  color: string | null;
  name: string;
  source: "steam" | "csfloat";
  href?: string;
};

type InventoryResponse = {
  items: InventoryItem[];
  source: InventorySource;
  error?: string;
};

type SteamTag = {
  category?: string;
  internal_name?: string;
  color?: string;
};

type SteamDescription = {
  icon_url?: string;
  icon_url_large?: string;
  market_name?: string;
  name?: string;
  tags?: SteamTag[];
};

type SteamInventoryPayload = {
  descriptions?: SteamDescription[];
};

type LegacySteamInventoryPayload = {
  rgDescriptions?: Record<string, SteamDescription>;
};

type CsfloatListing = {
  id?: string;
  item?: {
    icon_url?: string;
    market_hash_name?: string;
    item_name?: string;
    wear_name?: string;
    rarity?: number;
  };
};

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

let cachedData: InventoryResponse | null = null;
let cacheTime = 0;

function getRequestHeaders() {
  const agent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    "User-Agent": agent,
    "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://steamcommunity.com/",
  };
}

function rarityToColor(rarity?: number): string | null {
  switch (rarity) {
    case 1:
      return "#b0c3d9";
    case 2:
      return "#5e98d9";
    case 3:
      return "#4b69ff";
    case 4:
      return "#8847ff";
    case 5:
      return "#d32ce6";
    case 6:
      return "#eb4b4b";
    case 7:
      return "#e4ae39";
    default:
      return null;
  }
}

function normalizeSteamDescriptions(
  descriptions: SteamDescription[] | undefined,
): InventoryItem[] {
  if (!descriptions?.length) return [];

  return descriptions
    .filter((description) => description.icon_url || description.icon_url_large)
    .map((description) => {
      const rarityTag = description.tags?.find(
        (tag) =>
          tag.category?.toLowerCase() === "rarity" ||
          tag.internal_name?.includes("Rarity"),
      );

      return {
        src: `${STEAM_IMAGE_BASE}${description.icon_url_large || description.icon_url}`,
        color: rarityTag?.color ? `#${rarityTag.color}` : null,
        name: description.market_name || description.name || "Steam item",
        source: "steam",
      };
    });
}

function normalizeCsfloatListings(listings: CsfloatListing[]): InventoryItem[] {
  if (!Array.isArray(listings)) return [];

  return listings
    .filter((listing) => listing.item?.icon_url)
    .map((listing) => {
      const item = listing.item;
      const name =
        item?.market_hash_name ||
        [item?.item_name, item?.wear_name].filter(Boolean).join(" | ") ||
        "CSFloat listing";

      return {
        src: `${STEAM_IMAGE_BASE}${item?.icon_url}`,
        color: rarityToColor(item?.rarity),
        name,
        source: "csfloat",
        href: listing.id ? `https://csfloat.com/item/${listing.id}` : CSFLOAT_STALL_URL,
      };
    });
}

async function fetchJson<T>(url: string, timeoutMs = 4500): Promise<{ status: number; data: T | null }> {
  const response = await fetch(url, {
    headers: getRequestHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return { status: response.status, data: null };
  }

  return {
    status: response.status,
    data: (await response.json()) as T,
  };
}

async function fetchSteamCommunityInventory(): Promise<InventoryResponse> {
  const communityResult = await fetchJson<SteamInventoryPayload>(STEAM_COMMUNITY_URL);
  const items = normalizeSteamDescriptions(communityResult.data?.descriptions);

  if (!items.length) {
    throw new Error(`Steam community inventory unavailable${communityResult.status ? ` (${communityResult.status})` : ""}.`);
  }

  return { items, source: "steam" };
}

async function fetchSteamLegacyInventory(): Promise<InventoryResponse> {
  const legacyResult = await fetchJson<LegacySteamInventoryPayload>(STEAM_LEGACY_URL);
  const items = normalizeSteamDescriptions(
    legacyResult.data?.rgDescriptions ? Object.values(legacyResult.data.rgDescriptions) : [],
  );

  if (!items.length) {
    throw new Error(`Steam legacy inventory unavailable${legacyResult.status ? ` (${legacyResult.status})` : ""}.`);
  }

  return { items, source: "steam-legacy" };
}

async function fetchCsfloatInventory(): Promise<InventoryResponse> {
  const result = await fetchJson<CsfloatListing[]>(CSFLOAT_LISTINGS_URL);
  const items = normalizeCsfloatListings(result.data ?? []);

  if (!items.length) {
    throw new Error(`CSFloat inventory unavailable${result.status ? ` (${result.status})` : ""}.`);
  }

  return { items, source: "csfloat" };
}

async function fetchSteamCommunityViaPowerShell(): Promise<InventoryResponse> {
  if (process.platform !== "win32") {
    throw new Error("PowerShell fallback unavailable on this platform.");
  }

  const script = `
$ProgressPreference='SilentlyContinue'
$resp = Invoke-WebRequest -Uri '${STEAM_COMMUNITY_URL}' -Headers @{
  'User-Agent'='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  'Accept'='application/json,text/html;q=0.9,*/*;q=0.8'
  'Accept-Language'='en-US,en;q=0.9'
  'Referer'='https://steamcommunity.com/'
} -TimeoutSec 15
$resp.Content
`.trim();

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const payload = JSON.parse(stdout.trim()) as SteamInventoryPayload;
  const items = normalizeSteamDescriptions(payload.descriptions);

  if (!items.length) {
    throw new Error("Steam PowerShell fallback returned no descriptions.");
  }

  return { items, source: "steam" };
}

async function fetchLiveInventory(): Promise<InventoryResponse | null> {
  const attempts = [
    fetchSteamCommunityInventory,
    fetchSteamCommunityViaPowerShell,
    fetchSteamLegacyInventory,
    fetchCsfloatInventory,
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Inventory source failed:", message);
    }
  }

  return null;
}

function jsonResponse(body: InventoryResponse, cacheLabel: string) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "X-Cache": cacheLabel,
      "X-Inventory-Source": body.source,
    },
  });
}

export const GET: APIRoute = async () => {
  const now = Date.now();

  if (cachedData && now - cacheTime < CACHE_DURATION) {
    return jsonResponse(cachedData, "HIT");
  }

  try {
    const liveInventory = await fetchLiveInventory();
    if (liveInventory) {
      cachedData = liveInventory;
      cacheTime = now;
      return jsonResponse(liveInventory, "MISS");
    }

    if (cachedData) {
      return jsonResponse(cachedData, "STALE");
    }

    return jsonResponse(
      {
        items: [],
        source: "none",
        error: "Steam and CSFloat inventory sources are unavailable right now.",
      },
      "EMPTY",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Inventory route error:", message);

    if (cachedData) {
      return jsonResponse(cachedData, "STALE-ERR");
    }

    return jsonResponse(
      {
        items: [],
        source: "none",
        error: message,
      },
      "ERR",
    );
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
