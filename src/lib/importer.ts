import path from "node:path";
import { getConfig } from "./config.ts";
import { getDb } from "./db.ts";
import { ApiError } from "./api.ts";
import { classifyFile, extractText, UnsupportedFileError, verifyMagic } from "./extract.ts";
import { createNote, parseMarkdown } from "./notes.ts";
import { resolveInside, sanitizeFilename, uniquePath, writeFileAtomic } from "./safe-fs.ts";
import { newId, nowIso, sha256 } from "./util.ts";

export interface ImportOutcome { filename: string; status: "imported" | "duplicate" | "failed" | "unsupported"; noteId?: string; error?: string }

/**
 * Imports user-chosen files into the library. The original file is preserved untouched in imports/
 * and a Markdown note is created in the vault. One bad file never aborts the rest of the batch.
 * Files are only ever parsed as text/PDF; nothing is executed.
 */
export async function importFiles(files: { name: string; data: Buffer }[]): Promise<ImportOutcome[]> {
  const cfg = getConfig();
  const db = getDb();
  const out: ImportOutcome[] = [];
  const record = (filename: string, hash: string, status: ImportOutcome["status"], error?: string, noteId?: string) =>
    db.prepare("INSERT INTO imports (id, filename, sha256, status, error, note_id, created_at) VALUES (?,?,?,?,?,?,?)").run(newId(), filename, hash, status, error ?? null, noteId ?? null, nowIso());

  for (const f of files) {
    const displayName = sanitizeFilename(f.name);
    const hash = sha256(f.data);
    try {
      if (f.data.length > cfg.maxUploadBytes) throw new ApiError(413, `Exceeds the ${Math.round(cfg.maxUploadBytes / 1048576)} MB limit.`);
      const cls = classifyFile(f.name);
      if (cls.kind === "image") throw new UnsupportedFileError("Images cannot be imported into the library (no OCR yet). Attach them to a capture instead.");
      if (!verifyMagic(cls.kind, f.data)) throw new ApiError(415, "File content does not match its extension.");
      const existing = db.prepare("SELECT n.id FROM imports i JOIN notes n ON n.id = i.note_id WHERE i.sha256 = ? AND i.status = 'imported' LIMIT 1").get(hash) as { id: string } | undefined;
      if (existing) {
        record(displayName, hash, "duplicate", undefined, existing.id);
        out.push({ filename: displayName, status: "duplicate", noteId: existing.id });
        continue;
      }
      const { text, pages } = await extractText(f.data, cls.kind);
      if (!text.trim()) throw new ApiError(422, cls.kind === "pdf" ? "No extractable text (scanned PDFs need OCR, which is not available yet)." : "The file is empty.");
      const original = uniquePath(cfg.importsDir, `${hash.slice(0, 8)}-${displayName}`);
      writeFileAtomic(resolveInside(cfg.importsDir, path.basename(original)), f.data, { overwrite: false });
      const fm = cls.kind === "markdown" ? parseMarkdown(text) : { meta: {} as Record<string, unknown>, body: text };
      const stem = displayName.replace(/\.[^.]+$/, "");
      const title = String(fm.meta.title || /^#\s+(.+)$/m.exec(fm.body)?.[1] || stem);
      const note = createNote({
        title, body: fm.body, tags: Array.isArray(fm.meta.tags) ? (fm.meta.tags as string[]) : [], category: String(fm.meta.category ?? ""),
        sourceType: "import", sourceRef: `${displayName}${pages ? ` (${pages} pages)` : ""}`,
      });
      record(displayName, hash, "imported", undefined, note.id);
      out.push({ filename: displayName, status: "imported", noteId: note.id });
    } catch (e) {
      const unsupported = e instanceof UnsupportedFileError;
      const msg = e instanceof Error ? e.message : "Import failed";
      record(displayName, hash, unsupported ? "unsupported" : "failed", msg);
      out.push({ filename: displayName, status: unsupported ? "unsupported" : "failed", error: msg });
    }
  }
  return out;
}

export function recentImports(limit = 30) {
  return getDb().prepare("SELECT id, filename, status, error, note_id, created_at FROM imports ORDER BY created_at DESC LIMIT ?").all(limit);
}
