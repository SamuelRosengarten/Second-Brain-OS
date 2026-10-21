import { loadEnv } from "./_env.ts";
loadEnv();
const { restoreBackup, listBackups } = await import("../src/lib/backup.ts");
const { getConfig } = await import("../src/lib/config.ts");

const name = process.argv[2];
if (!name || name.startsWith("--")) {
  console.log("Usage: npm run restore -- <backup-folder-name> --yes\n\nAvailable backups in " + getConfig().backupsDir + ":");
  for (const b of listBackups()) console.log(`  ${b.name}   (${b.created})`);
  process.exit(name ? 1 : 0);
}

// Refuse to run while the app is up: it holds the database open.
const running = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
if (running) {
  console.error("Second Brain OS appears to be running on port 3000. Stop it first, then retry.");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(`This REPLACES your current database, vault, attachments and imports with "${name}".\nYour current data is first copied to backups/pre-restore-<time>.\nRe-run with --yes to proceed.`);
  process.exit(1);
}
try {
  const r = restoreBackup(name);
  console.log(`Restored "${name}".\nPrevious state saved at: ${r.safetyCopy}\nStart the app and run Automations → "Reindex vault" if search looks stale.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
