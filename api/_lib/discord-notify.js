function webhookUrl() {
  const value = String(process.env.DISCORD_MARKETPLACE_WEBHOOK_URL || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const validHost = url.hostname === "discord.com" || url.hostname === "discordapp.com";
    return url.protocol === "https:" && validHost && url.pathname.startsWith("/api/webhooks/") ? url.href : "";
  } catch {
    return "";
  }
}

export async function notifyMarketplaceDiscord({ title, description, fields = [] }) {
  const url = webhookUrl();
  if (!url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Fraxb Marketplace",
        allowed_mentions: { parse: [] },
        embeds: [{
          title: String(title || "Marketplace update").slice(0, 256),
          description: String(description || "").slice(0, 4_096),
          color: 0x35e7a0,
          fields: fields.slice(0, 10).map((field) => ({
            name: String(field.name || "Details").slice(0, 256),
            value: String(field.value || "-").slice(0, 1_024),
            inline: Boolean(field.inline),
          })),
          timestamp: new Date().toISOString(),
        }],
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
