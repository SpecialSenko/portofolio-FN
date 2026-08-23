import { clearSessionCookie, readSession } from "../_lib/session.js";

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const session = readSession(req.headers.cookie || null);

    if (!session) {
      sendJson(res, 200, { loggedIn: false });
      return;
    }

    sendJson(res, 200, {
      loggedIn: true,
      steamid: session.steamid,
      name: session.name,
      avatar: session.avatar,
    });
    return;
  }

  if (req.method === "POST") {
    sendJson(res, 200, { loggedIn: false }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
}
