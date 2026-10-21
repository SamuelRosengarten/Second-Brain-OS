import { loadEnv } from "./_env.ts";
loadEnv();
const { createBackup, exportAll } = await import("../src/lib/backup.ts");
const { closeDb } = await import("../src/lib/db.ts");

try {
  if (process.argv.includes("--export")) {
    const r = exportAll();
    console.log(`Exported ${r.notes} notes (Markdown) + projects/tasks JSON to:\n  ${r.dir}`);
  } else {
    const r = await createBackup();
    console.log(`Backup created (${r.files} files):\n  ${r.dir}`);
  }
} finally {
  closeDb();
}
