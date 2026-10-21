import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, pruneBackups, restoreBackup, verifyBackup } from "../src/lib/backup.ts";
import { decryptBackup, encryptBackup } from "../src/lib/backup-crypto.ts";
import { getConfig } from "../src/lib/config.ts";
import { createCapture } from "../src/lib/captures.ts";
import { createNote } from "../src/lib/notes.ts";
import { cleanup, freshEnv } from "./helpers.ts";

const PASS = "correct-horse-battery-staple";
let dir: string;
let out: string;
beforeEach(() => { dir = freshEnv(); out = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-enc-")); });
afterEach(() => { cleanup(dir); fs.rmSync(out, { recursive: true, force: true }); });

const tree = (root: string, rel = ""): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(o, tree(root, r));
    else o[r] = fs.readFileSync(path.join(root, r)).toString("base64");
  }
  return o;
};

async function seeded() {
  createNote({ title: "Garden plan", body: "Plant tomatoes ünïcode ✓" });
  await createCapture({ content: "remember the invoice" });
  await createCapture({ content: "with a file", files: [{ name: "a.md", data: Buffer.from("# attached\n".repeat(5000)) }] });
  return createBackup();
}

describe("encrypted backups", () => {
  it("round-trips byte for byte and verifies", async () => {
    const b = await seeded();
    const enc = await encryptBackup(b.dir, PASS, out);
    expect(enc.endsWith(".sbosenc")).toBe(true);
    expect(fs.readFileSync(enc).includes(Buffer.from("tomatoes"))).toBe(false); // really encrypted
    const tmp = fs.mkdtempSync(path.join(out, "x-"));
    const restoredDir = await decryptBackup(enc, PASS, tmp);
    expect(tree(restoredDir)).toEqual(tree(b.dir));
    const v = verifyBackup(restoredDir);
    expect(v.ok).toBe(true);
    expect(v.counts.captures).toBe(2);
  });
  it("rejects a wrong passphrase, a tampered file and a short passphrase, leaving nothing behind", async () => {
    const b = await seeded();
    const enc = await encryptBackup(b.dir, PASS, out);
    const tmp = fs.mkdtempSync(path.join(out, "x-"));
    await expect(decryptBackup(enc, "another-long-passphrase", tmp)).rejects.toThrow(/wrong passphrase/);
    const bad = Buffer.from(fs.readFileSync(enc));
    bad[bad.length >> 1] ^= 0xff;
    const tampered = path.join(out, "tampered", path.basename(enc));
    fs.mkdirSync(path.dirname(tampered));
    fs.writeFileSync(tampered, bad);
    await expect(decryptBackup(tampered, PASS, tmp)).rejects.toThrow();
    expect(fs.readdirSync(tmp)).toEqual([]);
    await expect(encryptBackup(b.dir, "short", out)).rejects.toThrow(/at least 12/);
    await expect(decryptBackup(enc, undefined, tmp)).rejects.toThrow(/at least 12/);
  });
});

describe("verify and restore from anywhere", () => {
  it("restores a backup folder outside the data dir and refuses a damaged one", async () => {
    const b = await seeded();
    const elsewhere = path.join(out, "copy", b.name);
    fs.cpSync(b.dir, elsewhere, { recursive: true });
    expect(verifyBackup(elsewhere).ok).toBe(true);
    await createCapture({ content: "added after the backup" });
    restoreBackup(b.name, { fromDir: elsewhere });
    const { listCaptures } = await import("../src/lib/captures.ts");
    expect(listCaptures().map((c) => c.content).join("|")).not.toContain("added after");

    fs.writeFileSync(path.join(elsewhere, "sbos.db"), "this is not a database");
    expect(verifyBackup(elsewhere).ok).toBe(false);
    expect(() => restoreBackup(b.name, { fromDir: elsewhere })).toThrow(/damaged/);
    fs.rmSync(path.join(elsewhere, "vault"), { recursive: true });
    expect(verifyBackup(elsewhere).problems.join(" ")).toMatch(/File count/);
  });
  it("prunes encrypted files together with their folder name and keeps unrelated files", () => {
    const d = fs.mkdtempSync(path.join(out, "p-"));
    for (const n of ["01", "02", "03"]) fs.writeFileSync(path.join(d, `backup-2026-10-${n}_10-00-00.sbosenc`), "x");
    fs.writeFileSync(path.join(d, "notes.txt"), "keep me");
    expect(pruneBackups(d, 2)).toEqual(["backup-2026-10-01_10-00-00"]);
    expect(fs.readdirSync(d).sort()).toEqual(["backup-2026-10-02_10-00-00.sbosenc", "backup-2026-10-03_10-00-00.sbosenc", "notes.txt"]);
    expect(getConfig().dataDir).toBe(dir);
  });
});
