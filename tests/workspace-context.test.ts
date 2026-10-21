import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatStream } from "../src/lib/chat.ts";
import { createProject, createTask, updateProject } from "../src/lib/projects.ts";
import { setProvider } from "../src/lib/ollama.ts";
import { buildWorkspaceContext } from "../src/lib/workspace-context.ts";
import { cleanup, fakeProvider, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

async function readStream(s: ReadableStream<Uint8Array>) {
  const text = await new Response(s).text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("workspace context for the chat", () => {
  it("lists projects and tasks with status, priority and overdue marks, putting the mentioned project first", () => {
    const garden = createProject({ name: "Garden", goals: "Grow tomatoes" });
    const li = createProject({ name: "LinkedIn", goals: "Find an internship" });
    createTask({ title: "Water the beds", project_id: garden.id });
    createTask({ title: "Update headline", status: "doing", priority: "high", due_date: "2026-01-02", project_id: li.id });
    createTask({ title: "Write post", project_id: li.id });
    createTask({ title: "Old finished thing", status: "done", project_id: li.id });
    createTask({ title: "Buy milk" });
    const ctx = buildWorkspaceContext("What tasks are in progress for Linkedin", "2026-06-01");
    expect(ctx.projects).toBe(2);
    expect(ctx.text.indexOf('Project "LinkedIn"')).toBeLessThan(ctx.text.indexOf('Project "Garden"'));
    expect(ctx.text).toContain("[in progress] Update headline (high priority, due 2026-01-02 OVERDUE)");
    expect(ctx.text).toContain("[to do] Write post");
    expect(ctx.text).toContain("[done] Old finished thing");
    expect(ctx.text).toContain("Tasks without a project");
    expect(ctx.text.indexOf("Update headline")).toBeLessThan(ctx.text.indexOf("Write post")); // in progress before to do
  });
  it("leaves out archived projects, stays within its size budget and says what it left out", () => {
    const old = createProject({ name: "Old thing" });
    updateProject(old.id, { status: "archived" });
    const p = createProject({ name: "Big" });
    for (let i = 0; i < 120; i++) createTask({ title: `Task number ${i} ${"x".repeat(60)}`, project_id: p.id });
    const ctx = buildWorkspaceContext("anything");
    expect(ctx.text).not.toContain("Old thing");
    expect(ctx.text.length).toBeLessThan(5400);
    expect(ctx.text).toMatch(/\(\d+ more open tasks? not shown/);
  });
  it("is empty for a fresh install", () => {
    expect(buildWorkspaceContext("hi").text).toBe("");
  });
  it("reaches the model through the grounded chat, and answers can use it even when no note matches", async () => {
    const fp = fakeProvider({ chatChunks: ["ok"] });
    setProvider(fp);
    const li = createProject({ name: "LinkedIn" });
    createTask({ title: "Update headline", status: "doing", project_id: li.id });
    const events = await readStream(chatStream({ message: "What task are in progress for Linkedin", useLibrary: true }));
    expect(events[0]).toMatchObject({ type: "meta", grounded: true, workspace: { projects: 1, tasks: 1 } });
    const sys = fp.chatCalls[0].system;
    expect(sys).toContain("WORKSPACE");
    expect(sys).toContain("[in progress] Update headline");
    // library off: nothing from the workspace is sent
    await readStream(chatStream({ message: "hello", useLibrary: false }));
    expect(fp.chatCalls[1].system).not.toContain("WORKSPACE");
  });
});

describe("task trash", () => {
  it("hides trashed tasks everywhere, restores the same task, purges for good and expires after 30 days", async () => {
    const { deleteTask, getTask, listTasks, listTrash, restoreTask, createProject: mk, listProjects } = await import("../src/lib/projects.ts");
    const { getDb } = await import("../src/lib/db.ts");
    const { buildBriefing } = await import("../src/lib/briefing.ts");
    const p = mk({ name: "P" });
    const a = createTask({ title: "Keep", project_id: p.id });
    const b = createTask({ title: "Trash me", project_id: p.id, priority: "high", due_date: "2026-12-01" });
    deleteTask(b.id);
    expect(listTasks().map((t) => t.title)).toEqual(["Keep"]);
    expect(listProjects()[0].open_tasks).toBe(1);
    expect(buildBriefing("2026-06-01").counts.openTasks).toBe(1);
    expect(buildWorkspaceContext("x").text).not.toContain("Trash me");
    expect(listTrash().map((t) => t.id)).toEqual([b.id]);

    const back = restoreTask(b.id);
    expect(back).toMatchObject({ id: b.id, title: "Trash me", priority: "high", due_date: "2026-12-01", project_id: p.id, deleted_at: null });
    expect(listTasks().length).toBe(2);

    deleteTask(b.id, true);
    expect(getTask(b.id)).toBeNull();

    deleteTask(a.id);
    getDb().prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 86_400_000).toISOString(), a.id);
    expect(listTrash()).toEqual([]);
    expect(getTask(a.id)).toBeNull();
  });
});

describe("notes sorting", () => {
  it("orders by updated, created or title, and ignores unknown sort keys", async () => {
    const { createNote, listNotes, updateNote } = await import("../src/lib/notes.ts");
    const b = createNote({ title: "banana", body: "x" });
    await new Promise((r) => setTimeout(r, 5));
    const a = createNote({ title: "Apple", body: "x" });
    await new Promise((r) => setTimeout(r, 5));
    createNote({ title: "cherry", body: "x" });
    await new Promise((r) => setTimeout(r, 5));
    updateNote(b.id, { body: "changed" });
    const titles = (sort?: string) => listNotes({ sort: sort as never }).map((n) => n.title);
    expect(titles("title")).toEqual(["Apple", "banana", "cherry"]);
    expect(titles("created")).toEqual(["cherry", "Apple", "banana"]);
    expect(titles("updated")[0]).toBe("banana");
    expect(titles("; DROP TABLE notes")).toEqual(titles("updated"));
    expect(a.title).toBe("Apple");
  });
});

describe("chat memory of finished work", () => {
  it("shows recently completed tasks with their completion date and leaves out old ones", async () => {
    const { getDb } = await import("../src/lib/db.ts");
    const p = createProject({ name: "Work" });
    const recent = createTask({ title: "Shipped feature", status: "done", project_id: p.id });
    const old = createTask({ title: "Ancient chore", status: "done", project_id: p.id });
    getDb().prepare("UPDATE tasks SET completed_at = ? WHERE id = ?").run("2026-05-01T10:00:00.000Z", old.id);
    getDb().prepare("UPDATE tasks SET completed_at = ? WHERE id = ?").run("2026-05-28T10:00:00.000Z", recent.id);
    const text = buildWorkspaceContext("what did I finish", "2026-06-01").text;
    expect(text).toContain("[done] Shipped feature (medium priority, completed 2026-05-28)");
    expect(text).not.toContain("Ancient chore");
  });
});

describe("AI task suggestions", () => {
  it("cleans up model output: real projects only, no duplicates, no past or invalid dates, capped, and saves nothing", async () => {
    const { suggestTasks } = await import("../src/lib/task-suggestions.ts");
    const { listTasks } = await import("../src/lib/projects.ts");
    const li = createProject({ name: "LinkedIn" });
    createTask({ title: "Update headline", project_id: li.id });
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Extra step ${i}`, description: "", priority: "low", due_date: "", project: "" }));
    const fp = fakeProvider({
      json: {
        tasks: [
          { title: "  Post  about Code Coach ", description: "short", priority: "high", due_date: "2026-07-01", project: "linkedin" },
          { title: "update headline", description: "", priority: "medium", due_date: "", project: "LinkedIn" }, // duplicate of an open task
          { title: "Ask for a recommendation", description: "", priority: "medium", due_date: "2020-01-01", project: "Made up project" }, // past date, unknown project
          { title: "Fix typo", description: "", priority: "low", due_date: "2026-02-31", project: "" }, // impossible date
          { title: "", description: "", priority: "low", due_date: "", project: "" },
          ...many,
        ],
      },
    });
    setProvider(fp);
    const before = listTasks().length;
    const r = await suggestTasks({ request: "plan my linkedin week", today: "2026-06-01" });
    expect(r.suggestions.length).toBe(8);
    expect(r.suggestions[0]).toMatchObject({ title: "Post about Code Coach", priority: "high", due_date: "2026-07-01", project_id: li.id, project_name: "LinkedIn" });
    expect(r.suggestions[1]).toMatchObject({ title: "Ask for a recommendation", due_date: null, project_id: null });
    expect(r.suggestions[2]).toMatchObject({ title: "Fix typo", due_date: null });
    expect(r.skippedDuplicates).toBe(1);
    expect(listTasks().length).toBe(before); // proposing never creates anything
    expect(fp.chatCalls.length).toBe(0); // (chatJson is not recorded as chat)
    expect(fp.jsonCalls).toBe(1);
  });
  it("forces the chosen project, rejects an unknown one and reports a malformed model reply", async () => {
    const { suggestTasks } = await import("../src/lib/task-suggestions.ts");
    const p = createProject({ name: "Garden" });
    setProvider(fakeProvider({ json: { tasks: [{ title: "Buy seeds", description: "", priority: "medium", due_date: "", project: "Something else" }] } }));
    const r = await suggestTasks({ request: "garden", projectId: p.id });
    expect(r.suggestions[0].project_id).toBe(p.id);
    await expect(suggestTasks({ request: "x", projectId: "nope" })).rejects.toThrow(/Unknown project/);
    setProvider(fakeProvider({ json: { nonsense: true } }));
    await expect(suggestTasks({ request: "x" })).rejects.toThrow(/unexpected format/);
  });
});

describe("duplicate detection for suggestions", () => {
  it("flags reworded copies of an existing task but not genuinely different ones", async () => {
    const { similarTitles } = await import("../src/lib/task-suggestions.ts");
    const existing = "Make the first 20 connections: classmates, teachers, club members, family friends";
    expect(similarTitles(existing, "Execute the first batch of 20 connection requests to classmates, teachers, and club members")).toBe(true);
    expect(similarTitles("Ask 2 teachers or mentors for a recommendation", "Ask 2 teachers or mentors for a recommendation letter to strengthen your profile")).toBe(true);
    expect(similarTitles("Review progress toward 50 connections and update the profile", "Review progress toward 50 connections and adjust the weekly strategy")).toBe(true);
    expect(similarTitles(existing, "Buy cedar boards for the raised bed")).toBe(false);
    expect(similarTitles("Write a post", "Write a blog post")).toBe(false); // too short to be sure: floor of 3 shared words
    expect(similarTitles("", "anything")).toBe(false);
  });
});
