import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

loadEnvFile(path.join(root, ".env.local"));
process.env.NODE_ENV ||= "development";
process.env.SESSION_SECRET ||= "dev-only-local-steam-session-secret-change-before-deploy";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const host = args.get("--host") || process.env.HOST || "0.0.0.0";
const port = Number(args.get("--port") || process.env.PORT || 4321);

const routes = new Map([
  ["/api/currency", path.join(root, "api/currency.js")],
  ["/api/marketplace/stores", path.join(root, "api/marketplace/stores.js")],
  ["/api/marketplace/bids", path.join(root, "api/marketplace/bids.js")],
  ["/api/physical/auth", path.join(root, "api/physical/auth.js")],
  ["/api/physical/listings", path.join(root, "api/physical/listings.js")],
  ["/api/physical/supporter", path.join(root, "api/physical/supporter.js")],
  ["/api/physical/supporter-webhook", path.join(root, "api/physical/supporter-webhook.js")],
  ["/api/auth/me", path.join(root, "api/auth/me.js")],
  ["/api/auth/steam/login", path.join(root, "api/auth/steam/login.js")],
  ["/api/auth/steam/callback", path.join(root, "api/auth/steam/callback.js")],
  ["/api/steam/games", path.join(root, "api/steam/games.js")],
  ["/api/steam/inventory", path.join(root, "api/steam/inventory.js")],
  ["/api/steam/trades", path.join(root, "api/steam/trades.js")],
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// Optionally serve HTTPS when TLS files are provided (env or cert/key files in project root)
const tlsKeyPath = process.env.TLS_KEY_PATH || path.join(root, "key.pem");
const tlsCertPath = process.env.TLS_CERT_PATH || path.join(root, "cert.pem");

let server;
const httpHandler = async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    const routeFile = routes.get(requestUrl.pathname);

    if (routeFile) {
      const mod = await import(`${pathToFileURL(routeFile).href}?t=${Date.now()}`);
      await mod.default(req, res);
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Internal server error");
  }
};

if (fs.existsSync(tlsKeyPath) && fs.existsSync(tlsCertPath)) {
  try {
    const key = fs.readFileSync(tlsKeyPath);
    const cert = fs.readFileSync(tlsCertPath);
    server = https.createServer({ key, cert }, httpHandler);
  } catch (err) {
    console.error("Failed to read TLS cert/key, falling back to HTTP:", err.message);
    server = http.createServer(httpHandler);
  }
} else {
  server = http.createServer(httpHandler);
}

server.listen(port, host, () => {
  console.log(`Local:   http://localhost:${port}/`);
  if (host === "0.0.0.0") {
    console.log(`Network: http://<your-lan-ip>:${port}/`);
  } else {
    console.log(`Network: http://${host}:${port}/`);
  }
  console.log("Steam auth API: /api/auth/steam/login");
  console.log("Note: this local server serves plain HTTP. If you access it via https://<lan-ip> your browser will show ERR_SSL_PROTOCOL_ERROR. Use http:// or configure TLS separately.");
  console.log("Local seller API: /api/physical/auth");
});

async function serveStatic(urlPath, res) {
  const decodedPath = decodeURIComponent(urlPath);
  const requested = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const publicRoot = path.join(root, "public");
  const candidates = [path.resolve(root, requested), path.resolve(publicRoot, requested)];
  const finalPath = candidates.find((candidate, index) => {
    const base = index === 0 ? root : publicRoot;
    const allowed = candidate === base || candidate.startsWith(`${base}${path.sep}`);
    return allowed && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  }) || path.join(root, "index.html");

  const ext = path.extname(finalPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
  fs.createReadStream(finalPath).pipe(res);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
