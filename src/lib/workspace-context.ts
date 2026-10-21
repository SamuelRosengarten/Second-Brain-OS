import { addDays, ymd } from "./dates.ts";
import { listProjects, listTasks, type Task } from "./projects.ts";

export interface WorkspaceContext { text: string; projects: number; tasks: number }

const MAX_CHARS = 5000; // ~1.5k tokens: leaves room for the retrieved passages and the history in a small local context window
const STATUS: Record<Task["status"], string> = { todo: "to do", doing: "in progress", done: "done" };

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** A project is "mentioned" when any word of its name appears as a word in the question (case-insensitive). */
function mentioned(name: string, question: string): boolean {
  const q = new Set(words(question));
  return words(name).some((w) => q.has(w));
}

const RECENT_DONE_DAYS = 14; // finished tasks older than this are left out so "what did I finish lately?" works without flooding the prompt
const RECENT_DONE_MAX = 8;

function taskLine(t: Task, today: string): string {
  const meta = [`${t.priority} priority`];
  if (t.status === "done") {
    if (t.completed_at) meta.push(`completed ${t.completed_at.slice(0, 10)}`);
  } else if (t.due_date) meta.push(`due ${t.due_date}${t.due_date < today ? " OVERDUE" : ""}`);
  const d = t.description.replace(/\s+/g, " ").trim();
  return `  - [${STATUS[t.status]}] ${t.title} (${meta.join(", ")})${d ? `: ${d.slice(0, 100)}` : ""}`;
}

function recentDone(list: Task[], today: string, max: number): string[] {
  const since = addDays(today, -RECENT_DONE_DAYS);
  return list
    .filter((t) => t.status === "done" && (t.completed_at ?? "").slice(0, 10) >= since)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, max)
    .map((t) => taskLine(t, today));
}

/**
 * Plain-text snapshot of the user's projects and tasks, read live from the database, for the chat prompt.
 * Projects the question mentions come first and in full; the rest follow until the size budget is used up
 * (open tasks before finished ones, so the budget never hides what is still to do).
 */
export function buildWorkspaceContext(question: string, today = ymd()): WorkspaceContext {
  const projects = listProjects().filter((p) => p.status !== "archived");
  const tasks = listTasks({ limit: 500 });
  if (!projects.length && !tasks.length) return { text: "", projects: 0, tasks: 0 };

  const rank = (t: Task) => (t.status === "doing" ? 0 : t.status === "todo" ? 1 : 2);
  const byProject = new Map<string | null, Task[]>();
  for (const t of tasks) byProject.set(t.project_id, [...(byProject.get(t.project_id) ?? []), t]);
  for (const list of byProject.values()) list.sort((a, b) => rank(a) - rank(b) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  const ordered = [...projects].sort((a, b) => Number(mentioned(b.name, question)) - Number(mentioned(a.name, question)));
  const sections: { head: string; open: string[]; done: string[] }[] = ordered.map((p) => {
    const list = byProject.get(p.id) ?? [];
    const head = `Project "${p.name}" (${p.status}${p.target_date ? `, target ${p.target_date}` : ""})${p.goals ? ` goals: ${p.goals.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
    return { head, open: list.filter((t) => t.status !== "done").map((t) => taskLine(t, today)), done: recentDone(list, today, RECENT_DONE_MAX) };
  });
  const loose = byProject.get(null) ?? [];
  if (loose.length) sections.push({ head: "Tasks without a project", open: loose.filter((t) => t.status !== "done").map((t) => taskLine(t, today)), done: recentDone(loose, today, 3) });

  // Two passes keep the budget fair: every section gets its open tasks before any finished task is added.
  let used = 0;
  const out: string[][] = sections.map((s) => [s.head]);
  const add = (i: number, l: string): boolean => {
    if (used + l.length + 1 > MAX_CHARS) return false;
    out[i].push(l);
    used += l.length + 1;
    return true;
  };
  sections.forEach((s, i) => { used += s.head.length + 1; if (!s.open.length) add(i, "  (no open tasks)"); });
  let omitted = 0;
  sections.forEach((s, i) => s.open.forEach((l) => { if (!add(i, l)) omitted++; }));
  sections.forEach((s, i) => s.done.forEach((l) => add(i, l)));
  if (omitted) out.push([`(${omitted} more open task${omitted > 1 ? "s" : ""} not shown because of size limits)`]);

  return { text: out.map((s) => s.join("\n")).join("\n"), projects: projects.length, tasks: tasks.length };
}
