import crypto from "node:crypto";
import { ymd } from "./dates.ts";

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
export const sha256 = (data: string | Buffer): string => crypto.createHash("sha256").update(data).digest("hex");

/** Normalised hash used for duplicate-submission detection. */
export const contentHash = (text: string): string => sha256(text.trim().replace(/\s+/g, " ").toLowerCase());

/** The server's local date. Requests from a browser pass their own date instead (see `?today=`). */
export const todayLocal = (d = new Date()): string => ymd(d);

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  // Structured, single-line JSON. Callers must never pass note/capture content here.
  if (process.env.VITEST && !process.env.SBOS_LOG_TESTS) return;
  const line = JSON.stringify({ t: nowIso(), level, event, ...fields });
  (level === "error" ? console.error : console.log)(line);
}
