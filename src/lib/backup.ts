import fs from "node:fs";
import path from "node:path";
import { getConfig, ensureDataDirs } from "./config.ts";
import { closeDb, getDb } from "./db.ts";
import { listProjects, listTasks } from "./projects.ts";
import { PathError, resolveInside } from "./safe-fs.ts";

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

export interface BackupResult { dir: string; name: string; files: number }

/**
 * Backup = consistent SQLite snapshot (online backup API) + plain copies of vault/ and attachments/.
 * The result is an ordinary folder you can copy anywhere; the Markdown files stay readable on their own.
 */
export async function createBackup(): Promise<BackupResult> {
  const cfg = getConfig();
  ensureDataDirs(cfg);
  const name = `backup-${stamp()}`;
  const dir = path.join(cfg.backupsDir, name);
  fs.mkdirSync(dir, { recursive: false });
  await getDb().backup(path.join(dir, "sbos.db"));
  fs.cpSync(cfg.vaultDir, path.join(dir, "vault"), { recursive: true });
  fs.cpSync(cfg.attachmentsDir, path.join(dir, "attachments"), { recursive: true });
  fs.cpSync(cfg.importsDir, path.join(dir, "imports"), { recursive: true });
  const files = countFiles(dir);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ app: "second-brain-os", version: 1, created: new Date().toISOString(), files }, null, 2));
  return { dir, name, files };
}

function countFiles(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}

export function listBackups(): { name: string; created: string }[] {
  const cfg = getConfig();
  if (!fs.existsSync(cfg.backupsDir)) return [];
  return fs
    .readdirSync(cfg.backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(cfg.backupsDir, e.name, "manifest.json")))
    .map((e) => ({ name: e.name, created: fs.statSync(path.join(cfg.backupsDir, e.name)).mtime.toISOString() }))
    .sort((a, b) => b.created.localeCompare(a.created));
}

/**
 * Restore a backup folder over the current data. The application must be stopped (the CLI script enforces this by
 * opening the DB exclusively). The current state is first copied to backups/pre-restore-<stamp>.
 */
export function restoreBackup(backupName: string): { safetyCopy: string } {
  const cfg = getConfig();
  const src = resolveInside(cfg.backupsDir, backupName);
  if (!fs.existsSync(path.join(src, "manifest.json")) || !fs.existsSync(path.join(src, "sbos.db"))) {
    throw new PathError(`"${backupName}" is not a valid backup folder (manifest.json / sbos.db missing).`);
  }
  closeDb();
  const safety = path.join(cfg.backupsDir, `pre-restore-${stamp()}`);
  fs.mkdirSync(safety, { recursive: true });
  for (const [from, to] of [[cfg.dbPath, "sbos.db"], [cfg.vaultDir, "vault"], [cfg.attachmentsDir, "attachments"], [cfg.importsDir, "imports"]] as const) {
    if (fs.existsSync(from)) fs.cpSync(from, path.join(safety, to), { recursive: true });
  }
  // Drop WAL/SHM leftovers so the restored DB is read as-is.
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(cfg.dbPath + suffix, { force: true });
  fs.copyFileSync(path.join(src, "sbos.db"), cfg.dbPath);
  for (const [dirName, target] of [["vault", cfg.vaultDir], ["attachments", cfg.attachmentsDir], ["imports", cfg.importsDir]] as const) {
    const from = path.join(src, dirName);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(from, target, { recursive: true });
  }
  return { safetyCopy: safety };
}

/** Export notes as plain Markdown files (+ JSON for projects/tasks) into exports/<stamp>/. */
export function exportAll(): { dir: string; notes: number } {
  const cfg = getConfig();
  ensureDataDirs(cfg);
  const dir = path.join(cfg.exportsDir, `export-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(cfg.vaultDir, path.join(dir, "notes"), { recursive: true, filter: (s) => !s.includes(`${path.sep}.trash`) });
  fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify(listProjects(), null, 2));
  fs.writeFileSync(path.join(dir, "tasks.json"), JSON.stringify(listTasks({ limit: 500 }), null, 2));
  const notes = (getDb().prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number }).c;
  return { dir, notes };
}
