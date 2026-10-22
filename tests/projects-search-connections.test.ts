import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db.ts";
import { noteConnections } from "../src/lib/note-connections.ts";
import { createNote, deleteNote } from "../src/lib/notes.ts";
import { setProvider } from "../src/lib/ollama.ts";
import {
  createProject, createTask, deleteProject, deleteTask, getTask, linkNote, listProjects, listTasks, listTrash, projectDetail, restoreTask, TRASH_DAYS, unlinkNote, updateProject, updateTask,
} from "../src/lib/projects.ts";
import { clearEmbeddings, embedPending, embeddingStatus, ftsQuery, search } from "../src/lib/search.ts";
import { cleanup, fakeProvider, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

describe("projects", () => {
  it("validates and defaults a new project", () => {
    expect(() => createProject({ name: "   " })).toThrow();
    expect(() => createProject({ name: "x", target_date: "2026-02-31x" })).toThrow();
    const p = createProject({ name: "  Garden  " });
    expect(p).toMatchObject({ name: "Garden", status: "active", description: "", goals: "", target_date: null });
  });
  it("updates only the fields given and logs status changes", () => {
    const p = createProject({ name: "Garden", goals: "grow" });
    const u = updateProject(p.id, { status: "paused" });
    expect(u).toMatchObject({ name: "Garden", goals: "grow", status: "paused" });
    const detail = projectDetail(p.id)!;
    expect((detail.activity as { message: string }[]).map((a) => a.message)).toContain("Status changed from active to paused");
    expect(() => updateProject("nope", { name: "x" })).toThrow(/not found/i);
  });
  it("lists archived projects last, with open-task counts that skip done and trashed tasks", () => {
    const a = createProject({ name: "A" });
    const b = createProject({ name: "B" });
    updateProject(a.id, { status: "archived" });
    createTask({ title: "open", project_id: b.id });
    createTask({ title: "done", status: "done", project_id: b.id });
    const gone = createTask({ title: "trashed", project_id: b.id });
    deleteTask(gone.id);
    const rows = listProjects();
    expect(rows.map((r) => r.name)).toEqual(["B", "A"]);
    expect(rows[0].open_tasks).toBe(1);
    expect(listProjects("archived").map((r) => r.name)).toEqual(["A"]);
  });
  it("gives each project a stable colour index by creation order", () => {
    const first = createProject({ name: "first" });
    const second = createProject({ name: "second" });
    const idx = Object.fromEntries(listProjects().map((p) => [p.id, p.color_index]));
    expect(idx[first.id]).toBe(0);
    expect(idx[second.id]).toBe(1);
  });
  it("deleting a project keeps its tasks, unassigned", () => {
    const p = createProject({ name: "Temp" });
    const t = createTask({ title: "survivor", project_id: p.id });
    deleteProject(p.id);
    expect(getTask(t.id)).toMatchObject({ project_id: null, title: "survivor" });
    expect(() => deleteProject(p.id)).toThrow(/not found/i);
  });
  it("links and unlinks notes once, and rejects unknown ids", () => {
    const p = createProject({ name: "P" });
    const n = createNote({ title: "Linked", body: "x" });
    linkNote(p.id, n.id);
    linkNote(p.id, n.id);
    expect(projectDetail(p.id)!.notes).toHaveLength(1);
    expect((projectDetail(p.id)!.activity as { kind: string }[]).filter((a) => a.kind === "note.linked")).toHaveLength(1);
    expect(listProjects()[0].note_count).toBe(1);
    unlinkNote(p.id, n.id);
    expect(projectDetail(p.id)!.notes).toHaveLength(0);
    expect(() => linkNote("nope", n.id)).toThrow(/Project not found/);
    expect(() => linkNote(p.id, "nope")).toThrow(/Note not found/);
    expect(projectDetail("nope")).toBeNull();
  });
  it("deleting a note removes it from its projects", () => {
    const p = createProject({ name: "P" });
    const n = createNote({ title: "Linked", body: "x" });
    linkNote(p.id, n.id);
    deleteNote(n.id);
    expect(projectDetail(p.id)!.notes).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("validates input and unknown projects", () => {
    expect(() => createTask({ title: " " })).toThrow();
    expect(() => createTask({ title: "x", due_date: "soon" })).toThrow();
    expect(() => createTask({ title: "x", estimate_min: 0 })).toThrow();
    expect(() => createTask({ title: "x", estimate_min: 1441 })).toThrow();
    expect(() => createTask({ title: "x", project_id: "ghost" })).toThrow(/Unknown project/);
    expect(createTask({ title: "ok", estimate_min: 90 }).estimate_min).toBe(90);
  });
  it("stamps completion when marked done and clears it when reopened", () => {
    const t = createTask({ title: "x" });
    expect(t.completed_at).toBeNull();
    const done = updateTask(t.id, { status: "done" });
    expect(done.completed_at).not.toBeNull();
    expect(updateTask(t.id, { title: "renamed" }).completed_at).toBe(done.completed_at);
    expect(updateTask(t.id, { status: "doing" }).completed_at).toBeNull();
    expect(createTask({ title: "born done", status: "done" }).completed_at).not.toBeNull();
  });
  it("keeps untouched fields when patching, and can clear a date with null", () => {
    const t = createTask({ title: "x", priority: "high", due_date: "2026-05-01", description: "d" });
    const u = updateTask(t.id, { title: "y" });
    expect(u).toMatchObject({ priority: "high", due_date: "2026-05-01", description: "d" });
    expect(updateTask(t.id, { due_date: null }).due_date).toBeNull();
    expect(() => updateTask("nope", { title: "z" })).toThrow(/not found/i);
    expect(() => updateTask(t.id, { project_id: "ghost" })).toThrow(/Unknown project/);
  });
  it("filters by due bucket using the caller's date", () => {
    createTask({ title: "late", due_date: "2026-06-01" });
    createTask({ title: "today", due_date: "2026-06-10" });
    createTask({ title: "soon", due_date: "2026-06-17" });
    createTask({ title: "later", due_date: "2026-06-18" });
    createTask({ title: "undated" });
    createTask({ title: "late but done", due_date: "2026-06-01", status: "done" });
    const titles = (f: Parameters<typeof listTasks>[0]) => listTasks(f).map((t) => t.title);
    expect(titles({ due: "overdue", today: "2026-06-10" })).toEqual(["late"]);
    expect(titles({ due: "today", today: "2026-06-10" })).toEqual(["today"]);
    expect(titles({ due: "soon", today: "2026-06-10" })).toEqual(["today", "soon"]);
    expect(titles({ dueFrom: "2026-06-10", dueTo: "2026-06-17" })).toEqual(["today", "soon"]);
    expect(titles({ status: "open" })).not.toContain("late but done");
  });
  it("orders open before done, dated before undated, then by priority", () => {
    createTask({ title: "undated high", priority: "high" });
    createTask({ title: "later low", due_date: "2026-07-01", priority: "low" });
    createTask({ title: "soon low", due_date: "2026-06-01", priority: "low" });
    createTask({ title: "soon high", due_date: "2026-06-01", priority: "high" });
    createTask({ title: "finished", status: "done", due_date: "2026-01-01" });
    expect(listTasks().map((t) => t.title)).toEqual(["soon high", "soon low", "later low", "undated high", "finished"]);
  });
  it("filters finished tasks by completion time", () => {
    const t = createTask({ title: "x" });
    updateTask(t.id, { status: "done" });
    expect(listTasks({ completedSince: "2000-01-01T00:00:00Z" })).toHaveLength(1);
    expect(listTasks({ completedSince: "2999-01-01T00:00:00Z" })).toHaveLength(0);
  });
});

describe("task trash", () => {
  it("hides a trashed task everywhere, keeps its id, and restores every field", () => {
    const p = createProject({ name: "P" });
    const t = createTask({ title: "x", priority: "high", due_date: "2026-05-01", project_id: p.id, estimate_min: 30 });
    deleteTask(t.id);
    expect(listTasks()).toEqual([]);
    expect(projectDetail(p.id)!.tasks).toEqual([]);
    expect(listTrash().map((x) => x.id)).toEqual([t.id]);
    const back = restoreTask(t.id);
    expect(back).toMatchObject({ id: t.id, title: "x", priority: "high", due_date: "2026-05-01", project_id: p.id, estimate_min: 30, deleted_at: null });
    expect(listTrash()).toEqual([]);
  });
  it("purge deletes for good; unknown ids are rejected", () => {
    const t = createTask({ title: "x" });
    deleteTask(t.id, true);
    expect(getTask(t.id)).toBeNull();
    expect(() => deleteTask(t.id)).toThrow(/not found/i);
    expect(() => restoreTask("nope")).toThrow(/not found/i);
  });
  it("trashing twice does not reset the deletion time", () => {
    const t = createTask({ title: "x" });
    deleteTask(t.id);
    const first = getTask(t.id)!.deleted_at;
    deleteTask(t.id);
    expect(getTask(t.id)!.deleted_at).toBe(first);
  });
  it("purges tasks older than the retention period when the trash is opened", () => {
    const old = createTask({ title: "old" });
    const fresh = createTask({ title: "fresh" });
    deleteTask(old.id); deleteTask(fresh.id);
    const longAgo = new Date(Date.now() - (TRASH_DAYS + 1) * 86_400_000).toISOString();
    getDb().prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(longAgo, old.id);
    expect(listTrash().map((t) => t.id)).toEqual([fresh.id]);
    expect(getTask(old.id)).toBeNull();
  });
  it("restoring a task whose project was deleted gives back a task with no project", () => {
    const p = createProject({ name: "P" });
    const t = createTask({ title: "x", project_id: p.id });
    deleteTask(t.id);
    deleteProject(p.id);
    expect(restoreTask(t.id).project_id).toBeNull();
  });
});

describe("ftsQuery", () => {
  it("returns null when there is nothing searchable", () => {
    expect(ftsQuery("")).toBeNull();
    expect(ftsQuery("  !!! ??? ")).toBeNull();
  });
  it("quotes every token so operators cannot be injected", () => {
    expect(ftsQuery('tomato" OR (garden) NEAR/2 x')).toBe('"tomato" AND "or" AND "garden" AND "near" AND "2" AND "x"*');
    expect(ftsQuery("a*b")).toBe('"a" AND "b"*');
    expect(ftsQuery("title:secret")).toBe('"title" AND "secret"*');
  });
  it("puts the prefix star on the last token for AND, and on all of them for OR", () => {
    expect(ftsQuery("water plan")).toBe('"water" AND "plan"*');
    expect(ftsQuery("water plan", "OR")).toBe('"water"* OR "plan"*');
  });
  it("drops stop words and one-letter tokens for OR, unless that leaves nothing", () => {
    expect(ftsQuery("what is the garden plan", "OR")).toBe('"garden"* OR "plan"*');
    expect(ftsQuery("what is the", "OR")).toBe('"what"* OR "is"* OR "the"*');
  });
  it("normalises accents and case, keeps other scripts, and caps the token count", () => {
    expect(ftsQuery("Café")).toBe('"cafe"*');
    expect(ftsQuery("日本語 notes")).toContain("日本語");
    const q = ftsQuery(Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "))!;
    expect(q.split(" AND ")).toHaveLength(12);
  });
});

describe("search", () => {
  it("finds by keyword with and without embeddings, and returns nothing for an empty query", async () => {
    createNote({ title: "Tomato garden", body: "Water the tomato plants every morning." });
    createNote({ title: "Budget", body: "Monthly invoice and money plan." });
    const r = await search("tomato");
    expect(r.hits.map((h) => h.title)).toEqual(["Tomato garden"]);
    expect(r.semantic.used).toBe(false);
    expect(r.semantic.reason).toMatch(/No embeddings yet/);
    expect((await search("   ")).hits).toEqual([]);
    expect((await search("tomato", { mode: "keyword" })).semantic.reason).toBe("keyword mode");
  });
  it("falls back to OR when AND finds nothing, and limits results to chosen notes", async () => {
    const a = createNote({ title: "Alpha", body: "tomato soup recipe" });
    createNote({ title: "Beta", body: "tomato salad" });
    expect((await search("tomato recipe rocket")).hits.length).toBeGreaterThan(0);
    const scoped = await search("tomato", { noteIds: [a.id] });
    expect(scoped.hits.map((h) => h.noteId)).toEqual([a.id]);
  });
  it("is not confused by special characters", async () => {
    createNote({ title: "Odd", body: "say \"hello\" (world) *star*" });
    await expect(search('"hello" OR (world')).resolves.toBeDefined();
    await expect(search("***")).resolves.toMatchObject({ hits: [] });
  });
  it("builds embeddings, then fuses keyword and semantic results", async () => {
    setProvider(fakeProvider());
    createNote({ title: "Garden", body: "Plant tomato seeds and water them." });
    createNote({ title: "Money", body: "Pay the invoice from the budget." });
    expect(embeddingStatus()).toMatchObject({ embedded: 0, total: 2 });
    expect(await embedPending()).toEqual({ embedded: 2 });
    expect(embeddingStatus().embedded).toBe(2);
    const r = await search("tomato");
    expect(r.semantic.used).toBe(true);
    expect(r.hits[0].title).toBe("Garden");
    expect(r.hits[0].via).toEqual(expect.arrayContaining(["keyword", "semantic"]));
    clearEmbeddings();
    expect(embeddingStatus().embedded).toBe(0);
    expect((await search("tomato")).semantic.used).toBe(false);
  });
  it("keeps keyword results when the embedding model goes away", async () => {
    setProvider(fakeProvider());
    createNote({ title: "Garden", body: "Plant tomato seeds." });
    await embedPending();
    setProvider(fakeProvider({ embedDown: true }));
    const r = await search("tomato");
    expect(r.hits.map((h) => h.title)).toEqual(["Garden"]);
    expect(r.semantic).toMatchObject({ used: false });
    expect(r.semantic.reason).toMatch(/Cannot reach Ollama/);
  });
  it("reports an embedding failure without losing what was already embedded", async () => {
    setProvider(fakeProvider({ embedDown: true }));
    createNote({ title: "Garden", body: "Plant tomato seeds." });
    const r = await embedPending();
    expect(r.embedded).toBe(0);
    expect(r.error).toMatch(/Cannot reach Ollama/);
    expect(r.hint).toMatch(/Start Ollama/);
  });
});

describe("noteConnections", () => {
  it("returns null for an unknown note", async () => {
    expect(await noteConnections("nope")).toBeNull();
  });
  it("finds notes that link to this one with a snippet around the link", async () => {
    const target = createNote({ title: "Python", body: "A language." });
    const other = createNote({ title: "Learning plan", body: "First week: read about [[Python]] and practise daily." });
    createNote({ title: "Unrelated", body: "No links here." });
    const c = (await noteConnections(target.id))!;
    expect(c.linkedFrom).toHaveLength(1);
    expect(c.linkedFrom[0]).toMatchObject({ id: other.id, title: "Learning plan" });
    expect(c.linkedFrom[0].snippet).toContain("[[Python]]");
    expect(c.linkedFrom.map((l) => l.id)).not.toContain(target.id);
  });
  it("treats SQL wildcards in a title literally", async () => {
    const target = createNote({ title: "100%_done", body: "x" });
    createNote({ title: "A", body: "mentions [[100%_done]] here" });
    createNote({ title: "B", body: "mentions [[100xxdone]] here" });
    const c = (await noteConnections(target.id))!;
    expect(c.linkedFrom.map((l) => l.title)).toEqual(["A"]);
  });
  it("lists only live tasks created from this note, open ones first", async () => {
    const { acceptCapture, AcceptInput, createCapture } = await import("../src/lib/captures.ts");
    const { capture } = await createCapture({ content: "raw" });
    const { note, taskIds } = acceptCapture(capture.id, AcceptInput.parse({ title: "Source", body: "b", tasks: [{ title: "first" }, { title: "second", due_date: "2026-05-01" }, { title: "third" }] }));
    updateTask(taskIds[0], { status: "done" });
    deleteTask(taskIds[2]);
    const c = (await noteConnections(note.id))!;
    expect(c.tasks.map((t) => t.title)).toEqual(["second", "first"]);
  });
  it("suggests similar notes by keyword, then by meaning once embeddings exist", async () => {
    const a = createNote({ title: "Tomato garden", body: "tomato water plan", summary: "tomato water" });
    createNote({ title: "Tomato soup", body: "tomato water recipe" });
    createNote({ title: "Invoices", body: "money budget invoice" });
    const keyword = (await noteConnections(a.id))!;
    expect(keyword.semantic).toBe(false);
    // Without embeddings the query is the note's own title and summary, so the AND search matches only the note itself.
    expect(keyword.similar.map((s) => s.id)).not.toContain(a.id);
    setProvider(fakeProvider());
    await embedPending();
    const semantic = (await noteConnections(a.id))!;
    expect(semantic.semantic).toBe(true);
    expect(semantic.similar.length).toBeLessThanOrEqual(3);
    expect(semantic.similar.map((s) => s.title)).toContain("Tomato soup");
    expect(semantic.similar.map((s) => s.title)).not.toContain("Invoices");
  });
});
