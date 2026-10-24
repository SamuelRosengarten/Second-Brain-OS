import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePlan, replaceWithPlan } from "../src/lib/plan-import.ts";
import { createProject, createTask, listProjects, listTasks, updateTask } from "../src/lib/projects.ts";
import { cleanup, freshEnv } from "./helpers.ts";

const PLAN = `# Plan

| # | Task | Priority | Start | Due | Audit |
|---|---|---|---|---|---|
| 1 | Sketch the architecture | High | 2026-10-23 | 2026-10-25 |  |
| 2 | Design the schema | Low | 2026-11-02 | 2026-11-08 | M-05, L-09 |
`;

describe("parsePlan", () => {
  it("reads rows, priorities and dates", () => {
    expect(parsePlan(PLAN)).toEqual([
      { n: 1, title: "Sketch the architecture", priority: "high", start: "2026-10-23", due: "2026-10-25", audit: "" },
      { n: 2, title: "Design the schema", priority: "low", start: "2026-11-02", due: "2026-11-08", audit: "M-05, L-09" },
    ]);
  });
  it("rejects bad dates and priorities", () => {
    expect(() => parsePlan(PLAN.replace("2026-10-25", "soon"))).toThrow(/Bad date/);
    expect(() => parsePlan(PLAN.replace("| Low |", "| Huge |"))).toThrow(/priority/);
    expect(() => parsePlan("nothing here")).toThrow(/No task rows/);
  });
});

describe("start dates and replaceWithPlan", () => {
  let dir: string;
  beforeEach(() => { dir = freshEnv(); });
  afterEach(() => cleanup(dir));

  it("stores a start date and keeps it when other fields change", () => {
    const t = createTask({ title: "Range", start_date: "2026-10-01", due_date: "2026-10-05" });
    expect(updateTask(t.id, { title: "Renamed" }).start_date).toBe("2026-10-01");
    expect(updateTask(t.id, { start_date: null }).start_date).toBeNull();
  });
  it("refuses a start date after the due date", () => {
    expect(() => createTask({ title: "Backwards", start_date: "2026-10-06", due_date: "2026-10-05" })).toThrow(/Start date/);
    const t = createTask({ title: "Ok", due_date: "2026-10-05" });
    expect(() => updateTask(t.id, { start_date: "2026-10-09" })).toThrow(/Start date/);
  });
  it("replaces all projects and tasks with the plan", () => {
    const old = createProject({ name: "Old" });
    createTask({ title: "Old task", project_id: old.id });
    const r = replaceWithPlan("Synapse-OS", parsePlan(PLAN));
    expect(r).toMatchObject({ removedProjects: 1, removedTasks: 1 });
    expect(listProjects().map((p) => p.name)).toEqual(["Synapse-OS"]);
    const tasks = listTasks({ project_id: r.project });
    expect(tasks.map((t) => [t.title, t.start_date, t.due_date])).toEqual([
      ["Sketch the architecture", "2026-10-23", "2026-10-25"],
      ["Design the schema", "2026-11-02", "2026-11-08"],
    ]);
    expect(tasks[1].description).toBe("Audit: M-05, L-09");
  });
});
