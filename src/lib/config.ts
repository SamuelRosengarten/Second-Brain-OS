import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export type Config = {
  dataDir: string;
  dbPath: string;
  vaultDir: string;
  attachmentsDir: string;
  importsDir: string;
  exportsDir: string;
  backupsDir: string;
  ollamaUrl: string;
  chatModel: string;
  embedModel: string;
  sessionSecret: string;
  secureCookies: boolean;
  allowedOrigins: string[];
  maxUploadBytes: number;
};

export function getConfig(): Config {
  const env = process.env;
  const dataDir = path.resolve(env.SBOS_DATA_DIR || path.join(os.homedir(), "SecondBrainOS"));
  const secret = env.SBOS_SESSION_SECRET ?? "";
  return {
    dataDir,
    dbPath: path.join(dataDir, "database", "sbos.db"),
    vaultDir: path.join(dataDir, "vault"),
    attachmentsDir: path.join(dataDir, "attachments"),
    importsDir: path.join(dataDir, "imports"),
    exportsDir: path.join(dataDir, "exports"),
    backupsDir: path.join(dataDir, "backups"),
    ollamaUrl: (env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    chatModel: env.SBOS_CHAT_MODEL || "qwen3.5:9b",
    embedModel: env.SBOS_EMBED_MODEL || "nomic-embed-text",
    sessionSecret: secret,
    secureCookies: env.SBOS_SECURE_COOKIES === "1",
    allowedOrigins: (env.SBOS_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    maxUploadBytes: Math.max(1, Number(env.SBOS_MAX_UPLOAD_MB || 25)) * 1024 * 1024,
  };
}

export function ensureDataDirs(cfg: Config = getConfig()): void {
  for (const d of [cfg.dataDir, path.dirname(cfg.dbPath), cfg.vaultDir, cfg.attachmentsDir, cfg.importsDir, cfg.exportsDir, cfg.backupsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** The session secret must be long and not the placeholder from .env.example. */
export function sessionSecretProblem(cfg: Config = getConfig()): string | null {
  if (cfg.sessionSecret.length < 32) return "SBOS_SESSION_SECRET must be set to at least 32 characters.";
  if (cfg.sessionSecret.startsWith("change-me")) return "SBOS_SESSION_SECRET still has the placeholder value.";
  return null;
}
