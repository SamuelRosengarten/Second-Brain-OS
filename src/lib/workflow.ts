import { z } from "zod";
import { ApiError } from "./api.ts";
import { getChatModel } from "./chat.ts";
import { getDb } from "./db.ts";
import { addDays, isYmd, ymd } from "./dates.ts";
import { getProvider, type ChatMessage } from "./ollama.ts";
import { getTask, listProjects, type Project, type Task } from "./projects.ts";
import { newId, nowIso } from "./util.ts";
import { wouldCycle, type Dep } from "./workflow-logic.ts";

/* ---------------- dependencies ---------------- */

/** Dependencies between tasks that both still exist (not in the trash). `a` must finish before `b`. */
export function listDeps(): Dep[] {
  return getDb()
    .prepare(
      `SELECT d.depends_on AS a, d.task_id AS b FROM task_deps d
       JOIN tasks x ON x.id = d.task_id AND x.deleted_at IS NULL
       JOIN tasks y ON y.id = d.depends_on AND y.deleted_at IS NULL`,
    )
    .all() as Dep[];
}

/** Makes `dependsOn` a prerequisite of `taskId`. Rejects unknown or trashed tasks, self-links and loops. Idempotent. */
export function addDep(taskId: string, dependsOn: string): void {
  const a = getTask(dependsOn);
  const b = getTask(taskId);
  if (!a || !b || a.deleted_at || b.deleted_at) throw new ApiError(404, "Task not found", "not_found");
  if (a.id === b.id) throw new ApiError(400, "A task cannot depend on itself.", "validation");
  if (wouldCycle(listDeps(), a.id, b.id)) throw new ApiError(400, "That would create a loop: the other task already depends on this one.", "cycle");
  getDb().prepare("INSERT OR IGNORE INTO task_deps (task_id, depends_on, created_at) VALUES (?,?,?)").run(b.id, a.id, nowIso());
}

export function removeDep(taskId: string, dependsOn: string): void {
  getDb().prepare("DELETE FROM task_deps WHERE task_id = ? AND depends_on = ?").run(taskId, dependsOn);
}

/* ---------------- AI-suggested dependencies ---------------- */

export interface DepSuggestion { id: string; a: string; b: string; confidence: number; why: string }

const ModelOutput = z.object({
  links: z.array(z.object({
    first: z.string().max(12),
    then: z.string().max(12),
    confidence: z.number().min(0).max(100),
    reason: z.string().max(300),
  })).max(20),
});
const modelSchema = z.toJSONSchema(ModelOutput) as object;
export const MAX_DEP_SUGGESTIONS = 8;

/** The model refers to tasks by their short labels (T5); show the task titles instead so the explanation makes sense to the user. */
export function humanizeReason(reason: string, titles: Map<string, string>): string {
  return reason
    .replace(/\(\s*(T\d{1,3})\s*\)/gi, (_, l: string) => { const t = titles.get(l.toUpperCase()); return t ? `(“${t}”)` : `(${l})`; })
    .replace(/\bT\d{1,3}\b/gi, (l) => { const t = titles.get(l.toUpperCase()); return t ? `“${t}”` : l; })
    .replace(/\s+/g, " ")
    .trim();
}

export function pendingSuggestions(): DepSuggestion[] {
  return getDb()
    .prepare(
      `SELECT s.id, s.depends_on AS a, s.task_id AS b, s.confidence, s.reason AS why FROM dep_suggestions s
       JOIN tasks x ON x.id = s.task_id AND x.deleted_at IS NULL AND x.status <> 'done'
       JOIN tasks y ON y.id = s.depends_on AND y.deleted_at IS NULL AND y.status <> 'done'
       WHERE s.state = 'pending' ORDER BY s.confidence DESC, s.created_at`,
    )
    .all() as DepSuggestion[];
}

/**
 * Asks the local model which open tasks must be finished before others can start. Tasks are shown to it as short labels (T1, T2, ...)
 * so it cannot invent ids; every answer is validated (known tasks, no loops, not already linked, not dismissed before) and only
 * stored as a PENDING suggestion. Nothing changes in the workflow until the user accepts one.
 */
