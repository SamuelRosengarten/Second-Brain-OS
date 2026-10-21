import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureDataDirs, getConfig } from "./config.ts";

let current: { file: string; db: Database.Database } | null = null;

function migrationsDir(): string {
  return path.join(process.cwd(), "migrations");
}

export function runMigrations(db: Database.Database): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name));
  const files = fs.readdirSync(migrationsDir()).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
    })();
    ran.push(f);
  }
  return ran;
}

export function getDb(): Database.Database {
  const cfg = getConfig();
  if (current && current.file === cfg.dbPath) return current.db;
  closeDb();
  ensureDataDirs(cfg);
  const db = new Database(cfg.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  current = { file: cfg.dbPath, db };
  return db;
}

export function closeDb(): void {
  if (current) {
    try { current.db.close(); } catch { /* already closed */ }
    current = null;
  }
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}
