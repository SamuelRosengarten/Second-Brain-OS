import { z } from "zod";
import { getDb } from "./db.ts";
import { ApiError } from "./api.ts";
import { addDays } from "./dates.ts";
import { newId, nowIso, todayLocal } from "./util.ts";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const projectShape = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000),
  status: z.enum(["planned", "active", "paused", "done", "archived"]),
  goals: z.string().max(5000),
  target_date: dateStr.nullable().optional(),
};
export const ProjectInput = z.object({ ...projectShape, description: projectShape.description.default(""), status: projectShape.status.default("active"), goals: projectShape.goals.default("") });
// Patch schemas carry no defaults: omitted fields must stay untouched.
export const ProjectPatch = z.object(projectShape).partial();

const taskShape = {
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000),
  status: z.enum(["todo", "doing", "done"]),
  priority: z.enum(["low", "medium", "high"]),
  due_date: dateStr.nullable().optional(),
  project_id: z.string().nullable().optional(),
  capture_id: z.string().nullable().optional(),
};
export const TaskInput = z.object({ ...taskShape, description: taskShape.description.default(""), status: taskShape.status.default("todo"), priority: taskShape.priority.default("medium") });
export const TaskPatch = z.object(taskShape).partial();

export interface Project {
  id: string; name: string; description: string; status: string; goals: string;
  target_date: string | null; created_at: string; updated_at: string;
}
export interface Task {
  id: string; title: string; description: string; status: "todo" | "doing" | "done"; priority: "low" | "medium" | "high";
  due_date: string | null; project_id: string | null; capture_id: string | null; created_at: string; completed_at: string | null;
}

function logActivity(projectId: string | null | undefined, kind: string, message: string): void {
  if (!projectId) return;
  getDb().prepare("INSERT INTO activity (project_id, kind, message, created_at) VALUES (?, ?, ?, ?)").run(projectId, kind, message, nowIso());
}

