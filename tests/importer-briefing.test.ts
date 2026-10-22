import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBriefing } from "../src/lib/briefing.ts";
import { createCapture, updateCapture } from "../src/lib/captures.ts";
import { getConfig } from "../src/lib/config.ts";
import { importFiles, recentImports } from "../src/lib/importer.ts";
import { createNote, getNote } from "../src/lib/notes.ts";
import { createProject, createTask, deleteTask, updateProject } from "../src/lib/projects.ts";
import { cleanup, freshEnv, goodProposal } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

const file = (name: string, text: string) => ({ name, data: Buffer.from(text) });

describe("importFiles", () => {
  it("turns Markdown into a note, using front matter for title, tags and category", async () => {
    const [r] = await importFiles([file("plan.md", '---\ntitle: "Garden plan"\ntags: ["Garden", "spring"]\ncategory: "life"\n---\n\nPlant things.')]);
    expect(r.status).toBe("imported");
    expect(getNote(r.noteId!)).toMatchObject({ title: "Garden plan", tags: ["garden", "spring"], category: "life", sourceType: "import", sourceRef: "plan.md" });
  });
  it("falls back to the first heading, then the file name, for the title", async () => {
    const [a, b] = await importFiles([file("a.md", "intro\n\n# Real Title\n\nbody"), file("my notes.txt", "just words")]);
    expect(getNote(a.noteId!)!.title).toBe("Real Title");
    expect(getNote(b.noteId!)!.title).toBe("my notes");
  });
  it("keeps an untouched copy of the original", async () => {
    await importFiles([file("keep.txt", "original bytes")]);
    const saved = fs.readdirSync(getConfig().importsDir);
    expect(saved).toHaveLength(1);
    expect(fs.readFileSync(path.join(getConfig().importsDir, saved[0]), "utf8")).toBe("original bytes");
  });
  it("recognises the same content again as a duplicate of the same note, even under another name", async () => {
    const [first] = await importFiles([file("one.txt", "same content")]);
    const [again] = await importFiles([file("two.txt", "same content")]);
    expect(again).toMatchObject({ status: "duplicate", noteId: first.noteId });
    expect(fs.readdirSync(getConfig().vaultDir).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });
  it("one bad file never stops the rest of the batch", async () => {
    const out = await importFiles([
      file("good.md", "# Good\n\nfine"),
      file("sheet.xlsx", "x"),
      file("photo.png", "x"),
      file("empty.txt", "   \n"),
      file("fake.pdf", "not a pdf"),
      file("binary.txt", "a\0b"),
      file("good2.txt", "also fine"),
    ]);
    expect(out.map((o) => o.status)).toEqual(["imported", "unsupported", "unsupported", "failed", "failed", "failed", "imported"]);
    expect(out[1].error).toMatch(/Spreadsheets/);
    expect(out[2].error).toMatch(/no OCR/);
    expect(out[3].error).toMatch(/empty/i);
    expect(out[4].error).toMatch(/does not match/);
  });
  it("rejects a file over the size limit", async () => {
    process.env.SBOS_MAX_UPLOAD_MB = "1";
    const [r] = await importFiles([{ name: "big.txt", data: Buffer.alloc(1024 * 1024 + 1, "a") }]);
    expect(r).toMatchObject({ status: "failed" });
    expect(r.error).toMatch(/1 MB limit/);
    delete process.env.SBOS_MAX_UPLOAD_MB;
  });
  it("makes unsafe file names safe", async () => {
    const [r] = await importFiles([file("../../evil.md", "# Hello")]);
    expect(r.filename).not.toMatch(/[\\/]/);
    expect(fs.readdirSync(getConfig().importsDir).every((f) => !f.includes(".."))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(getConfig().dataDir), "evil.md"))).toBe(false);
  });
  it("logs every outcome, newest first, and honours the limit", async () => {
    await importFiles([file("a.txt", "one"), file("b.xlsx", "x"), file("c.txt", "three")]);
    const rows = recentImports() as { filename: string; status: string }[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.status).sort()).toEqual(["imported", "imported", "unsupported"]);
    expect(recentImports(2)).toHaveLength(2);
  });
});

