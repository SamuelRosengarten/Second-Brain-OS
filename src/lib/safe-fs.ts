import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class PathError extends Error {}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Reduce an untrusted filename to a safe single path segment. */
export function sanitizeFilename(name: string, fallback = "file"): string {
  let base = String(name ?? "").replace(/\0/g, "");
  base = base.split(/[\\/]/).pop() ?? "";
  base = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  if (base.length > 120) {
    const ext = path.extname(base).slice(0, 12);
    base = base.slice(0, 120 - ext.length) + ext;
  }
  return base || fallback;
}

export function slugify(text: string, max = 60): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, max).replace(/-+$/, "") || "untitled";
}

/** Resolve `rel` inside `root`; throws if it would escape (traversal, absolute paths, drive letters, NUL bytes, symlinks). */
export function resolveInside(root: string, rel: string): string {
  if (typeof rel !== "string" || rel.includes("\0")) throw new PathError("Invalid path");
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("\\\\")) throw new PathError("Absolute paths are not allowed");
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, rel);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) throw new PathError("Path escapes the allowed directory");
  let real: string | null = null;
  try {
    real = fs.realpathSync(full);
  } catch {
    // target does not exist yet: fine
  }
  if (real) {
    const realRoot = fs.realpathSync(rootAbs);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new PathError("Path escapes the allowed directory");
  }
  return full;
}

/** Return a path in `dir` that does not exist yet (adds -1, -2 ... before the extension). */
export function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(dir, filename);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem}-${i}${ext}`);
  return candidate;
}

/** Write via temp file + rename. With overwrite=false an existing file is never replaced. */
export function writeFileAtomic(target: string, data: string | Buffer, opts: { overwrite: boolean }): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!opts.overwrite && fs.existsSync(target)) throw new PathError("Refusing to overwrite existing file");
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { flag: "wx" });
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw e;
  }
}
