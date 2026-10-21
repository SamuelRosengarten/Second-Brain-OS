/** Pure helpers behind the Pipeline page (no Node or React imports, so they run in the browser and in unit tests). */
import { addDays } from "./dates.ts";

export interface PTask {
  id: string; title: string; description: string; status: "todo" | "doing" | "done"; priority: "low" | "medium" | "high";
  due_date: string | null; project_id: string | null; completed_at: string | null;
}
export interface PProject { id: string; name: string; status: string; target_date: string | null; goals: string }

/** How a task should look: color AND icon come from this, so nothing relies on color alone. */
export type TaskState = "overdue" | "soon" | "doing" | "todo" | "done" | "undated";
export const SOON_DAYS = 3;

/** Whole calendar days from `a` to `b` (positive when b is later). Immune to DST because it works on UTC dates. */
export function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function taskState(t: Pick<PTask, "status" | "due_date">, today: string): TaskState {
  if (t.status === "done") return "done";
  if (t.due_date && t.due_date < today) return "overdue";
  if (t.due_date && diffDays(today, t.due_date) <= SOON_DAYS) return "soon";
  if (t.status === "doing") return "doing";
  if (!t.due_date) return "undated";
  return "todo";
}

export const STATE_LABEL: Record<TaskState, string> = {
  overdue: "Overdue", soon: "Due soon", doing: "In progress", todo: "To do", done: "Done", undated: "No due date",
};

/** Due-date buckets for the Horizon view, soonest first. */
export const HORIZONS = ["overdue", "today", "week", "month", "later", "undated", "done"] as const;
export type Horizon = (typeof HORIZONS)[number];
export const HORIZON_LABEL: Record<Horizon, string> = {
  overdue: "Overdue", today: "Today", week: "Next 7 days", month: "Next 30 days", later: "Later", undated: "No date", done: "Done lately",
};

export function horizonOf(t: Pick<PTask, "status" | "due_date">, today: string): Horizon {
  if (t.status === "done") return "done";
  if (!t.due_date) return "undated";
  const d = diffDays(today, t.due_date);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  if (d <= 30) return "month";
  return "later";
}

/** A stable hue (0-359) per project so a project keeps its color in every view and every session. */
export function projectHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  // Golden-angle spacing would need an index; hashing is enough, but skip the muddy yellow-green band.
  const hue = (h >>> 0) % 360;
  return hue > 55 && hue < 85 ? hue + 40 : hue;
}

export type Health = "behind" | "at-risk" | "on-track" | "idle" | "complete";
export interface ProjectStats {
  total: number; done: number; doing: number; todo: number; overdue: number; soon: number; undated: number;
  /** done / total, 0..1 */
  progress: number;
  nextDue: string | null;
  health: Health;
}
export const HEALTH_LABEL: Record<Health, string> = { behind: "Behind", "at-risk": "At risk", "on-track": "On track", idle: "No open tasks", complete: "Complete" };

export function projectStats(tasks: PTask[], today: string, project?: Pick<PProject, "target_date">): ProjectStats {
  const s: ProjectStats = { total: tasks.length, done: 0, doing: 0, todo: 0, overdue: 0, soon: 0, undated: 0, progress: 0, nextDue: null, health: "idle" };
  for (const t of tasks) {
    const st = taskState(t, today);
    if (st === "done") s.done++;
    else {
      if (t.status === "doing") s.doing++;
      else s.todo++;
      if (st === "overdue") s.overdue++;
      if (st === "soon") s.soon++;
      if (!t.due_date) s.undated++;
      else if (t.due_date >= today && (!s.nextDue || t.due_date < s.nextDue)) s.nextDue = t.due_date;
    }
  }
  const open = s.total - s.done;
  s.progress = s.total ? s.done / s.total : 0;
  if (!s.total || (!open && !s.done)) s.health = "idle";
  else if (!open) s.health = "complete";
  else if (s.overdue > 0 || (project?.target_date && project.target_date < today)) s.health = "behind";
  else if (s.soon > 0 && s.doing === 0) s.health = "at-risk";
  else s.health = "on-track";
  return s;
}

export interface Window { from: string; to: string; days: number }

/**
 * The visible date range of the timeline: a little history before today (or back to the oldest overdue task, capped)
 * through `rangeDays` ahead. Tasks outside it are clamped to the edges and counted by the caller.
 */
export function timelineWindow(tasks: PTask[], today: string, rangeDays: number): Window {
  let from = addDays(today, -7);
  for (const t of tasks) if (t.status !== "done" && t.due_date && t.due_date < from) from = t.due_date;
  if (diffDays(from, today) > 45) from = addDays(today, -45);
  const to = addDays(today, rangeDays);
  return { from, to, days: diffDays(from, to) + 1 };
}

export interface Placed<T> { item: T; x: number; row: number }

/**
 * Greedy lane packing: items sorted by x are placed in the first row where they do not collide with the previous item
 * of that row (`gap` pixels apart). Returns placements plus the number of rows used.
 */
export function packMarkers<T>(items: { item: T; x: number }[], gap: number): { placed: Placed<T>[]; rows: number } {
  const lastX: number[] = [];
  const placed: Placed<T>[] = [];
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    let row = lastX.findIndex((x) => it.x - x >= gap);
    if (row < 0) { row = lastX.length; lastX.push(it.x); } else lastX[row] = it.x;
    placed.push({ item: it.item, x: it.x, row });
  }
  return { placed, rows: Math.max(1, lastX.length) };
}

/** Free pixels to the right of each placed marker in its own row (Infinity for the last one), used to decide where a title fits. */
export function roomToRight<T>(placed: Placed<T>[], laneWidth: number): Map<Placed<T>, number> {
  const out = new Map<Placed<T>, number>();
  const byRow = new Map<number, Placed<T>[]>();
  for (const p of placed) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
  for (const list of byRow.values()) {
    list.sort((a, b) => a.x - b.x);
    list.forEach((p, i) => out.set(p, (list[i + 1]?.x ?? laneWidth) - p.x));
  }
  return out;
}
