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