// ---------- projects ----------
export function createProject(input: z.input<typeof ProjectInput>): Project {
  const p = ProjectInput.parse(input);
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare("INSERT INTO projects (id, name, description, status, goals, target_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, p.name, p.description, p.status, p.goals, p.target_date ?? null, now, now);
  logActivity(id, "project.created", `Project “${p.name}” created`);
  return getProject(id)!;
}

export const getProject = (id: string): Project | null =>
  (getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined) ?? null;

export function listProjects(status?: string): (Project & { open_tasks: number; note_count: number })[] {
  return getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks,
              (SELECT COUNT(*) FROM project_notes pn WHERE pn.project_id = p.id) AS note_count
       FROM projects p ${status ? "WHERE p.status = ?" : ""} ORDER BY p.status = 'archived', p.updated_at DESC`,
    )
    .all(...(status ? [status] : [])) as (Project & { open_tasks: number; note_count: number })[];
}

export function updateProject(id: string, patch: z.input<typeof ProjectPatch>): Project {
  const cur = getProject(id);
  if (!cur) throw new ApiError(404, "Project not found", "not_found");
  const p = ProjectPatch.parse(patch);
  const next = { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Project;
  getDb()
    .prepare("UPDATE projects SET name=?, description=?, status=?, goals=?, target_date=?, updated_at=? WHERE id=?")
    .run(next.name, next.description, next.status, next.goals, next.target_date ?? null, nowIso(), id);
  if (p.status && p.status !== cur.status) logActivity(id, "project.status", `Status changed from ${cur.status} to ${p.status}`);
  else logActivity(id, "project.updated", "Project details updated");
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  if (!getProject(id)) throw new ApiError(404, "Project not found", "not_found");
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id); // tasks keep existing (project_id set null)
}

export function linkNote(projectId: string, noteId: string): void {
  const db = getDb();
  if (!getProject(projectId)) throw new ApiError(404, "Project not found", "not_found");
  const n = db.prepare("SELECT title FROM notes WHERE id = ?").get(noteId) as { title: string } | undefined;
  if (!n) throw new ApiError(404, "Note not found", "not_found");
  const r = db.prepare("INSERT OR IGNORE INTO project_notes (project_id, note_id) VALUES (?, ?)").run(projectId, noteId);
  if (r.changes) logActivity(projectId, "note.linked", `Linked note “${n.title}”`);
}
export function unlinkNote(projectId: string, noteId: string): void {
  getDb().prepare("DELETE FROM project_notes WHERE project_id = ? AND note_id = ?").run(projectId, noteId);
  logActivity(projectId, "note.unlinked", "Unlinked a note");
}

export function projectDetail(id: string) {
  const db = getDb();
  const project = getProject(id);
  if (!project) return null;
  return {
    project,
    tasks: listTasks({ project_id: id }),
    notes: db
      .prepare("SELECT n.id, n.title, n.category, n.updated_at FROM project_notes pn JOIN notes n ON n.id = pn.note_id WHERE pn.project_id = ? ORDER BY n.updated_at DESC")
      .all(id),
    activity: db.prepare("SELECT kind, message, created_at FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT 50").all(id),
  };
}

// ---------- tasks ----------
export function createTask(input: z.input<typeof TaskInput>): Task {
  const t = TaskInput.parse(input);
  const db = getDb();
  if (t.project_id && !getProject(t.project_id)) throw new ApiError(400, "Unknown project", "validation");
  const id = newId();
  const now = nowIso();
  db.prepare(
    "INSERT INTO tasks (id, title, description, status, priority, due_date, project_id, capture_id, created_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(id, t.title, t.description, t.status, t.priority, t.due_date ?? null, t.project_id ?? null, t.capture_id ?? null, now, t.status === "done" ? now : null);
  logActivity(t.project_id, "task.created", `Task “${t.title}” added`);
  return getTask(id)!;
}

export const getTask = (id: string): Task | null => (getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined) ?? null;

export interface TaskFilter {
  status?: string; priority?: string; project_id?: string; due?: "overdue" | "today" | "soon"; limit?: number;
  /** The caller's calendar date (YYYY-MM-DD). Defaults to the server clock; a phone in another timezone passes its own. */
  today?: string;
}
export function listTasks(f: TaskFilter = {}): Task[] {
  const where: string[] = [];
  const args: unknown[] = [];
  const today = f.today ?? todayLocal();
  if (f.status === "open") where.push("status <> 'done'");
  else if (f.status) { where.push("status = ?"); args.push(f.status); }
  if (f.priority) { where.push("priority = ?"); args.push(f.priority); }
  if (f.project_id) { where.push("project_id = ?"); args.push(f.project_id); }
  if (f.due === "overdue") { where.push("status <> 'done' AND due_date IS NOT NULL AND due_date < ?"); args.push(today); }
  if (f.due === "today") { where.push("status <> 'done' AND due_date = ?"); args.push(today); }
  if (f.due === "soon") {
    const end = addDays(today, 7);
    where.push("status <> 'done' AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?");
    args.push(today, end);
  }
  return getDb()
    .prepare(
      `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY status = 'done', due_date IS NULL, due_date,
                CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`,
    )
    .all(...args, Math.min(f.limit ?? 200, 500)) as Task[];
}

export function updateTask(id: string, patch: z.input<typeof TaskPatch>): Task {
  const cur = getTask(id);
  if (!cur) throw new ApiError(404, "Task not found", "not_found");
  const p = TaskPatch.parse(patch);
  const next = { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Task;
  if (next.project_id && !getProject(next.project_id)) throw new ApiError(400, "Unknown project", "validation");
  let completed = cur.completed_at;
  if (next.status === "done" && cur.status !== "done") completed = nowIso();
  if (next.status !== "done") completed = null;
  getDb()
    .prepare("UPDATE tasks SET title=?, description=?, status=?, priority=?, due_date=?, project_id=?, completed_at=? WHERE id=?")
    .run(next.title, next.description, next.status, next.priority, next.due_date ?? null, next.project_id ?? null, completed, id);
  if (next.status === "done" && cur.status !== "done") logActivity(next.project_id, "task.done", `Completed “${next.title}”`);
  return getTask(id)!;
}

export function deleteTask(id: string): void {
  if (!getTask(id)) throw new ApiError(404, "Task not found", "not_found");
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}
