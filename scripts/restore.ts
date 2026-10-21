import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./_env.ts";
loadEnv();
const { restoreBackup, listBackups, verifyBackup } = await import("../src/lib/backup.ts");
const { decryptBackup, ENCRYPTED_EXT } = await import("../src/lib/backup-crypto.ts");
const { getConfig, ensureDataDirs } = await import("../src/lib/config.ts");

// Usage: npm run restore -- <name | folder path | file.sbosenc> [--verify] [--yes] [--ignore-running]
//   --verify          only check the backup (integrity, counts); changes nothing and the app may keep running.
//   --ignore-running  skip the "app is on port 3000" guard; only for a rehearsal into a scratch SBOS_DATA_DIR.
const source = process.argv[2];
const verifyOnly = process.argv.includes("--verify");
if (!source || source.startsWith("--")) {
  console.log("Usage: npm run restore -- <backup-folder-name | path-to-folder | path-to-.sbosenc> [--verify] [--yes]\n\nAvailable backups in " + getConfig().backupsDir + ":");
  for (const b of listBackups()) console.log(`  ${b.name}   (${b.created})`);
  process.exit(source ? 1 : 0);
}

const isPath = /[\\/]/.test(source) || source.endsWith(ENCRYPTED_EXT) || /^[a-zA-Z]:/.test(source);
let tempRoot: string | null = null;

async function main(): Promise<void> {
  let fromDir: string | undefined;
  let name = source;
  if (isPath) {
    const abs = path.resolve(source);
    if (!fs.existsSync(abs)) throw new Error(`"${abs}" does not exist.`);
    if (abs.endsWith(ENCRYPTED_EXT)) {
      ensureDataDirs(); // a fresh machine has no data folders yet
      tempRoot = fs.mkdtempSync(path.join(getConfig().backupsDir, ".restore-tmp-"));
      console.log("Decrypting (this takes a few seconds)...");
      fromDir = await decryptBackup(abs, process.env.SBOS_BACKUP_PASSPHRASE, tempRoot);
    } else fromDir = abs;
    name = path.basename(fromDir);
  }

  const dir = fromDir ?? path.join(getConfig().backupsDir, name);
  const v = verifyBackup(dir);
  const c = v.counts;
  console.log(`${v.ok ? "OK" : "DAMAGED"}: "${name}" has ${v.files} files, ${c.notes ?? "?"} notes, ${c.captures ?? "?"} captures, ${c.projects ?? "?"} projects, ${c.tasks ?? "?"} tasks, ${c.markdownFiles} Markdown files.`);
  for (const p of v.problems) console.log(`  problem: ${p}`);
  for (const w of v.warnings) console.log(`  note: ${w}`);
  if (!v.ok) throw new Error("Backup failed verification; nothing was changed.");
  if (verifyOnly) return;

  // Refuse to run while the app is up: it holds the database open.
  const running = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  if (running && !process.argv.includes("--ignore-running")) throw new Error("Second Brain OS appears to be running on port 3000. Stop it first, then retry.");
  if (!process.argv.includes("--yes")) {
    throw new Error(`This REPLACES your current database, vault, attachments and imports with "${name}".
Your current data is first copied to backups/pre-restore-<time>.
Re-run with --yes to proceed.`);
  }
  const r = restoreBackup(name, { fromDir });
  console.log(`Restored "${name}".
Previous state saved at: ${r.safetyCopy}
Start the app and run Automations → "Reindex vault" if search looks stale.`);
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
}
