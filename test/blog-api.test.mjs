import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import blogHandler from "../api/blog.js";
import { listBlogPosts, saveBlogPosts } from "../api/_lib/blog-store.js";
import { createSessionCookie } from "../api/_lib/session.js";

process.env.SESSION_SECRET = "fn-blog-test-secret-with-enough-entropy";

const ownerSteamId = "76561198000000041";
const visitorSteamId = "76561198000000042";

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(body = "") {
      this.body = body;
    },
    headers,
    body: "",
  };
}

function sessionCookie(steamid) {
  return createSessionCookie({
    steamid,
    name: "Steam User",
    avatar: "",
    issuedAt: Date.now(),
  }).split(";")[0];
}

async function invoke({ method = "GET", url = "/api/blog", cookie = "", body } = {}) {
  const req = { method, url, headers: { cookie }, body };
  const res = responseRecorder();
  await blogHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("FN blog is public and only its Steam owner can create or remove posts", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOwner = process.env.FN_OWNER_STEAM_ID;
  const originalTradeOwner = process.env.STEAM_TRADE_OWNER_ID;
  const originalDataFile = process.env.BLOG_DATA_FILE;
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-blog-"));

  process.env.NODE_ENV = "development";
  process.env.FN_OWNER_STEAM_ID = ownerSteamId;
  process.env.BLOG_DATA_FILE = path.join(directory, "blog.json");
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const publicBlog = await invoke();
    assert.equal(publicBlog.status, 200);
    assert.equal(publicBlog.body.canManage, false);
    assert.deepEqual(publicBlog.body.posts, []);

    const denied = await invoke({
      method: "POST",
      cookie: sessionCookie(visitorSteamId),
      body: { title: "Nope", body: "Visitors cannot publish." },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "BLOG_OWNER_ONLY");

    const created = await invoke({
      method: "POST",
      cookie: sessionCookie(ownerSteamId),
      body: {
        title: "First FN update",
        body: "This post is public.",
        category: "project",
        imageUrl: "javascript:alert(1)",
        linkUrl: "https://example.com/project",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.post.title, "First FN update");
    assert.equal(created.body.post.category, "project");
    assert.equal(created.body.post.imageUrl, "");
    assert.equal(created.body.post.linkUrl, "https://example.com/project");

    const ownerBlog = await invoke({ cookie: sessionCookie(ownerSteamId) });
    assert.equal(ownerBlog.status, 200);
    assert.equal(ownerBlog.body.canManage, true);
    assert.equal(ownerBlog.body.posts.length, 1);

    const anonymousDelete = await invoke({ method: "DELETE", url: `/api/blog?id=${created.body.post.id}` });
    assert.equal(anonymousDelete.status, 401);

    const removed = await invoke({
      method: "DELETE",
      url: `/api/blog?id=${created.body.post.id}`,
      cookie: sessionCookie(ownerSteamId),
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.posts, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOwner === undefined) delete process.env.FN_OWNER_STEAM_ID;
    else process.env.FN_OWNER_STEAM_ID = originalOwner;
    if (originalTradeOwner === undefined) delete process.env.STEAM_TRADE_OWNER_ID;
    else process.env.STEAM_TRADE_OWNER_ID = originalTradeOwner;
    if (originalDataFile === undefined) delete process.env.BLOG_DATA_FILE;
    else process.env.BLOG_DATA_FILE = originalDataFile;
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalToken;
  }
});

test("FN blog persistence uses server-only Upstash credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;
  const calls = [];
  let stored = null;

  process.env.NODE_ENV = "production";
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "server-only-blog-token";
  globalThis.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    calls.push({ url: String(url), authorization: options.headers.Authorization, command });
    if (command[0] === "SET") {
      stored = command[2];
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    }
    if (command[0] === "GET") {
      return new Response(JSON.stringify({ result: stored }), { status: 200 });
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`);
  };

  try {
    const post = {
      id: "blog-post-001",
      title: "Stored FN post",
      body: "Persisted safely.",
      category: "update",
      imageUrl: "",
      linkUrl: "",
      createdAt: 100,
    };
    await saveBlogPosts([post]);
    const posts = await listBlogPosts();

    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, "Stored FN post");
    assert.equal(calls[0].url, "https://example.upstash.io");
    assert.equal(calls[0].authorization, "Bearer server-only-blog-token");
    assert.deepEqual(calls[0].command.slice(0, 2), ["SET", "fraxb:blog:posts"]);
    assert.deepEqual(calls[1].command, ["GET", "fraxb:blog:posts"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalToken;
  }
});
