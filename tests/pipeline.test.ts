import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffDays, horizonOf, packMarkers, projectHue, projectStats, roomToRight, taskState, timelineWindow, type PTask } from "../src/lib/pipeline.ts";
import { createProject, createTask, deleteTask, pipelineData, updateProject } from "../src/lib/projects.ts";
import { getDb } from "../src/lib/db.ts";
import { cleanup, freshEnv } from "./helpers.ts";

const T = (o: Partial<PTask>): PTask => ({ id: "x", title: "t", description: "", status: "todo", priority: "medium", due_date: null, project_id: null, completed_at: null, ...o });
const today = "2026-06-10";

describe("pipeline helpers", () => {
  it("counts calendar days across month ends and DST changes", () => {
    expect(diffDays("2026-06-10", "2026-06-10")).toBe(0);
    expect(diffDays("2026-01-31", "2026-03-01")).toBe(29);
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2); // EU DST switch
    expect(diffDays("2026-06-10", "2026-06-01")).toBe(-9);
  });
  it("classifies tasks by state and horizon", () => {
    expect(taskState(T({ due_date: "2026-06-09" }), today)).toBe("overdue");
    expect(taskState(T({ due_date: "2026-06-10" }), today)).toBe("soon");
    expect(taskState(T({ due_date: "2026-06-13" }), today)).toBe("soon");
    expect(taskState(T({ due_date: "2026-06-14" }), today)).toBe("todo");
    expect(taskState(T({ due_date: "2026-06-30", status: "doing" }), today)).toBe("doing");
    expect(taskState(T({}), today)).toBe("undated");
    expect(taskState(T({ status: "done", due_date: "2020-01-01" }), today)).toBe("done");
    const h = (d: string | null, status: PTask["status"] = "todo") => horizonOf(T({ due_date: d, status }), today);
    expect([h("2026-06-09"), h("2026-06-10"), h("2026-06-17"), h("2026-06-18"), h("2026-07-10"), h("2026-07-11"), h(null), h("2020-01-01", "done")]).toEqual(["overdue", "today", "week", "month", "month", "later", "undated", "done"]);
  });
  it("derives project health", () => {
    const open = (d: string | null, status: PTask["status"] = "todo") => T({ due_date: d, status });
    expect(projectStats([], today).health).toBe("idle");
    expect(projectStats([T({ status: "done" })], today).health).toBe("complete");
    expect(projectStats([open("2026-06-01"), T({ status: "done" })], today)).toMatchObject({ health: "behind", overdue: 1, progress: 0.5 });
    expect(projectStats([open("2026-06-11")], today).health).toBe("at-risk");
    expect(projectStats([open("2026-06-11", "doing")], today).health).toBe("on-track");
    expect(projectStats([open("2026-07-30")], today)).toMatchObject({ health: "on-track", nextDue: "2026-07-30" });
    expect(projectStats([open("2026-07-30")], today, { target_date: "2026-06-01" }).health).toBe("behind"); // target date already passed
  });
  it("keeps a stable, valid hue per project", () => {
    expect(projectHue("abc")).toBe(projectHue("abc"));
    for (const id of ["a", "b", "c", "d", "e", "ff-ee"]) { const h = projectHue(id); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(420); }
  });
  it("sizes the timeline window around today, reaching back to old overdue tasks but not forever", () => {
    expect(timelineWindow([], today, 42)).toEqual({ from: "2026-06-03", to: "2026-07-22", days: 50 });
    expect(timelineWindow([T({ due_date: "2026-05-25" })], today, 14).from).toBe("2026-05-25");
    expect(timelineWindow([T({ due_date: "2024-01-01" })], today, 14).from).toBe("2026-04-26"); // capped at 45 days back
    expect(timelineWindow([T({ due_date: "2020-01-01", status: "done" })], today, 14).from).toBe("2026-06-03"); // finished tasks never stretch it
  });
  it("packs colliding markers into rows and measures room for labels", () => {
    const { placed, rows } = packMarkers([{ item: "a", x: 10 }, { item: "b", x: 14 }, { item: "c", x: 60 }, { item: "d", x: 12 }], 26);
    expect(rows).toBe(3);
    const row = (n: string) => placed.find((p) => p.item === n)!.row;
    expect([row("a"), row("c")]).toEqual([0, 0]);
    expect(new Set([row("a"), row("d"), row("b")]).size).toBe(3);
    const room = roomToRight(placed, 300);
    expect(room.get(placed.find((p) => p.item === "a")!)).toBe(50);
    expect(room.get(placed.find((p) => p.item === "c")!)).toBe(240);
  });
});

describe("pipelineData", () => {
  let dir: string;
  beforeEach(() => { dir = freshEnv(); });
  afterEach(() => cleanup(dir));
  it("returns open tasks, recently finished ones, and skips archived projects and trashed tasks", () => {
    const p = createProject({ name: "Live" });
    const old = createProject({ name: "Old" });
    updateProject(old.id, { status: "archived" });
    createTask({ title: "open", project_id: p.id });
    const fresh = createTask({ title: "finished lately", status: "done", project_id: p.id });
    const stale = createTask({ title: "finished long ago", status: "done", project_id: p.id });
    const gone = createTask({ title: "trashed", project_id: p.id });
    getDb().prepare("UPDATE tasks SET completed_at = ? WHERE id = ?").run("2026-06-08T09:00:00.000Z", fresh.id);
    getDb().prepare("UPDATE tasks SET completed_at = ? WHERE id = ?").run("2026-03-01T09:00:00.000Z", stale.id);
    deleteTask(gone.id);
    const d = pipelineData("2026-06-10");
    expect(d.projects.map((x) => x.name)).toEqual(["Live"]);
    expect(d.tasks.map((t) => t.title).sort()).toEqual(["finished lately", "open"]);
  });
});
