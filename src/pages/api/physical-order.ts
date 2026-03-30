import type { APIRoute } from "astro";
import { PHYSICAL_ORDER_REDIRECT_PATH } from "../../data/storeConfig";

export const prerender = false;

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISCORD_WEBHOOK_URL = import.meta.env.DISCORD_STORE_WEBHOOK_URL;
const DEFAULT_REDIRECT_PATH = PHYSICAL_ORDER_REDIRECT_PATH;

const clean = (value: unknown) => String(value ?? "").trim();

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({
    ok: false,
    error: "Use POST to submit a physical order.",
  }), {
    status: 405,
    headers: {
      ...CORS_HEADERS,
      Allow: "POST, OPTIONS",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    const payload = {
      itemTitle: clean(body.itemTitle) || "Physical Package",
      redirectPath: clean(body.redirectPath) || DEFAULT_REDIRECT_PATH,
      fullName: clean(body.fullName),
      addressLine1: clean(body.addressLine1),
      addressLine2: clean(body.addressLine2),
      city: clean(body.city),
      state: clean(body.state),
      postalCode: clean(body.postalCode),
      country: clean(body.country),
      discordHandle: clean(body.discordHandle),
    };

    if (!payload.fullName || !payload.addressLine1 || !payload.city || !payload.state || !payload.postalCode || !payload.country) {
      return new Response(JSON.stringify({ ok: false, error: "Please fill the full shipping address first." }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (!DISCORD_WEBHOOK_URL) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Set DISCORD_STORE_WEBHOOK_URL before using physical checkout.",
      }), {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    const addressLines = [
      payload.addressLine1,
      payload.addressLine2,
      `${payload.city}, ${payload.state} ${payload.postalCode}`.trim(),
      payload.country,
    ].filter(Boolean);

    const discordPayload = {
      username: "FN Store Orders",
      embeds: [
        {
          title: `Physical order: ${payload.itemTitle}`,
          color: 3447003,
          fields: [
            { name: "Name", value: payload.fullName, inline: false },
            { name: "Address", value: addressLines.join("\n"), inline: false },
            { name: "Discord", value: payload.discordHandle || "Not provided", inline: false },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const webhookResponse = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(discordPayload),
    });

    if (!webhookResponse.ok) {
      throw new Error(`Discord ${webhookResponse.status}`);
    }

    return new Response(JSON.stringify({
      ok: true,
      redirectUrl: payload.redirectPath,
    }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    return new Response(JSON.stringify({
      ok: false,
      error: message || "Unable to submit physical order.",
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
