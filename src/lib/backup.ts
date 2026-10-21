import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENCRYPTED_EXT } from "./backup-crypto.ts";
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

const BACKUP_NAME = /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

/**
 * Keep only the newest `keep` automatic backups in `dir`. Only backup folders that match the naming pattern AND contain
 * manifest.json, plus matching `.sbosenc` encrypted files, are ever considered; pre-restore-* safety copies and anything else
 * are never touched. A folder and its encrypted twin count as one backup.
 */
export function pruneBackups(dir: string, keep: number): string[] {
  if (!fs.existsSync(dir) || keep < 1) return [];
  const names = new Set<string>();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && BACKUP_NAME.test(e.name) && fs.existsSync(path.join(dir, e.name, "manifest.json"))) names.add(e.name);
    else if (e.isFile() && e.name.endsWith(ENCRYPTED_EXT) && BACKUP_NAME.test(e.name.slice(0, -ENCRYPTED_EXT.length))) names.add(e.name.slice(0, -ENCRYPTED_EXT.length));
  }
  const candidates = [...names].sort(); // timestamp names sort chronologically
  const doomed = candidates.slice(0, Math.max(0, candidates.length - keep));
  for (const name of doomed) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    fs.rmSync(path.join(dir, name + ENCRYPTED_EXT), { force: true });
  }
  return doomed;
}

/** Copy a finished backup folder (or an encrypted backup file) to another location, e.g. a second drive. Never overwrites an existing copy. */
export function copyBackupTo(backupDir: string, destRoot: string): string {
  const dest = path.join(path.resolve(destRoot), path.basename(backupDir));
  if (fs.existsSync(dest)) throw new PathError(`"${dest}" already exists; refusing to overwrite.`);
  fs.mkdirSync(path.resolve(destRoot), { recursive: true });
  fs.cpSync(backupDir, dest, { recursive: true });
  return dest;
}

export interface VerifyResult { ok: boolean; problems: string[]; warnings: string[]; counts: Record<string, number>; files: number }

/**
 * Check that a backup folder is usable without touching live data: manifest present, file count matches the manifest,
 * SQLite integrity_check passes (opened read-only), the core tables are readable, and the Markdown files agree with the notes table.
 */
export function verifyBackup(dir: string): VerifyResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const files = fs.existsSync(dir) ? countFiles(dir) : 0;
  const manifestPath = path.join(dir, "manifest.json");
  const dbFile = path.join(dir, "sbos.db");
  if (!fs.existsSync(manifestPath)) problems.push("manifest.json is missing.");
  else {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { files?: number };
      if (typeof m.files === "number" && m.files + 1 !== files) problems.push(`File count differs from the manifest (${files} found, ${m.files + 1} expected): files are missing or extra.`);
    } catch {
      problems.push("manifest.json is not valid JSON.");
    }
  }
  if (!fs.existsSync(dbFile)) problems.push("sbos.db is missing.");
  else {
    // Check a temporary copy: opening a WAL-mode database writes -wal/-shm files, and a check must never alter the backup.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-verify-db-"));
    let db: Database.Database | null = null;
    try {
      fs.copyFileSync(dbFile, path.join(scratch, "sbos.db"));
      db = new Database(path.join(scratch, "sbos.db"), { readonly: true, fileMustExist: true });
      const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") problems.push(`SQLite integrity_check failed: ${integrity.map((r) => r.integrity_check).slice(0, 3).join("; ")}`);
      for (const t of ["notes", "captures", "projects", "tasks"]) {
        try {
          counts[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
        } catch {
          problems.push(`Table "${t}" cannot be read.`);
        }
      }
    } catch (e) {
      problems.push(`Database cannot be opened: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      db?.close();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  const md = countMarkdown(path.join(dir, "vault"));
  counts.markdownFiles = md;
  if (counts.notes !== undefined && md !== counts.notes) warnings.push(`${counts.notes} notes in the database but ${md} Markdown files in the vault (a reindex fixes drift).`);
  return { ok: problems.length === 0, problems, warnings, counts, files };
}

function countMarkdown(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".trash") continue;
    n += e.isDirectory() ? countMarkdown(path.join(dir, e.name)) : e.name.endsWith(".md") ? 1 : 0;
  }
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
export function restoreBackup(backupName: string, opts: { fromDir?: string } = {}): { safetyCopy: string } {
  const cfg = getConfig();
  // `fromDir` is a backup folder anywhere on disk (e.g. the copy on D:); otherwise the name is looked up inside backupsDir.
  const src = opts.fromDir ? path.resolve(opts.fromDir) : resolveInside(cfg.backupsDir, backupName);
  if (!fs.existsSync(path.join(src, "manifest.json")) || !fs.existsSync(path.join(src, "sbos.db"))) {
    throw new PathError(`"${opts.fromDir ?? backupName}" is not a valid backup folder (manifest.json / sbos.db missing).`);
  }
  const check = verifyBackup(src);
  if (!check.ok) throw new PathError(`Refusing to restore a damaged backup: ${check.problems.join(" ")}`);
  closeDb();
  ensureDataDirs(cfg); // a restore onto a fresh machine has no data folders yet
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
