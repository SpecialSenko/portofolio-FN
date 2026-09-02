import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOG_KEY = "fraxb:blog:posts";
const MAX_POSTS = 100;
const STORAGE_TIMEOUT_MS = 4_000;
const defaultLocalFile = fileURLToPath(new URL("../../.data/blog.json", import.meta.url));
const categories = new Set(["update", "project", "journal", "video"]);
let localWriteQueue = Promise.resolve();

export class BlogStorageUnavailableError extends Error {
  constructor() {
    super("Blog storage is not configured");
    this.name = "BlogStorageUnavailableError";
  }
}

function redisConfig() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

function storageMode() {
  if (process.env.BLOG_STORAGE_DISABLED === "1") return "disabled";
  if (redisConfig()) return "redis";
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return "unavailable";
  return "local";
}

function localFilePath() {
  const configured = String(process.env.BLOG_DATA_FILE || "").trim();
  return configured ? path.resolve(configured) : defaultLocalFile;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function cleanBody(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 5_000);
}

function safeHttpsUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href.slice(0, 1_000) : "";
  } catch {
    return "";
  }
}

export function normalizeBlogPost(value) {
  const id = String(value?.id || "");
  const title = cleanText(value?.title, 120);
  const body = cleanBody(value?.body);
  const createdAt = Number(value?.createdAt);
  if (
    !/^[a-zA-Z0-9_-]{8,80}$/.test(id)
    || !title
    || !body
    || !Number.isFinite(createdAt)
    || createdAt < 0
    || createdAt > 8_640_000_000_000_000
  ) return null;
  return {
    id,
    title,
    body,
    category: categories.has(value?.category) ? value.category : "update",
    imageUrl: safeHttpsUrl(value?.imageUrl),
    linkUrl: safeHttpsUrl(value?.linkUrl),
    videoUrl: safeHttpsUrl(value?.videoUrl),
    createdAt,
  };
}

function normalizePosts(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeBlogPost)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_POSTS);
}

async function redisCommand(command) {
  const config = redisConfig();
  if (!config) throw new BlogStorageUnavailableError();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error("Blog storage request failed");
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLocalPosts() {
  try {
    return normalizePosts(JSON.parse(await fs.readFile(localFilePath(), "utf8"))?.posts);
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeLocalPosts(posts) {
  const filePath = localFilePath();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify({ posts }, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function withLocalWrite(operation) {
  const pending = localWriteQueue.then(operation, operation);
  localWriteQueue = pending.catch(() => {});
  return pending;
}

export function blogStorageMode() {
  return storageMode();
}

export async function listBlogPosts() {
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") return [];
  if (mode === "redis") {
    const stored = await redisCommand(["GET", BLOG_KEY]);
    if (typeof stored !== "string") return [];
    try {
      return normalizePosts(JSON.parse(stored));
    } catch {
      return [];
    }
  }
  return readLocalPosts();
}

export async function saveBlogPosts(posts) {
  const normalized = normalizePosts(posts);
  const mode = storageMode();
  if (mode === "disabled" || mode === "unavailable") throw new BlogStorageUnavailableError();
  if (mode === "redis") {
    await redisCommand(["SET", BLOG_KEY, JSON.stringify(normalized)]);
    return normalized;
  }
  return withLocalWrite(async () => {
    await writeLocalPosts(normalized);
    return normalized;
  });
}
