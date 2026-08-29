import authHandler from "./_lib/physical-auth-handler.js";
import listingsHandler from "./_lib/physical-listings-handler.js";
import supporterHandler from "./_lib/physical-supporter-handler.js";
import supporterWebhookHandler from "./_lib/physical-supporter-webhook-handler.js";

const handlers = {
  auth: authHandler,
  listings: listingsHandler,
  supporter: supporterHandler,
  "supporter-webhook": supporterWebhookHandler,
};

export default async function handler(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
  const action = String(req.query?.action || requestUrl.searchParams.get("action") || requestUrl.pathname.split("/").filter(Boolean).at(-1));
  const route = handlers[action];
  if (!route) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Physical marketplace route not found" }));
    return;
  }
  await route(req, res);
}
