import crypto from "node:crypto";
import { getConfig, sessionSecretProblem } from "./config.ts";
import { getSetting, setSetting } from "./db.ts";

export const SESSION_COOKIE = "sbos_session";
const SESSION_TTL_S = 7 * 24 * 3600;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function setPassword(password: string): void {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  setSetting("password_hash", hashPassword(password));
}

export const isPasswordSet = (): boolean => getSetting("password_hash") !== null;

/** Key = session secret + password fingerprint, so changing either invalidates every session. */
function signingKey(): Buffer {
  const problem = sessionSecretProblem();
  if (problem) throw new Error(problem);
  const fp = crypto.createHash("sha256").update(getSetting("password_hash") ?? "").digest("hex");
  return crypto.createHmac("sha256", getConfig().sessionSecret).update(fp).digest();
}

export function createSessionToken(now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_S, n: crypto.randomBytes(8).toString("hex") }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || !isPasswordSet()) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", signingKey()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
    return typeof exp === "number" && exp * 1000 > now;
  } catch {
    return false;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // skip malformed cookie
      }
    }
  }
  return out;
}

export function isAuthenticated(cookieHeader: string | null): boolean {
  try {
    return verifySessionToken(parseCookies(cookieHeader)[SESSION_COOKIE]);
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, clear = false): string {
  const parts = [
    `${SESSION_COOKIE}=${clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${clear ? 0 : SESSION_TTL_S}`,
  ];
  if (getConfig().secureCookies) parts.push("Secure");
  return parts.join("; ");
}

// --- login throttling (in-memory; resets on restart) ---
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginAllowed(key: string, now = Date.now()): boolean {
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) return true;
  return a.count < MAX_ATTEMPTS;
}
export function recordLoginFailure(key: string, now = Date.now()): void {
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else a.count++;
}
export const clearLoginFailures = (key: string): void => void attempts.delete(key);
