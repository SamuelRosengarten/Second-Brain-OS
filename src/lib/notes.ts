import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config.ts";
import { getDb } from "./db.ts";
import { ApiError } from "./api.ts";
import { PathError, resolveInside, slugify, uniquePath, writeFileAtomic } from "./safe-fs.ts";
import { newId, nowIso, sha256 } from "./util.ts";

export interface NoteMeta {
  id: string;
  title: string;
  path: string;
  category: string;
  summary: string;
  sourceType: string;
  sourceRef: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Note extends NoteMeta {
  body: string;
  fileMissing: boolean;
}
export interface NoteInput {
  title: string;
  body: string;
  tags?: string[];
  category?: string;
  summary?: string;
  sourceType?: string;
  sourceRef?: string;
}

// ---------- frontmatter ----------
const FM_KEYS = ["id", "title", "category", "summary", "tags", "source_type", "source_ref", "created", "updated"] as const;

export function renderMarkdown(meta: Record<string, unknown>, body: string): string {
  const lines = FM_KEYS.filter((k) => meta[k] !== undefined).map((k) => `${k}: ${JSON.stringify(meta[k])}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}${body.endsWith("\n") ? "" : "\n"}`;
}

export function parseMarkdown(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      meta[key] = JSON.parse(raw);
    } catch {
      meta[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n+/, "") };
}

const cleanTags = (tags: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [])
        .map((t) => String(t).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
        .filter((t) => t && t.length <= 40),
    ),
  ).slice(0, 20);
export { cleanTags };

// ---------- chunking ----------
export function chunkMarkdown(body: string, maxLen = 1100): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let heading = "";
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ heading, text: t });
    buf = "";
  };
  for (const para of body.split(/\n{2,}/)) {
    const h = /^#{1,6}\s+(.+)$/m.exec(para.trim().split("\n")[0]);
    if (h) {
      flush();
      heading = h[1].trim();
    }
    if (buf && buf.length + para.length > maxLen) flush();
    if (para.length > maxLen) {
      flush();
      for (let i = 0; i < para.length; i += maxLen) out.push({ heading, text: para.slice(i, i + maxLen).trim() });
    } else {
      buf += (buf ? "\n\n" : "") + para;
    }
  }
  flush();
  return out;
}

// ---------- indexing ----------
function indexNoteRow(meta: NoteMeta, body: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM note_fts WHERE note_id = ?").run(meta.id);
    db.prepare("DELETE FROM chunks WHERE note_id = ?").run(meta.id);
    const ins = db.prepare("INSERT INTO chunks (note_id, idx, heading, text) VALUES (?, ?, ?, ?)");
    const fts = db.prepare("INSERT INTO note_fts (note_id, chunk_id, title, heading, body, tags) VALUES (?, ?, ?, ?, ?, ?)");
    const pieces = chunkMarkdown(body);
    if (!pieces.length) pieces.push({ heading: "", text: "" });
    pieces.forEach((c, i) => {
      const r = ins.run(meta.id, i, c.heading, c.text);
      fts.run(meta.id, r.lastInsertRowid, meta.title, c.heading, c.text, meta.tags.join(" "));
    });
  })();
}

function replaceTags(id: string, tags: string[]): void {
  const db = getDb();
  db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(id);
  const ins = db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)");
  for (const t of tags) ins.run(id, t);
}

