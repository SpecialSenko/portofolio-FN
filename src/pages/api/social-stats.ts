import type { APIRoute } from "astro";

export const prerender = false;

const GITHUB_USERNAME = "fraxb";
const DISCORD_INVITE_CODE = "Xg3Ecpz";
const TWITCH_LOGIN = "Fraxbnezl_Bevtvany";
const CACHE_DURATION = 5 * 60 * 1000;

type SocialStat = {
  value: number | null;
  note: string;
};

type SocialStatsResponse = {
  stats: {
    twitchFollowers: SocialStat;
    twitchSubscribers: SocialStat;
    githubFollowers: SocialStat;
    discordMembers: SocialStat;
    discordOnline: SocialStat;
  };
};

type GitHubUserResponse = {
  followers?: number;
};

type DiscordInviteResponse = {
  approximate_member_count?: number;
  approximate_presence_count?: number;
  guild?: {
    approximate_member_count?: number;
    approximate_presence_count?: number;
    name?: string;
  };
};

type TwitchTokenResponse = {
  access_token?: string;
};

type TwitchUsersResponse = {
  data?: Array<{
    id?: string;
  }>;
};

type TwitchCountResponse = {
  total?: number;
};

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

let cachedData: SocialStatsResponse | null = null;
let cacheTime = 0;

function jsonResponse(body: SocialStatsResponse, cacheLabel: string) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      "X-Cache": cacheLabel,
    },
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

async function fetchGitHubFollowers(): Promise<SocialStat> {
  try {
    const data = await fetchJson<GitHubUserResponse>(`https://api.github.com/users/${GITHUB_USERNAME}`, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "FN-Portfolio",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    return {
      value: typeof data?.followers === "number" ? data.followers : null,
      note: `github.com/${GITHUB_USERNAME}`,
    };
  } catch {
    return {
      value: null,
      note: `github.com/${GITHUB_USERNAME}`,
    };
  }
}

async function fetchDiscordStats(): Promise<{
  members: SocialStat;
  online: SocialStat;
}> {
  const inviteNote = `discord.gg/${DISCORD_INVITE_CODE}`;

  try {
    const data = await fetchJson<DiscordInviteResponse>(
      `https://discord.com/api/v9/invites/${DISCORD_INVITE_CODE}?with_counts=true&with_expiration=true`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "FN-Portfolio",
        },
      },
    );

    const memberCount =
      data?.approximate_member_count ??
      data?.guild?.approximate_member_count ??
      null;
    const onlineCount =
      data?.approximate_presence_count ??
      data?.guild?.approximate_presence_count ??
      null;

    return {
      members: {
        value: memberCount,
        note: inviteNote,
      },
      online: {
        value: onlineCount,
        note: onlineCount === null ? inviteNote : "online right now",
      },
    };
  } catch {
    return {
      members: {
        value: null,
        note: inviteNote,
      },
      online: {
        value: null,
        note: inviteNote,
      },
    };
  }
}

async function fetchTwitchAccessToken(): Promise<string | null> {
  const clientId = import.meta.env.TWITCH_CLIENT_ID;
  const clientSecret = import.meta.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const data = await fetchJson<TwitchTokenResponse>("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return data?.access_token || null;
}

async function resolveTwitchBroadcasterId(
  clientId: string,
  accessToken: string,
): Promise<string | null> {
  const data = await fetchJson<TwitchUsersResponse>(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(TWITCH_LOGIN)}`,
    {
      headers: {
        "Client-Id": clientId,
        "Authorization": `Bearer ${accessToken}`,
      },
    },
  );

  return data?.data?.[0]?.id || null;
}

async function fetchTwitchStats(): Promise<{
  followers: SocialStat;
  subscribers: SocialStat;
}> {
  const clientId = import.meta.env.TWITCH_CLIENT_ID;
  const userToken = import.meta.env.TWITCH_USER_ACCESS_TOKEN;

  if (!clientId) {
    return {
      followers: {
        value: null,
        note: "add Twitch API keys",
      },
      subscribers: {
        value: null,
        note: "add Twitch API keys",
      },
    };
  }

  try {
    const fallbackToken = userToken || (await fetchTwitchAccessToken());
    if (!fallbackToken) {
      return {
        followers: {
          value: null,
          note: "add Twitch API keys",
        },
        subscribers: {
          value: null,
          note: "add Twitch API keys",
        },
      };
    }

    const broadcasterId =
      import.meta.env.TWITCH_BROADCASTER_ID ||
      (await resolveTwitchBroadcasterId(clientId, fallbackToken));

    if (!broadcasterId) {
      return {
        followers: {
          value: null,
          note: "set TWITCH_BROADCASTER_ID",
        },
        subscribers: {
          value: null,
          note: "set TWITCH_BROADCASTER_ID",
        },
      };
    }

    const followerData = await fetchJson<TwitchCountResponse>(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}`,
      {
        headers: {
          "Client-Id": clientId,
          "Authorization": `Bearer ${fallbackToken}`,
        },
      },
    );

    const followerStat: SocialStat = {
      value: typeof followerData?.total === "number" ? followerData.total : null,
      note: "@Fraxbnezl_Bevtvany",
    };

    if (!userToken) {
      return {
        followers: followerStat,
        subscribers: {
          value: null,
          note: "needs TWITCH_USER_ACCESS_TOKEN",
        },
      };
    }

    const subscriberData = await fetchJson<TwitchCountResponse>(
      `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}`,
      {
        headers: {
          "Client-Id": clientId,
          "Authorization": `Bearer ${userToken}`,
        },
      },
    );

    return {
      followers: followerStat,
      subscribers: {
        value: typeof subscriberData?.total === "number" ? subscriberData.total : null,
        note: "@Fraxbnezl_Bevtvany",
      },
    };
  } catch {
    return {
      followers: {
        value: null,
        note: "Twitch API unavailable",
      },
      subscribers: {
        value: null,
        note: "Twitch API unavailable",
      },
    };
  }
}

export const GET: APIRoute = async () => {
  const now = Date.now();

  if (cachedData && now - cacheTime < CACHE_DURATION) {
    return jsonResponse(cachedData, "HIT");
  }

  const [githubFollowers, discordStats, twitchStats] = await Promise.all([
    fetchGitHubFollowers(),
    fetchDiscordStats(),
    fetchTwitchStats(),
  ]);

  const body: SocialStatsResponse = {
    stats: {
      twitchFollowers: twitchStats.followers,
      twitchSubscribers: twitchStats.subscribers,
      githubFollowers,
      discordMembers: discordStats.members,
      discordOnline: discordStats.online,
    },
  };

  cachedData = body;
  cacheTime = now;

  return jsonResponse(body, "MISS");
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
