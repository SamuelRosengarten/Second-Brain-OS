import crypto from "node:crypto";
import { getConfig, sessionSecretProblem } from "./config.ts";
import { deleteSetting, getSetting, setSetting } from "./db.ts";

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

// --- capture token: a bearer credential that can ONLY create captures (for an iOS Shortcut) ---
const CAPTURE_TOKEN_PREFIX = "sbos_cap_";

/** HMAC under the session signing key, so changing the password or SBOS_SESSION_SECRET also revokes the token. */
const captureTokenDigest = (token: string): string => crypto.createHmac("sha256", signingKey()).update(token).digest("hex");

/** Creates (or replaces) the token. The plain value is returned once and never stored. */
export function createCaptureToken(now = new Date()): { token: string; createdAt: string } {
  const token = CAPTURE_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  setSetting("capture_token_digest", captureTokenDigest(token));
  setSetting("capture_token_created", now.toISOString());
  return { token, createdAt: now.toISOString() };
}

export function revokeCaptureToken(): void {
  deleteSetting("capture_token_digest");
  deleteSetting("capture_token_created");
}

export function captureTokenStatus(): { enabled: boolean; createdAt: string | null } {
  return { enabled: getSetting("capture_token_digest") !== null, createdAt: getSetting("capture_token_created") };
}

export function verifyCaptureToken(token: string): boolean {
  try {
    const stored = getSetting("capture_token_digest");
    if (!stored || !token.startsWith(CAPTURE_TOKEN_PREFIX)) return false;
    const a = Buffer.from(captureTokenDigest(token), "hex");
    const b = Buffer.from(stored, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false; // no usable session secret
  }
}

/** The credential from `Authorization: Bearer <token>`, or null when the header is absent or not a bearer. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}
