import { getDb } from "./db.ts";
import { createProject, createTask, type Task } from "./projects.ts";

export interface PlanTask { n: number; title: string; priority: "low" | "medium" | "high"; start: string; due: string; audit: string }

const PRIORITY = { high: "high", medium: "medium", low: "low" } as const;

/** Reads the rows of the task table in a plan file: | # | Task | Priority | Start | Due | Audit |. */
export function parsePlan(markdown: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
    if (cells.length !== 6) throw new Error(`Expected 6 columns, got ${cells.length}: ${line}`);
    const [n, title, priority, start, due, audit] = cells;
    const p = PRIORITY[priority.toLowerCase() as keyof typeof PRIORITY];
    if (!p) throw new Error(`Unknown priority "${priority}" on task ${n}`);
    for (const d of [start, due]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Bad date "${d}" on task ${n}`);
    tasks.push({ n: Number(n), title, priority: p, start, due, audit });
  }
  if (!tasks.length) throw new Error("No task rows found");
  return tasks;
}

/**
 * Removes every project and task (hard delete, no trash), then creates one project with the plan's tasks.
 * Runs in one transaction, so a bad row leaves the old data untouched. Take a backup first.
 */
export function replaceWithPlan(projectName: string, plan: PlanTask[]): { project: string; removedProjects: number; removedTasks: number; tasks: Task[] } {
  const db = getDb();
  return db.transaction(() => {
    const removedTasks = db.prepare("DELETE FROM tasks").run().changes; // task_deps and dep_suggestions cascade
    const removedProjects = db.prepare("DELETE FROM projects").run().changes; // project_notes and activity cascade
    db.prepare("UPDATE captures SET hint_project_id = NULL WHERE hint_project_id IS NOT NULL").run();
    const last = plan.map((t) => t.due).sort().at(-1)!;
    const project = createProject({ name: projectName, description: "Task plan imported from synapse-task-plan.md.", target_date: last });
    const tasks = plan.map((t) =>
      createTask({ title: t.title, description: t.audit ? `Audit: ${t.audit}` : "", priority: t.priority, start_date: t.start, due_date: t.due, project_id: project.id }),
    );
    return { project: project.id, removedProjects, removedTasks, tasks };
  })();
}
