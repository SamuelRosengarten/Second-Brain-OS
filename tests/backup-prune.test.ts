import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyBackupTo, pruneBackups } from "../src/lib/backup.ts";

function mk(dir: string, name: string, manifest = true) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  if (manifest) fs.writeFileSync(path.join(dir, name, "manifest.json"), "{}");
}

describe("backup retention", () => {
  it("keeps the newest N backups and never touches other folders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-prune-"));
    for (const d of ["01", "02", "03", "04"]) mk(dir, `backup-2026-10-${d}_10-00-00`);
    mk(dir, "pre-restore-2026-10-01_10-00-00");
    mk(dir, "backup-2026-09-01_10-00-00", false); // no manifest: not a valid backup, must be kept
    mk(dir, "my-own-folder");
    const removed = pruneBackups(dir, 2);
    expect(removed).toEqual(["backup-2026-10-01_10-00-00", "backup-2026-10-02_10-00-00"]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      "backup-2026-09-01_10-00-00",
      "backup-2026-10-03_10-00-00",
      "backup-2026-10-04_10-00-00",
      "my-own-folder",
      "pre-restore-2026-10-01_10-00-00",
    ]);
  });

  it("refuses keep < 1 and missing directories", () => {
    expect(pruneBackups(path.join(os.tmpdir(), "does-not-exist-sbos"), 3)).toEqual([]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-prune-"));
    mk(dir, "backup-2026-10-01_10-00-00");
    expect(pruneBackups(dir, 0)).toEqual([]);
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it("copies a backup elsewhere without overwriting", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-src-"));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-dest-"));
    mk(src, "backup-2026-10-01_10-00-00");
    const b = path.join(src, "backup-2026-10-01_10-00-00");
    const copy = copyBackupTo(b, dest);
    expect(fs.existsSync(path.join(copy, "manifest.json"))).toBe(true);
    expect(() => copyBackupTo(b, dest)).toThrow(/already exists/);
  });
});
