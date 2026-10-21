import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, createTask, deleteTask, updateTask } from "../src/lib/projects.ts";
import { createNote } from "../src/lib/notes.ts";
import { createCapture } from "../src/lib/captures.ts";
import { getDb } from "../src/lib/db.ts";
import { setProvider } from "../src/lib/ollama.ts";
import { addDep, generateDepSuggestions, listDeps, pendingSuggestions, removeDep, resolveSuggestion, workflowData } from "../src/lib/workflow.ts";
import { cleanup, fakeProvider, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

const mk = (title: string, o: Record<string, unknown> = {}) => createTask({ title, ...o });

describe("dependencies", () => {
  it("adds, lists and removes links, refuses loops and self-links, and is idempotent", () => {
    const a = mk("A"), b = mk("B"), c = mk("C");
    addDep(b.id, a.id);
    addDep(b.id, a.id);
    addDep(c.id, b.id);
    expect(listDeps()).toEqual(expect.arrayContaining([{ a: a.id, b: b.id }, { a: b.id, b: c.id }]));
    expect(listDeps()).toHaveLength(2);
    expect(() => addDep(a.id, c.id)).toThrow(/loop/);
    expect(() => addDep(a.id, a.id)).toThrow(/itself/);
    expect(() => addDep(a.id, "nope")).toThrow(/not found/);
    removeDep(c.id, b.id);
    expect(listDeps()).toEqual([{ a: a.id, b: b.id }]);
  });
  it("hides links to trashed tasks and brings them back on restore", async () => {
    const { restoreTask } = await import("../src/lib/projects.ts");
    const a = mk("A"), b = mk("B");
    addDep(b.id, a.id);
    deleteTask(a.id);
    expect(listDeps()).toEqual([]);
    expect(() => addDep(b.id, a.id)).toThrow(/not found/);
    restoreTask(a.id);
    expect(listDeps()).toHaveLength(1);
  });
  it("removes links when a task is deleted for good", () => {
    const a = mk("A"), b = mk("B");
    addDep(b.id, a.id);
    deleteTask(a.id, true);
    expect(getDb().prepare("SELECT COUNT(*) AS c FROM task_deps").get()).toEqual({ c: 0 });
  });
});

describe("AI dependency suggestions", () => {
  const links = (l: unknown[]) => fakeProvider({ json: { links: l } });
  it("stores validated suggestions as pending proposals and changes nothing else", async () => {
    const a = mk("Write the lesson"), b = mk("Write a quiz for the lesson"), c = mk("Buy milk");
    const existing = mk("Existing pair first"), existing2 = mk("Existing pair second");
    addDep(existing2.id, existing.id);
    setProvider(links([
      { first: "T1", then: "T2", confidence: 84.4, reason: "The quiz needs the lesson." },
      { first: "T2", then: "T1", confidence: 70, reason: "reverse of the above" },
      { first: "T9", then: "T1", confidence: 90, reason: "unknown label" },
      { first: "T3", then: "T3", confidence: 90, reason: "self" },
      { first: "t3", then: "t1", confidence: 40, reason: "weak but valid, lower case label" },
      { first: "T4", then: "T5", confidence: 99, reason: "already linked" },
    ]));
    const r = await generateDepSuggestions();
    expect(r).toEqual({ added: 2, considered: 5 });
    const pend = pendingSuggestions();
    expect(pend.map((s) => [s.a, s.b, s.confidence])).toEqual([[a.id, b.id, 84], [c.id, a.id, 40]]);
    expect(listDeps()).toEqual([{ a: existing.id, b: existing2.id }]);
    expect((await generateDepSuggestions()).added).toBe(0);
  });
  it("accepting creates the link, dismissing is remembered, and handled suggestions cannot be handled twice", async () => {
    const a = mk("A step"), b = mk("B step");
    mk("C step");
    setProvider(links([{ first: "T1", then: "T2", confidence: 90, reason: "r1" }, { first: "T2", then: "T3", confidence: 75, reason: "r2" }]));
    await generateDepSuggestions();
    const [s1, s2] = pendingSuggestions();
    resolveSuggestion(s1.id, "accept");
    resolveSuggestion(s2.id, "dismiss");
    expect(listDeps()).toEqual([{ a: a.id, b: b.id }]);
    expect(pendingSuggestions()).toEqual([]);
    expect(() => resolveSuggestion(s1.id, "dismiss")).toThrow(/already handled/);
    expect(() => resolveSuggestion("nope", "accept")).toThrow(/not found/);
    expect((await generateDepSuggestions()).added).toBe(0);
  });
  it("skips pairs that would form a loop, needs two open tasks and rejects malformed model output", async () => {
    const a = mk("One"), b = mk("Two");
    addDep(b.id, a.id);
    setProvider(links([{ first: "T2", then: "T1", confidence: 95, reason: "loop" }]));
    expect((await generateDepSuggestions()).added).toBe(0);
    updateTask(b.id, { status: "done" });
    setProvider(links([]));
    expect(await generateDepSuggestions()).toEqual({ added: 0, considered: 1 });
    mk("Three");
    setProvider(fakeProvider({ json: { nonsense: 1 } }));
    await expect(generateDepSuggestions()).rejects.toThrow(/unexpected format/);
  });
});

describe("workflowData", () => {
  it("returns tasks, deps and the graph links between projects, notes, tags, captures and tasks", async () => {
    const p = createProject({ name: "Internship" });
    const t1 = mk("Rewrite headline", { project_id: p.id, due_date: "2026-10-26" });
    const t2 = mk("Message contacts", { project_id: p.id, due_date: "2026-10-28" });
    const gone = mk("Trashed", { project_id: p.id });
    addDep(t2.id, t1.id);
    deleteTask(gone.id);
    const note = createNote({ title: "Internship search", body: "x", tags: ["internship"] });
    getDb().prepare("INSERT INTO project_notes (project_id, note_id) VALUES (?,?)").run(p.id, note.id);
    const { capture } = await createCapture({ content: "Internship fair dates are in March" });
    getDb().prepare("UPDATE captures SET note_id = ? WHERE id = ?").run(note.id, capture.id);
    const cap2 = (await createCapture({ content: "Ask about the portfolio" })).capture;
    getDb().prepare("UPDATE tasks SET capture_id = ? WHERE id = ?").run(cap2.id, t1.id);
    mk("Follow up", { project_id: p.id });

    const d = workflowData("2026-10-21");
    expect(d.projects.map((x) => x.name)).toEqual(["Internship"]);
    expect(d.tasks.map((t) => t.title).sort()).toEqual(["Follow up", "Message contacts", "Rewrite headline"]);
    expect(d.deps).toEqual([{ a: t1.id, b: t2.id }]);
    expect(d.notes.map((n) => n.id)).toEqual([note.id]);
    expect(d.tags).toEqual([{ id: "tag:internship", title: "#internship" }]);
    expect(d.captures.map((c) => c.id).sort()).toEqual([capture.id, cap2.id].sort());
    const has = (a: string, b: string) => d.links.some((l) => l.a === a && l.b === b);
    expect(has(note.id, p.id)).toBe(true);
    expect(has("tag:internship", note.id)).toBe(true);
    expect(has(capture.id, note.id)).toBe(true);
    expect(has(cap2.id, t1.id)).toBe(true);
    expect(d.captures.find((c) => c.id === capture.id)!.title).toBe("Internship fair dates are in March");
  });
  it("is empty and valid on a fresh install", () => {
    expect(workflowData("2026-10-21")).toMatchObject({ projects: [], tasks: [], deps: [], suggestions: [], notes: [], tags: [], captures: [], links: [] });
  });
});

describe("explanations for the user", () => {
  it("replaces the model's task labels with task titles", async () => {
    const { humanizeReason } = await import("../src/lib/workflow.ts");
    const titles = new Map([["T4", "Add the placeholder projects"], ["T5", "Redeploy the site"]]);
    expect(humanizeReason("The site cannot be redeployed (T5) until the projects are added (T4).", titles)).toBe("The site cannot be redeployed (\u201cRedeploy the site\u201d) until the projects are added (\u201cAdd the placeholder projects\u201d).");
    expect(humanizeReason("t4 comes before T5, and T9 is unknown", titles)).toBe("\u201cAdd the placeholder projects\u201d comes before \u201cRedeploy the site\u201d, and T9 is unknown");
    expect(humanizeReason("No labels here", titles)).toBe("No labels here");
  });
});
