import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfig } from "./config.ts";
import { getDb } from "./db.ts";
import { ApiError } from "./api.ts";
import { classifyFile, extractText, UnsupportedFileError, verifyMagic } from "./extract.ts";
import { createNote, type Note } from "./notes.ts";
import { getProvider, OllamaError } from "./ollama.ts";
import { buildCaptureMessages, ProposalSchema, proposalJsonSchema, type Proposal } from "./prompts.ts";
import { createTask, linkNote, listProjects } from "./projects.ts";
import { resolveInside, sanitizeFilename, uniquePath, writeFileAtomic } from "./safe-fs.ts";
import { contentHash, log, newId, nowIso, sha256 } from "./util.ts";

export const CAPTURE_KINDS = ["text", "idea", "task", "project_note", "link", "excerpt", "file"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export interface CaptureRow {
  id: string; kind: CaptureKind; original_content: string; content: string; url: string;
  status: "new" | "processing" | "proposed" | "accepted" | "dismissed" | "failed";
  archived: number; content_hash: string; proposal_json: string | null; model: string | null;
  error: string | null; note_id: string | null; created_at: string; updated_at: string;
}
export interface Capture extends Omit<CaptureRow, "proposal_json" | "archived"> {
  archived: boolean;
  proposal: Proposal | null;
  attachments: { id: string; filename: string; mime: string; size: number }[];
}

const STALE_PROCESSING_MS = 5 * 60 * 1000;

function hydrate(r: CaptureRow): Capture {
  let proposal: Proposal | null = null;
  if (r.proposal_json) {
    try { proposal = JSON.parse(r.proposal_json) as Proposal; } catch { proposal = null; }
  }
  const attachments = getDb().prepare("SELECT id, filename, mime, size FROM attachments WHERE capture_id = ? ORDER BY created_at").all(r.id) as Capture["attachments"];
  const { proposal_json: _p, archived, ...rest } = r;
  void _p;
  return { ...rest, archived: !!archived, proposal, attachments };
}

export function getCapture(id: string): Capture | null {
  const r = getDb().prepare("SELECT * FROM captures WHERE id = ?").get(id) as CaptureRow | undefined;
  return r ? hydrate(r) : null;
}

export interface CaptureFilter { status?: string; q?: string; archived?: boolean; kind?: string; limit?: number }
export function listCaptures(f: CaptureFilter = {}): Capture[] {
  const where: string[] = ["archived = ?"];
  const args: unknown[] = [f.archived ? 1 : 0];
  if (f.status) { where.push("status = ?"); args.push(f.status); }
  if (f.kind) { where.push("kind = ?"); args.push(f.kind); }
  if (f.q) {
    where.push("(content LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR proposal_json LIKE ? ESCAPE '\\')");
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    args.push(like, like, like);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM captures WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, Math.min(f.limit ?? 200, 500)) as CaptureRow[];
  return rows.map(hydrate);
}

export interface UploadedFile { name: string; data: Buffer }
export interface CreateCaptureInput { kind?: CaptureKind; content?: string; url?: string; files?: UploadedFile[]; autoProcess?: boolean }
export interface CreateCaptureResult { capture: Capture; duplicate: boolean }

/** Saves the capture (and any files) BEFORE any AI work. A model failure can never lose the original. */
export async function createCapture(input: CreateCaptureInput): Promise<CreateCaptureResult> {
  const cfg = getConfig();
  const db = getDb();
  let content = (input.content ?? "").trim();
  let url = (input.url ?? "").trim();
  // Share sheets hand over either text or a bare link; treat a lone link as a link capture.
  const loneLink = !input.kind && !url && !input.files?.length && /^https?:\/\/\S+$/i.test(content);
  if (loneLink) url = content;
  if (url && !/^https?:\/\//i.test(url)) throw new ApiError(400, "URL must start with http:// or https://", "validation");
  const files = input.files ?? [];
  if (!content && !url && !files.length) throw new ApiError(400, "Nothing to capture: add text, a link or a file.", "validation");

  // Validate every file up-front so a bad file does not leave a half-created capture.
  const prepared: { name: string; data: Buffer; mime: string; text: string; kind: string }[] = [];
  const extractedParts: string[] = [];
  for (const f of files) {
    if (f.data.length > cfg.maxUploadBytes) throw new ApiError(413, `“${f.name}” exceeds the ${Math.round(cfg.maxUploadBytes / 1048576)} MB upload limit.`, "too_large");
    let cls;
    try { cls = classifyFile(f.name); } catch (e) {
      if (e instanceof UnsupportedFileError) throw new ApiError(415, e.message, "unsupported");
      throw e;
    }
    if (!verifyMagic(cls.kind, f.data)) throw new ApiError(415, `“${f.name}” does not look like a valid ${cls.kind} file.`, "unsupported");
    let text = "";
    try { text = (await extractText(f.data, cls.kind)).text; } catch {
      throw new ApiError(422, `Could not read text from “${f.name}”. The file may be corrupt or encrypted.`, "extract_failed");
    }
    prepared.push({ name: sanitizeFilename(f.name), data: f.data, mime: cls.mime, text, kind: cls.kind });
    if (text) extractedParts.push(prepared.length > 1 || content ? `### ${f.name}\n\n${text}` : text);
  }
  if (extractedParts.length) content = [content, ...extractedParts].filter(Boolean).join("\n\n");
  if (!content && prepared.length) content = `[Attached: ${prepared.map((p) => p.name).join(", ")}]`;
  if (!content) content = url;

  const kind: CaptureKind = input.kind ?? (files.length ? "file" : loneLink || (url && !input.content) ? "link" : "text");
  const hash = contentHash(`${content}|${url}|${prepared.map((p) => sha256(p.data)).join(",")}`);
  const dup = db.prepare("SELECT * FROM captures WHERE content_hash = ? AND archived = 0 ORDER BY created_at DESC LIMIT 1").get(hash) as CaptureRow | undefined;
  if (dup) return { capture: hydrate(dup), duplicate: true };

  const id = newId();
  const now = nowIso();
  const savedPaths: string[] = [];
  try {
    db.transaction(() => {
      db.prepare(
        "INSERT INTO captures (id, kind, original_content, content, url, status, content_hash, created_at, updated_at) VALUES (?,?,?,?,?, 'new', ?,?,?)",
      ).run(id, kind, content, content, url, hash, now, now);
      for (const p of prepared) {
        const sub = now.slice(0, 7);
        const dir = path.join(cfg.attachmentsDir, sub);
        fs.mkdirSync(dir, { recursive: true });
        const target = uniquePath(dir, `${id.slice(0, 8)}-${p.name}`);
        writeFileAtomic(resolveInside(cfg.attachmentsDir, path.relative(cfg.attachmentsDir, target)), p.data, { overwrite: false });
        savedPaths.push(target);
        db.prepare("INSERT INTO attachments (id, capture_id, filename, stored_path, mime, size, sha256, created_at) VALUES (?,?,?,?,?,?,?,?)").run(
          newId(), id, p.name, path.relative(cfg.attachmentsDir, target).split(path.sep).join("/"), p.mime, p.data.length, sha256(p.data), now,
        );
      }
    })();
  } catch (e) {
    for (const s of savedPaths) fs.rmSync(s, { force: true });
    throw e;
  }
  log("info", "capture.created", { id, kind, files: prepared.length, chars: content.length });
  if (input.autoProcess) {
    // Fire and forget: the capture is already persisted, errors are recorded on the row.
    void processCapture(id).catch(() => undefined);
  }
  return { capture: getCapture(id)!, duplicate: false };
}

export const CapturePatch = z.object({
  content: z.string().min(1).max(200_000).optional(),
  kind: z.enum(CAPTURE_KINDS).optional(),
  url: z.string().max(2000).optional(),
  archived: z.boolean().optional(),
  status: z.enum(["dismissed", "new"]).optional(),
  proposal: ProposalSchema.optional(),
});

export function updateCapture(id: string, patch: z.infer<typeof CapturePatch>): Capture {
  const cur = getCapture(id);
  if (!cur) throw new ApiError(404, "Capture not found", "not_found");
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const args: unknown[] = [nowIso()];
  if (patch.content !== undefined) { sets.push("content = ?"); args.push(patch.content); }
  if (patch.kind !== undefined) { sets.push("kind = ?"); args.push(patch.kind); }
  if (patch.url !== undefined) { sets.push("url = ?"); args.push(patch.url); }
  if (patch.archived !== undefined) { sets.push("archived = ?"); args.push(patch.archived ? 1 : 0); }
  if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.proposal !== undefined) { sets.push("proposal_json = ?", "status = 'proposed'"); args.push(JSON.stringify(patch.proposal)); }
  db.prepare(`UPDATE captures SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  return getCapture(id)!;
}

/** Deletes the capture row and moves its attachment files to attachments/.trash. */
export function deleteCapture(id: string): void {
  const cfg = getConfig();
  const db = getDb();
  if (!getCapture(id)) throw new ApiError(404, "Capture not found", "not_found");
  const atts = db.prepare("SELECT stored_path FROM attachments WHERE capture_id = ?").all(id) as { stored_path: string }[];
  const trash = path.join(cfg.attachmentsDir, ".trash");
  for (const a of atts) {
    try {
      const src = resolveInside(cfg.attachmentsDir, a.stored_path);
      if (fs.existsSync(src)) {
        fs.mkdirSync(trash, { recursive: true });
        fs.renameSync(src, uniquePath(trash, path.basename(src)));
      }
    } catch (e) {
      log("warn", "capture.delete.file", { id, message: e instanceof Error ? e.message : "unknown" });
    }
  }
  db.prepare("DELETE FROM captures WHERE id = ?").run(id);
}

export function attachmentFile(attachmentId: string): { fullPath: string; filename: string; mime: string } {
  const a = getDb().prepare("SELECT stored_path, filename, mime FROM attachments WHERE id = ?").get(attachmentId) as
    | { stored_path: string; filename: string; mime: string } | undefined;
  if (!a) throw new ApiError(404, "Attachment not found", "not_found");
  return { fullPath: resolveInside(getConfig().attachmentsDir, a.stored_path), filename: a.filename, mime: a.mime };
}

// ---------- AI processing ----------
function describeError(e: unknown): string {
  if (e instanceof OllamaError) return e.hint ? `${e.message} ${e.hint}` : e.message;
  if (e instanceof z.ZodError) return "The model's answer did not match the expected format. Retry, or try a different model.";
  return e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
}

export async function processCapture(id: string, model?: string): Promise<Capture> {
  const db = getDb();
  const cur = getCapture(id);
  if (!cur) throw new ApiError(404, "Capture not found", "not_found");
  const age = Date.now() - new Date(cur.updated_at).getTime();
  if (cur.status === "processing" && age < STALE_PROCESSING_MS) throw new ApiError(409, "This capture is already being processed.", "busy");
  const useModel = model || getConfig().chatModel;
  db.prepare("UPDATE captures SET status='processing', error=NULL, model=?, updated_at=? WHERE id=?").run(useModel, nowIso(), id);
  try {
    const projectNames = listProjects().filter((p) => p.status !== "archived").map((p) => p.name);
    const raw = await getProvider().chatJson(
      useModel,
      buildCaptureMessages({ kind: cur.kind, content: cur.content, url: cur.url, projectNames }),
      proposalJsonSchema,
    );
    const proposal = ProposalSchema.parse(raw);
    // Never trust the model to name projects that do not exist.
    proposal.related_projects = proposal.related_projects.filter((n) => projectNames.includes(n));
    db.prepare("UPDATE captures SET status='proposed', proposal_json=?, error=NULL, updated_at=? WHERE id=?").run(JSON.stringify(proposal), nowIso(), id);
    log("info", "capture.processed", { id, model: useModel });
  } catch (e) {
    const msg = describeError(e);
    db.prepare("UPDATE captures SET status='failed', error=?, updated_at=? WHERE id=?").run(msg, nowIso(), id);
    log("warn", "capture.process_failed", { id, model: useModel, message: msg.slice(0, 160) });
  }
  return getCapture(id)!;
}

export async function processAllPending(): Promise<{ processed: number; failed: number }> {
  const pending = listCaptures({ status: "new", limit: 50 });
  let failed = 0;
  for (const c of pending) {
    const r = await processCapture(c.id);
    if (r.status === "failed") {
      failed++;
      if (/Cannot reach Ollama|not installed/i.test(r.error ?? "")) break; // no point continuing
    }
  }
  return { processed: pending.length, failed };
}

// ---------- accept: capture -> note (+ approved tasks) ----------
export const AcceptInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000),
  summary: z.string().max(2000).default(""),
  category: z.string().max(60).default(""),
  tags: z.array(z.string()).max(20).default([]),
  project_ids: z.array(z.string()).max(10).default([]),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(300), priority: z.enum(["low", "medium", "high"]).default("medium"), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), project_id: z.string().nullable().optional() })).max(10).default([]),
});

export function acceptCapture(id: string, input: z.infer<typeof AcceptInput>): { note: Note; taskIds: string[] } {
  const cap = getCapture(id);
  if (!cap) throw new ApiError(404, "Capture not found", "not_found");
  if (cap.status === "accepted" && cap.note_id) throw new ApiError(409, "This capture was already saved as a note.", "already_accepted");
  const body = input.body.trim() || cap.content;
  const withSource = cap.url && !body.includes(cap.url) ? `${body}\n\nSource: ${cap.url}` : body;
  const note = createNote({
    title: input.title, body: withSource, summary: input.summary, category: input.category, tags: input.tags,
    sourceType: "capture", sourceRef: cap.url || `capture:${cap.id}`,
  });
  for (const pid of input.project_ids) linkNote(pid, note.id);
  const taskIds = input.tasks.map((t) => createTask({ ...t, capture_id: id, description: `From note “${note.title}”` }).id);
  getDb().prepare("UPDATE captures SET status='accepted', note_id=?, updated_at=? WHERE id=?").run(note.id, nowIso(), id);
  return { note, taskIds };
}

export function captureCounts(): { awaitingReview: number; unprocessed: number; failed: number; total: number } {
  const r = getDb()
    .prepare(
      `SELECT SUM(status='proposed') AS review, SUM(status='new') AS unprocessed, SUM(status='failed') AS failed, COUNT(*) AS total
       FROM captures WHERE archived = 0`,
    )
    .get() as { review: number | null; unprocessed: number | null; failed: number | null; total: number };
  return { awaitingReview: r.review ?? 0, unprocessed: r.unprocessed ?? 0, failed: r.failed ?? 0, total: r.total };
}
