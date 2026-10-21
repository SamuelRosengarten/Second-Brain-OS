import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "./_env.ts";
loadEnv();
const { createBackup, exportAll, pruneBackups, copyBackupTo, verifyBackup } = await import("../src/lib/backup.ts");
const { encryptBackup, decryptBackup } = await import("../src/lib/backup-crypto.ts");
const { closeDb } = await import("../src/lib/db.ts");
const { getConfig } = await import("../src/lib/config.ts");

// Usage: npm run backup -- [--export] [--copy-to <dir>] [--keep <n>] [--encrypt]
// --encrypt: the copy in --copy-to (or next to the backup) is a single AES-256-GCM file protected by SBOS_BACKUP_PASSPHRASE,
// so it is safe to put on a cloud-synced folder or a USB stick. The plain folder stays in your data directory only.
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const copyTo = opt("--copy-to") ?? process.env.SBOS_BACKUP_COPY_DIR;
const keep = Number(opt("--keep") ?? 8);
const encrypt = args.includes("--encrypt");

try {
  if (args.includes("--export")) {
    const r = exportAll();
    console.log(`Exported ${r.notes} notes (Markdown) + projects/tasks JSON to:\n  ${r.dir}`);
  } else {
    const passphrase = process.env.SBOS_BACKUP_PASSPHRASE;
    if (encrypt && (!passphrase || passphrase.length < 12)) throw new Error("--encrypt needs SBOS_BACKUP_PASSPHRASE (12+ characters) in .env.local.");
    const r = await createBackup();
    console.log(`Backup created (${r.files} files):\n  ${r.dir}`);
    const check = verifyBackup(r.dir);
    if (!check.ok) throw new Error(`The new backup failed verification: ${check.problems.join(" ")}`);
    console.log(`Verified: database integrity ok, ${check.counts.notes} notes, ${check.counts.captures} captures, ${check.counts.tasks} tasks.`);
    for (const w of check.warnings) console.log(`Note: ${w}`);

    if (encrypt) {
      const enc = await encryptBackup(r.dir, passphrase, copyTo ?? getConfig().backupsDir);
      // Prove the encrypted file opens with the passphrase and matches before trusting it.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-verify-"));
      try {
        const back = verifyBackup(await decryptBackup(enc, passphrase, tmp));
        if (!back.ok) throw new Error(`The encrypted copy did not verify: ${back.problems.join(" ")}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      console.log(`Encrypted copy (verified by decrypting it):\n  ${enc}`);
    } else if (copyTo) {
      console.log(`Copied to:\n  ${copyBackupTo(r.dir, copyTo)}`);
    }
    if (copyTo) {
      const removedCopies = pruneBackups(copyTo, keep);
      if (removedCopies.length) console.log(`Removed ${removedCopies.length} old copy(ies) from ${copyTo} (keeping ${keep}).`);
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
