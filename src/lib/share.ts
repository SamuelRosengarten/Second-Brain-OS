import crypto from "node:crypto";
import { z } from "zod";
import { ApiError } from "./api.ts";
import { loginAllowed, recordLoginFailure } from "./auth.ts";
import { createCapture, type CreateCaptureResult } from "./captures.ts";
import { getConfig } from "./config.ts";

export const MIN_CAPTURE_TOKEN = 32;

export const ShareBody = z.object({
  title: z.string().max(500).optional(),
  text: z.string().max(200_000).optional(),
  url: z.string().max(2000).optional(),
});

/** Constant-time comparison of the presented bearer token against SBOS_CAPTURE_TOKEN. */
export function captureTokenMatches(presented: string): boolean {
  const expected = getConfig().captureToken;
  if (expected.length < MIN_CAPTURE_TOKEN) return false;
  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Authorise a share request: Bearer token only, with the same failure throttle as login. */
export function assertCaptureToken(req: Request): void {
  const cfg = getConfig();
  if (cfg.captureToken.length < MIN_CAPTURE_TOKEN) throw new ApiError(404, "Share capture is not enabled.", "disabled");
  if (!loginAllowed("share")) throw new ApiError(429, "Too many failed attempts. Try again later.", "throttled");
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || !captureTokenMatches(m[1].trim())) {
    recordLoginFailure("share");
    throw new ApiError(401, "Invalid capture token", "unauthenticated");
  }
}

const URL_ONLY = /^https?:\/\/\S+$/i;

/** Turn what the iOS share sheet gives us (a title, some text, a link, or just a URL as text) into a capture. */
export async function createShareCapture(b: z.infer<typeof ShareBody>): Promise<CreateCaptureResult> {
  const title = (b.title ?? "").trim();
  let text = (b.text ?? "").trim();
  let url = (b.url ?? "").trim();
  if (!url && URL_ONLY.test(text)) {
    url = text;
    text = "";
  }
  const content = [title, text].filter((p, i, all) => p && all.indexOf(p) === i).join("\n\n");
  return createCapture({ kind: url && !text ? "link" : "text", content, url, autoProcess: true });
}