interface NoteRow {
  id: string; title: string; path: string; category: string; summary: string;
  source_type: string; source_ref: string; created_at: string; updated_at: string;
}
function toMeta(r: NoteRow): NoteMeta {
  const tags = (getDb().prepare("SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag").all(r.id) as { tag: string }[]).map((t) => t.tag);
  return {
    id: r.id, title: r.title, path: r.path, category: r.category, summary: r.summary,
    sourceType: r.source_type, sourceRef: r.source_ref, tags, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function frontmatterFor(m: NoteMeta): Record<string, unknown> {
  return {
    id: m.id, title: m.title, category: m.category, summary: m.summary, tags: m.tags,
    source_type: m.sourceType, source_ref: m.sourceRef, created: m.createdAt, updated: m.updatedAt,
  };
}

// ---------- CRUD ----------
export function createNote(input: NoteInput): Note {
  const cfg = getConfig();
  const db = getDb();
  const id = newId();
  const now = nowIso();
  const title = input.title.trim() || "Untitled";
  const rel = path.basename(uniquePath(cfg.vaultDir, `${slugify(title)}-${id.slice(0, 8)}.md`));
  const meta: NoteMeta = {
    id, title, path: rel, category: input.category?.trim() ?? "", summary: input.summary?.trim() ?? "",
    sourceType: input.sourceType ?? "manual", sourceRef: input.sourceRef ?? "", tags: cleanTags(input.tags),
    createdAt: now, updatedAt: now,
  };
  const text = renderMarkdown(frontmatterFor(meta), input.body);
  // File first, never overwriting; the DB row is only written once the file exists.
  writeFileAtomic(resolveInside(cfg.vaultDir, rel), text, { overwrite: false });
  db.prepare(
    `INSERT INTO notes (id, title, path, category, summary, source_type, source_ref, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, title, rel, meta.category, meta.summary, meta.sourceType, meta.sourceRef, sha256(text), now, now);
  replaceTags(id, meta.tags);
  indexNoteRow(meta, input.body);
  return { ...meta, body: input.body, fileMissing: false };
}

export function getNote(id: string): Note | null {
  const row = getDb().prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | undefined;
  if (!row) return null;
  const meta = toMeta(row);
  try {
    const text = fs.readFileSync(resolveInside(getConfig().vaultDir, row.path), "utf8");
    return { ...meta, body: parseMarkdown(text).body, fileMissing: false };
  } catch {
    return { ...meta, body: "", fileMissing: true };
  }
}

export function updateNote(id: string, patch: Partial<NoteInput>): Note {
  const existing = getNote(id);
  if (!existing) throw new ApiError(404, "Note not found", "not_found");
  if (existing.fileMissing) throw new ApiError(409, "The note's Markdown file is missing from the vault; run Reindex.", "file_missing");
  const now = nowIso();
  const meta: NoteMeta = {
    ...existing,
    title: patch.title?.trim() || existing.title,
    category: patch.category !== undefined ? patch.category.trim() : existing.category,
    summary: patch.summary !== undefined ? patch.summary.trim() : existing.summary,
    tags: patch.tags !== undefined ? cleanTags(patch.tags) : existing.tags,
    updatedAt: now,
  };
  const body = patch.body !== undefined ? patch.body : existing.body;
  const text = renderMarkdown(frontmatterFor(meta), body);
  writeFileAtomic(resolveInside(getConfig().vaultDir, existing.path), text, { overwrite: true });
  getDb()
    .prepare("UPDATE notes SET title=?, category=?, summary=?, content_hash=?, updated_at=? WHERE id=?")
    .run(meta.title, meta.category, meta.summary, sha256(text), now, id);
  replaceTags(id, meta.tags);
  indexNoteRow(meta, body);
  return { ...meta, body, fileMissing: false };
}

/** Deleting moves the Markdown file to vault/.trash so it can be recovered. */
export function deleteNote(id: string): void {
  const db = getDb();
  const row = db.prepare("SELECT path FROM notes WHERE id = ?").get(id) as { path: string } | undefined;
  if (!row) throw new ApiError(404, "Note not found", "not_found");
  const cfg = getConfig();
  try {
    const src = resolveInside(cfg.vaultDir, row.path);
    if (fs.existsSync(src)) {
      const trash = path.join(cfg.vaultDir, ".trash");
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(src, uniquePath(trash, path.basename(src)));
    }
  } catch (e) {
    if (!(e instanceof PathError)) throw e;
  }
  db.transaction(() => {
    db.prepare("DELETE FROM note_fts WHERE note_id = ?").run(id);
    db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  })();
}

export const NOTE_SORTS = ["updated", "created", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];
// Fixed SQL per sort key: the key is never interpolated from user input.
const NOTE_ORDER: Record<NoteSort, string> = {
  updated: "updated_at DESC",
  created: "created_at DESC",
  title: "title COLLATE NOCASE ASC, updated_at DESC",
};

export interface NoteListOpts {
  q?: string;
  sort?: NoteSort;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
}
export function listNotes(opts: NoteListOpts = {}): NoteMeta[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.q) {
    where.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[\\%_]/g, "\\$&")}%`;
    args.push(like, like);
  }
  if (opts.tag) {
    where.push("id IN (SELECT note_id FROM note_tags WHERE tag = ?)");
    args.push(opts.tag);
  }
  if (opts.category) {
    where.push("category = ?");
    args.push(opts.category);
  }
  const sql = `SELECT * FROM notes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${NOTE_ORDER[opts.sort && NOTE_SORTS.includes(opts.sort) ? opts.sort : "updated"]} LIMIT ? OFFSET ?`;
  const rows = getDb().prepare(sql).all(...args, Math.min(opts.limit ?? 100, 500), opts.offset ?? 0) as NoteRow[];
  return rows.map(toMeta);
}

export function listTags(): { tag: string; count: number }[] {
  return getDb().prepare("SELECT tag, COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY count DESC, tag").all() as { tag: string; count: number }[];
}

// ---------- reindex from the vault (source of truth) ----------
export interface ReindexResult { scanned: number; added: number; updated: number; removed: number; errors: string[] }

function walkMarkdown(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(full, base, out);
    else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) out.push(path.relative(base, full));
  }
  return out;
}

