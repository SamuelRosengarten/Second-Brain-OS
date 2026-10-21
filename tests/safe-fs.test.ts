import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathError, resolveInside, sanitizeFilename, uniquePath, writeFileAtomic } from "../src/lib/safe-fs.ts";

describe("sanitizeFilename", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\Windows\\system32\\evil.exe", "evil.exe"],
    ["C:\\Users\\x\\a.md", "a.md"],
    ["bad<>:\"|?*name.txt", "bad_______name.txt"],
    ["CON", "_CON"],
    ["nul.txt", "_nul.txt"],
    ["...hidden", "hidden"],
    ["trailing. . ", "trailing"],
    ["", "file"],
    ["\0null.md", "null.md"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("limits length and keeps the extension", () => {
    const out = sanitizeFilename("a".repeat(500) + ".pdf");
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("resolveInside", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-root-"));
  it("accepts normal relative paths", () => {
    expect(resolveInside(root, "a/b.md")).toBe(path.join(root, "a", "b.md"));
  });
  it.each(["../x", "a/../../x", "..\\x", "/etc/passwd", "C:\\Windows\\win.ini", "\\\\server\\share\\f", "a\0b", "a/../../../etc"])(
    "rejects %j",
    (p) => {
      expect(() => resolveInside(root, p)).toThrow(PathError);
    },
  );
  it("rejects symlinks escaping the root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-out-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");
    try {
      fs.symlinkSync(outside, path.join(root, "link"), "junction");
    } catch {
      return; // cannot create links in this environment
    }
    expect(() => resolveInside(root, "link/secret.txt")).toThrow(PathError);
  });
});

describe("writes never overwrite silently", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-w-"));
  it("refuses to overwrite and leaves no temp files", () => {
    const f = path.join(dir, "n.md");
    writeFileAtomic(f, "one", { overwrite: false });
    expect(() => writeFileAtomic(f, "two", { overwrite: false })).toThrow(PathError);
    expect(fs.readFileSync(f, "utf8")).toBe("one");
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
  it("uniquePath picks a fresh name", () => {
    expect(path.basename(uniquePath(dir, "n.md"))).toBe("n-1.md");
  });
});