export async function generateDepSuggestions(opts: { model?: string; signal?: AbortSignal } = {}): Promise<{ added: number; considered: number }> {
  const db = getDb();
  const open = db.prepare("SELECT * FROM tasks WHERE deleted_at IS NULL AND status <> 'done' ORDER BY due_date IS NULL, due_date, created_at LIMIT 60").all() as Task[];
  if (open.length < 2) return { added: 0, considered: open.length };
  const projects = new Map(listProjects().map((p) => [p.id, p.name]));
  const label = new Map(open.map((t, i) => [`T${i + 1}`, t]));
  const labelOf = new Map(open.map((t, i) => [t.id, `T${i + 1}`]));
  const shortTitles = new Map(open.map((t, i) => [`T${i + 1}`, t.title.length > 48 ? `${t.title.slice(0, 47)}…` : t.title]));
  const lines = open.map((t, i) => `T${i + 1} | ${projects.get(t.project_id ?? "") ?? "no project"} | due ${t.due_date ?? "none"} | ${t.title}${t.description ? ` -- ${t.description.replace(/\s+/g, " ").slice(0, 100)}` : ""}`);
  const existing = listDeps().filter((d) => labelOf.has(d.a) && labelOf.has(d.b)).map((d) => `${labelOf.get(d.a)} before ${labelOf.get(d.b)}`);
  const system = `You find hidden ordering between tasks in a personal task system: pairs where one task must be FINISHED before the other can sensibly start (the second needs the first's result).
Rules:
- Only use the labels T1, T2, ... given below. "first" is the task to finish first, "then" is the task that waits for it.
- Only propose links where the order is genuinely required or strongly implied by the task wording. Do not link tasks merely because they share a project or topic.
- Give "confidence" from 0 to 100 and a one-sentence "reason" quoting what makes the order necessary.
- Return at most ${MAX_DEP_SUGGESTIONS} links, best first. Return an empty list if nothing is clearly ordered.
- Do not repeat these existing links: ${existing.join(", ") || "(none)"}.

TASKS:
${lines.join("\n")}`;
  const messages: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: "Which of these tasks must be finished before others can start?" }];
  const raw = await getProvider().chatJson(opts.model || getChatModel(), messages, modelSchema, opts.signal);
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) throw new ApiError(502, "The model returned suggestions in an unexpected format. Try again.", "bad_model_output");

  const known = db.prepare("SELECT task_id, depends_on FROM dep_suggestions").all() as { task_id: string; depends_on: string }[];
  const seen = new Set(known.map((k) => `${k.depends_on}>${k.task_id}`));
  const confirmed = listDeps();
  const insert = db.prepare("INSERT INTO dep_suggestions (id, task_id, depends_on, confidence, reason, state, model, created_at) VALUES (?,?,?,?,?, 'pending', ?, ?)");
  let added = 0;
  for (const l of parsed.data.links) {
    if (added >= MAX_DEP_SUGGESTIONS) break;
    const a = label.get(l.first.trim().toUpperCase());
    const b = label.get(l.then.trim().toUpperCase());
    if (!a || !b || a.id === b.id) continue;
    const key = `${a.id}>${b.id}`;
    if (seen.has(key) || seen.has(`${b.id}>${a.id}`)) continue; // already proposed, accepted or dismissed (either direction)
    if (confirmed.some((d) => d.a === a.id && d.b === b.id) || wouldCycle(confirmed, a.id, b.id)) continue;
    insert.run(newId(), b.id, a.id, Math.round(l.confidence), humanizeReason(l.reason, shortTitles), opts.model || getChatModel(), nowIso());
    seen.add(key);
    added++;
  }
  return { added, considered: open.length };
}

