import { loadEnv } from "./_env.ts";
loadEnv();
const { createBackup, exportAll, pruneBackups, copyBackupTo } = await import("../src/lib/backup.ts");
const { closeDb } = await import("../src/lib/db.ts");
const { getConfig } = await import("../src/lib/config.ts");

// Usage: npm run backup -- [--export] [--copy-to <dir>] [--keep <n>]
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const copyTo = opt("--copy-to") ?? process.env.SBOS_BACKUP_COPY_DIR;
const keep = Number(opt("--keep") ?? 8);

try {
  if (args.includes("--export")) {
    const r = exportAll();
    console.log(`Exported ${r.notes} notes (Markdown) + projects/tasks JSON to:\n  ${r.dir}`);
  } else {
    const r = await createBackup();
    console.log(`Backup created (${r.files} files):\n  ${r.dir}`);
    if (copyTo) {
      const copy = copyBackupTo(r.dir, copyTo);
      console.log(`Copied to:\n  ${copy}`);
      const removedCopies = pruneBackups(copyTo, keep);
      if (removedCopies.length) console.log(`Removed ${removedCopies.length} old copy folder(s) from ${copyTo} (keeping ${keep}).`);
    }
    const removed = pruneBackups(getConfig().backupsDir, keep);
    if (removed.length) console.log(`Removed ${removed.length} old local backup(s) (keeping ${keep}): ${removed.join(", ")}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  closeDb();
}
