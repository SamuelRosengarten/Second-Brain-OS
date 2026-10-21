import crypto from "node:crypto";

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
export const sha256 = (data: string | Buffer): string => crypto.createHash("sha256").update(data).digest("hex");

/** Normalised hash used for duplicate-submission detection. */
export const contentHash = (text: string): string => sha256(text.trim().replace(/\s+/g, " ").toLowerCase());

export function todayLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  // Structured, single-line JSON. Callers must never pass note/capture content here.
  if (process.env.VITEST && !process.env.SBOS_LOG_TESTS) return;
  const line = JSON.stringify({ t: nowIso(), level, event, ...fields });
  (level === "error" ? console.error : console.log)(line);
}