/** Accepting turns the suggestion into a real dependency; dismissing remembers it so it is never proposed again. */
export function resolveSuggestion(id: string, action: "accept" | "dismiss"): void {
  const db = getDb();
  const s = db.prepare("SELECT * FROM dep_suggestions WHERE id = ?").get(id) as { id: string; task_id: string; depends_on: string; state: string } | undefined;
  if (!s) throw new ApiError(404, "Suggestion not found", "not_found");
  if (s.state !== "pending") throw new ApiError(409, "That suggestion was already handled.", "conflict");
  if (action === "accept") addDep(s.task_id, s.depends_on);
  db.prepare("UPDATE dep_suggestions SET state = ? WHERE id = ?").run(action === "accept" ? "accepted" : "dismissed", id);
}

/* ---------------- everything the Workflow page needs ---------------- */

export interface WorkflowNote { id: string; title: string; updated_at: string }
export interface WorkflowCapture { id: string; title: string }
export interface WorkflowLink { a: string; b: string }
export interface WorkflowData {
  projects: (Project & { open_tasks: number })[];
  tasks: Task[];
  deps: Dep[];
  suggestions: DepSuggestion[];
  notes: WorkflowNote[];
  tags: { id: string; title: string }[];
  captures: WorkflowCapture[];
  /** Mentions: note-project, tag-note, capture-task and capture-note. Ids are prefixed tag:/ for tags so they never clash with record ids. */
  links: WorkflowLink[];
}

const preview = (s: string): string => (s.replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled capture");

export function workflowData(today: string = ymd()): WorkflowData {
  const db = getDb();
  const since = addDays(isYmd(today) ? today : ymd(), -14);
  const tasks = db
    .prepare(
      `SELECT * FROM tasks WHERE deleted_at IS NULL AND (status <> 'done' OR substr(completed_at, 1, 10) >= ?)
       ORDER BY due_date IS NULL, due_date, created_at LIMIT 400`,
    )
    .all(since) as Task[];
  const taskIds = new Set(tasks.map((t) => t.id));
  const projects = listProjects().filter((p) => p.status !== "archived");
  const projectIds = new Set(projects.map((p) => p.id));

  const notes = db.prepare("SELECT id, title, updated_at FROM notes ORDER BY updated_at DESC LIMIT 60").all() as WorkflowNote[];
  const noteIds = new Set(notes.map((n) => n.id));
  const links: WorkflowLink[] = [];

  for (const r of db.prepare("SELECT project_id, note_id FROM project_notes").all() as { project_id: string; note_id: string }[]) {
    if (projectIds.has(r.project_id) && noteIds.has(r.note_id)) links.push({ a: r.note_id, b: r.project_id });
  }
  const tagSet = new Map<string, string>();
  for (const r of db.prepare("SELECT note_id, tag FROM note_tags").all() as { note_id: string; tag: string }[]) {
    if (!noteIds.has(r.note_id)) continue;
    const id = `tag:${r.tag}`;
    tagSet.set(id, `#${r.tag}`);
    links.push({ a: id, b: r.note_id });
  }

  const caps = new Map<string, WorkflowCapture>();
  for (const r of db.prepare("SELECT id, content, note_id FROM captures WHERE archived = 0 ORDER BY created_at DESC LIMIT 200").all() as { id: string; content: string; note_id: string | null }[]) {
    const withNote = r.note_id && noteIds.has(r.note_id);
    if (withNote) { caps.set(r.id, { id: r.id, title: preview(r.content) }); links.push({ a: r.id, b: r.note_id! }); }
  }
  for (const r of db.prepare("SELECT t.id AS task_id, c.id, c.content FROM tasks t JOIN captures c ON c.id = t.capture_id WHERE t.deleted_at IS NULL").all() as { task_id: string; id: string; content: string }[]) {
    if (!taskIds.has(r.task_id)) continue;
    caps.set(r.id, { id: r.id, title: preview(r.content) });
    links.push({ a: r.id, b: r.task_id });
  }

  return {
    projects: projects.map((p) => ({ ...p, open_tasks: p.open_tasks })),
    tasks,
    deps: listDeps().filter((d) => taskIds.has(d.a) && taskIds.has(d.b)),
    suggestions: pendingSuggestions().filter((s) => taskIds.has(s.a) && taskIds.has(s.b)),
    notes,
    tags: [...tagSet].map(([id, title]) => ({ id, title })),
    captures: [...caps.values()],
    links,
  };
}
