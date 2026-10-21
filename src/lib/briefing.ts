import { getDb } from "./db.ts";
import { captureCounts } from "./captures.ts";
import { listTasks, type Task } from "./projects.ts";
import { todayLocal } from "./util.ts";

export interface Briefing {
  generatedAt: string;
  today: string;
  counts: { openTasks: number; overdue: number; dueToday: number; awaitingReview: number; unprocessed: number; failed: number; activeProjects: number };
  overdue: Task[];
  dueToday: Task[];
  dueSoon: Task[];
  recentCaptures: { id: string; kind: string; status: string; preview: string; created_at: string }[];
  recentNotes: { id: string; title: string; updated_at: string }[];
  activeProjects: { id: string; name: string; open_tasks: number; target_date: string | null }[];
  awaitingReview: { id: string; title: string; created_at: string }[];
  /** Plain statements derived only from the rows above. No calendar data exists in this release. */
  notes: string[];
}

/** Everything here is computed from local database rows; nothing is generated or inferred by a model. */
export function buildBriefing(): Briefing {
  const db = getDb();
  const today = todayLocal();
  const overdue = listTasks({ due: "overdue" });
  const dueToday = listTasks({ due: "today" });
  const dueSoon = listTasks({ due: "soon" }).filter((t) => t.due_date !== today);
  const counts = captureCounts();
  const open = (db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status <> 'done'").get() as { c: number }).c;
  const activeProjects = db
    .prepare(
      `SELECT p.id, p.name, p.target_date, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks
       FROM projects p WHERE p.status = 'active' ORDER BY p.updated_at DESC LIMIT 10`,
    )
    .all() as Briefing["activeProjects"];
  const recentCaptures = (
    db.prepare("SELECT id, kind, status, content, created_at FROM captures WHERE archived = 0 ORDER BY created_at DESC LIMIT 6").all() as {
      id: string; kind: string; status: string; content: string; created_at: string;
    }[]
  ).map((c) => ({ id: c.id, kind: c.kind, status: c.status, preview: c.content.replace(/\s+/g, " ").slice(0, 120), created_at: c.created_at }));
  const recentNotes = db.prepare("SELECT id, title, updated_at FROM notes ORDER BY updated_at DESC LIMIT 6").all() as Briefing["recentNotes"];
  const awaitingReview = (
    db.prepare("SELECT id, content, proposal_json, created_at FROM captures WHERE status = 'proposed' AND archived = 0 ORDER BY created_at DESC LIMIT 10").all() as {
      id: string; content: string; proposal_json: string | null; created_at: string;
    }[]
  ).map((c) => {
    let title = c.content.replace(/\s+/g, " ").slice(0, 60);
    try { title = (JSON.parse(c.proposal_json ?? "{}") as { title?: string }).title || title; } catch { /* keep preview */ }
    return { id: c.id, title, created_at: c.created_at };
  });

  const notes: string[] = [];
  if (overdue.length) notes.push(`${overdue.length} task${overdue.length === 1 ? " is" : "s are"} overdue.`);
  if (dueToday.length) notes.push(`${dueToday.length} task${dueToday.length === 1 ? " is" : "s are"} due today.`);
  if (counts.awaitingReview) notes.push(`${counts.awaitingReview} capture${counts.awaitingReview === 1 ? " is" : "s are"} waiting for your review.`);
  if (counts.failed) notes.push(`${counts.failed} capture${counts.failed === 1 ? "" : "s"} failed AI processing and can be retried.`);
  if (counts.unprocessed) notes.push(`${counts.unprocessed} capture${counts.unprocessed === 1 ? " has" : "s have"} not been processed yet.`);
  if (!notes.length) notes.push("Nothing needs attention right now.");
  notes.push("Calendar events are not shown: no calendar is connected.");

  return {
    generatedAt: new Date().toISOString(), today,
    counts: {
      openTasks: open, overdue: overdue.length, dueToday: dueToday.length, awaitingReview: counts.awaitingReview,
      unprocessed: counts.unprocessed, failed: counts.failed, activeProjects: activeProjects.length,
    },
    overdue, dueToday, dueSoon, recentCaptures, recentNotes, activeProjects, awaitingReview, notes,
  };
}
