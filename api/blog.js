import crypto from "node:crypto";

import {
  blogStorageMode,
  BlogStorageUnavailableError,
  listBlogPosts,
  normalizeBlogPost,
  saveBlogPosts,
} from "./_lib/blog-store.js";
import { readSession } from "./_lib/session.js";

const MAX_BODY_BYTES = 16_384;

function sendJson(res, status, data, { headers = {} } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "private, no-store");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(data));
}

function ownerSteamId() {
  const value = String(process.env.FN_OWNER_STEAM_ID || process.env.STEAM_TRADE_OWNER_ID || "").trim();
  return /^\d{17}$/.test(value) ? value : "";
}

function sessionFor(req) {
  return readSession(req.headers?.cookie || null);
}

function canManageBlog(req) {
  const owner = ownerSteamId();
  const session = sessionFor(req);
  return Boolean(owner && session?.steamid === owner);
}

async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    const bodyText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
    return bodyText ? JSON.parse(bodyText) : {};
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  const bodyText = Buffer.concat(chunks).toString("utf8");
  return bodyText ? JSON.parse(bodyText) : {};
}

function requireOwner(req, res) {
  const owner = ownerSteamId();
  if (!owner) {
    sendJson(res, 503, { error: "FN blog owner is not configured", code: "BLOG_OWNER_NOT_CONFIGURED" });
    return false;
  }
  const session = sessionFor(req);
  if (!session) {
    sendJson(res, 401, { error: "Connect Steam to manage the FN blog", code: "AUTH_REQUIRED" });
    return false;
  }
  if (session.steamid !== owner) {
    sendJson(res, 403, { error: "Only the FN owner can manage this blog", code: "BLOG_OWNER_ONLY" });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const posts = await listBlogPosts();
      sendJson(res, 200, {
        posts,
        canManage: canManageBlog(req),
        persistent: !["disabled", "unavailable"].includes(blogStorageMode()),
      }, { headers: { Vary: "Cookie" } });
    } catch {
      sendJson(res, 502, { error: "FN blog is temporarily unavailable", code: "BLOG_UNAVAILABLE" });
    }
    return;
  }

  if (!["POST", "DELETE"].includes(req.method)) {
    sendJson(res, 405, { error: "Method not allowed" }, { headers: { Allow: "GET, POST, DELETE" } });
    return;
  }
  if (!requireOwner(req, res)) return;

  try {
    const posts = await listBlogPosts();
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const post = normalizeBlogPost({
        id: crypto.randomUUID(),
        title: body?.title,
        body: body?.body,
        category: body?.category,
        imageUrl: body?.imageUrl,
        linkUrl: body?.linkUrl,
        createdAt: Date.now(),
      });
      if (!post) {
        sendJson(res, 400, { error: "A title and post body are required", code: "INVALID_POST" });
        return;
      }
      const saved = await saveBlogPosts([post, ...posts]);
      sendJson(res, 201, { post, posts: saved }, { headers: { Vary: "Cookie" } });
      return;
    }

    const requestUrl = new URL(req.url || "/api/blog", "http://local");
    const id = String(requestUrl.searchParams.get("id") || "");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
      sendJson(res, 400, { error: "A valid blog post ID is required", code: "INVALID_POST_ID" });
      return;
    }
    const remaining = posts.filter((post) => post.id !== id);
    if (remaining.length === posts.length) {
      sendJson(res, 404, { error: "Blog post not found", code: "POST_NOT_FOUND" });
      return;
    }
    const saved = await saveBlogPosts(remaining);
    sendJson(res, 200, { posts: saved }, { headers: { Vary: "Cookie" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "Request body must be valid JSON", code: "INVALID_JSON" });
      return;
    }
    if (error instanceof RangeError) {
      sendJson(res, 413, { error: error.message, code: "BODY_TOO_LARGE" });
      return;
    }
    if (error instanceof BlogStorageUnavailableError) {
      sendJson(res, 503, { error: "Persistent blog storage is not configured", code: "STORAGE_NOT_CONFIGURED" });
      return;
    }
    sendJson(res, 502, { error: "FN blog could not be updated", code: "BLOG_UPDATE_FAILED" });
  }
}