/** Rebuild DB metadata + search index from the Markdown files. Never modifies or deletes files. */
export function reindexVault(): ReindexResult {
  const cfg = getConfig();
  const db = getDb();
  const result: ReindexResult = { scanned: 0, added: 0, updated: 0, removed: 0, errors: [] };
  const seen = new Set<string>();
  for (const rel of walkMarkdown(cfg.vaultDir)) {
    result.scanned++;
    try {
      const text = fs.readFileSync(resolveInside(cfg.vaultDir, rel), "utf8");
      const { meta: fm, body } = parseMarkdown(text);
      const hash = sha256(text);
      const relPosix = rel.split(path.sep).join("/");
      const byPath = db.prepare("SELECT id, content_hash FROM notes WHERE path = ?").get(relPosix) as { id: string; content_hash: string } | undefined;
      seen.add(relPosix);
      if (byPath && byPath.content_hash === hash) continue;
      const stat = fs.statSync(resolveInside(cfg.vaultDir, rel));
      const title = String(fm.title || /^#\s+(.+)$/m.exec(body)?.[1] || path.basename(rel).replace(/\.(md|markdown)$/i, ""));
      const tags = cleanTags(fm.tags);
      let id = byPath?.id;
      if (!id) {
        const fmId = typeof fm.id === "string" ? fm.id : "";
        const taken = fmId && db.prepare("SELECT 1 FROM notes WHERE id = ?").get(fmId);
        id = fmId && !taken ? fmId : `ext-${sha256(relPosix).slice(0, 16)}`;
        db.prepare(
          `INSERT OR IGNORE INTO notes (id, title, path, category, summary, source_type, source_ref, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, '', '', 'import', ?, ?, ?, ?)`,
        ).run(id, title, relPosix, "", hash, String(fm.created || stat.birthtime.toISOString()), stat.mtime.toISOString());
        result.added++;
      } else result.updated++;
      db.prepare("UPDATE notes SET title=?, category=?, summary=?, content_hash=?, updated_at=? WHERE id=?").run(
        title, String(fm.category ?? ""), String(fm.summary ?? ""), hash, stat.mtime.toISOString(), id,
      );
      replaceTags(id, tags);
      const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow;
      indexNoteRow(toMeta(row), body);
    } catch (e) {
      result.errors.push(`${rel}: ${e instanceof Error ? e.message : "unreadable"}`);
    }
  }
  const all = db.prepare("SELECT id, path FROM notes").all() as { id: string; path: string }[];
  for (const n of all) {
    if (!seen.has(n.path) && !result.errors.some((e) => e.startsWith(n.path))) {
      db.transaction(() => {
        db.prepare("DELETE FROM note_fts WHERE note_id = ?").run(n.id);
        db.prepare("DELETE FROM notes WHERE id = ?").run(n.id);
      })();
      result.removed++;
    }
  }
  return result;
}