describe("buildBriefing", () => {
  it("says nothing needs attention on an empty workspace", () => {
    const b = buildBriefing("2026-06-10");
    expect(b.counts).toEqual({ openTasks: 0, overdue: 0, dueToday: 0, awaitingReview: 0, unprocessed: 0, failed: 0, activeProjects: 0 });
    expect(b.notes).toEqual(["Nothing needs attention right now.", "Calendar events are not shown: no calendar is connected."]);
  });
  it("buckets tasks by the date it is given, with correct singular and plural wording", () => {
    createTask({ title: "late", due_date: "2026-06-01" });
    createTask({ title: "today", due_date: "2026-06-10" });
    createTask({ title: "soon", due_date: "2026-06-12" });
    createTask({ title: "far", due_date: "2026-08-01" });
    createTask({ title: "done and late", due_date: "2026-06-01", status: "done" });
    const gone = createTask({ title: "trashed", due_date: "2026-06-01" });
    deleteTask(gone.id);
    const b = buildBriefing("2026-06-10");
    expect(b.overdue.map((t) => t.title)).toEqual(["late"]);
    expect(b.dueToday.map((t) => t.title)).toEqual(["today"]);
    expect(b.dueSoon.map((t) => t.title)).toEqual(["soon"]);
    expect(b.counts).toMatchObject({ openTasks: 4, overdue: 1, dueToday: 1 });
    expect(b.notes).toContain("1 task is overdue.");
    expect(b.notes).toContain("1 task is due today.");
    createTask({ title: "late 2", due_date: "2026-06-02" });
    expect(buildBriefing("2026-06-10").notes).toContain("2 tasks are overdue.");
    expect(buildBriefing("2026-06-10").notes).not.toContain("Nothing needs attention right now.");
  });
  it("lists only active projects, with their open task counts", () => {
    const a = createProject({ name: "Active" });
    const p = createProject({ name: "Paused" });
    updateProject(p.id, { status: "paused" });
    createTask({ title: "x", project_id: a.id });
    createTask({ title: "y", status: "done", project_id: a.id });
    const b = buildBriefing("2026-06-10");
    expect(b.activeProjects).toEqual([{ id: a.id, name: "Active", open_tasks: 1, target_date: null }]);
    expect(b.counts.activeProjects).toBe(1);
  });
  it("reports captures awaiting review with the proposal's title, and counts failures and unprocessed ones", async () => {
    const reviewed = await createCapture({ content: "raw thought about tomatoes" });
    updateCapture(reviewed.capture.id, { proposal: { ...goodProposal, title: "Tomato plan", tasks: [] } });
    await createCapture({ content: "not processed" });
    const failed = await createCapture({ content: "will fail" });
    const { getDb } = await import("../src/lib/db.ts");
    getDb().prepare("UPDATE captures SET status='failed' WHERE id=?").run(failed.capture.id);
    const b = buildBriefing("2026-06-10");
    expect(b.awaitingReview.map((a) => a.title)).toEqual(["Tomato plan"]);
    expect(b.counts).toMatchObject({ awaitingReview: 1, unprocessed: 1, failed: 1 });
    expect(b.notes).toContain("1 capture is waiting for your review.");
    expect(b.notes).toContain("1 capture failed AI processing and can be retried.");
    expect(b.notes).toContain("1 capture has not been processed yet.");
  });
  it("falls back to a content preview when a stored proposal is corrupt, and previews are short and one-line", async () => {
    const { capture } = await createCapture({ content: `line one\n\n${"long ".repeat(60)}` });
    const { getDb } = await import("../src/lib/db.ts");
    getDb().prepare("UPDATE captures SET status='proposed', proposal_json='{broken' WHERE id=?").run(capture.id);
    const b = buildBriefing("2026-06-10");
    expect(b.awaitingReview[0].title).toBe(`line one ${"long ".repeat(60)}`.slice(0, 60));
    expect(b.recentCaptures[0].preview).not.toMatch(/\n/);
    expect(b.recentCaptures[0].preview.length).toBeLessThanOrEqual(120);
  });
  it("hides archived captures and shows the newest notes first", async () => {
    const c = await createCapture({ content: "archive me" });
    updateCapture(c.capture.id, { archived: true });
    createNote({ title: "Old", body: "x" });
    await new Promise((r) => setTimeout(r, 5));
    createNote({ title: "New", body: "x" });
    const b = buildBriefing("2026-06-10");
    expect(b.recentCaptures).toEqual([]);
    expect(b.recentNotes.map((n) => n.title)).toEqual(["New", "Old"]);
  });
  it("never claims calendar data", () => {
    expect(buildBriefing().notes.at(-1)).toMatch(/no calendar is connected/);
  });
});
