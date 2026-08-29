import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const COST = 16_384;

export async function hashPhysicalPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEY_LENGTH, { N: COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${COST}$8$1$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

export async function verifyPhysicalPassword(password, encoded) {
  const [algorithm, cost, r, p, saltValue, hashValue] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(String(password), Buffer.from(saltValue, "base64url"), KEY_LENGTH, {
    N: Number(cost),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(Buffer.from(actual), expected);
}
