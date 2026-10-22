import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcceptInput, acceptCapture, attachmentFile, captureCounts, createCapture, deleteCapture, getCapture, listCaptures, processAllPending, processCapture, updateCapture } from "../src/lib/captures.ts";
import { getConfig } from "../src/lib/config.ts";
import { setProvider } from "../src/lib/ollama.ts";
import { createProject, listTasks } from "../src/lib/projects.ts";
import { getNote } from "../src/lib/notes.ts";
import { cleanup, fakeProvider, freshEnv, goodProposal } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

describe("createCapture", () => {
  it("rejects an empty capture and a non-http link", async () => {
    await expect(createCapture({})).rejects.toMatchObject({ status: 400 });
    await expect(createCapture({ content: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(createCapture({ url: "javascript:alert(1)" })).rejects.toMatchObject({ status: 400 });
    await expect(createCapture({ url: "ftp://example.com/x" })).rejects.toMatchObject({ status: 400 });
    expect(listCaptures()).toEqual([]);
  });
  it("saves text before any AI work and infers the kind", async () => {
    const text = await createCapture({ content: "  an idea about tomatoes  " });
    expect(text.capture).toMatchObject({ kind: "text", status: "new", content: "an idea about tomatoes", original_content: "an idea about tomatoes" });
    const link = await createCapture({ url: "https://example.com/a" });
    expect(link.capture).toMatchObject({ kind: "link", content: "https://example.com/a", url: "https://example.com/a" });
    const withNote = await createCapture({ url: "https://example.com/b", content: "read this" });
    expect(withNote.capture.kind).toBe("text");
    const explicit = await createCapture({ kind: "idea", content: "bright" });
    expect(explicit.capture.kind).toBe("idea");
  });
  it("flags a repeated submission instead of storing it twice, ignoring case and spacing", async () => {
    const a = await createCapture({ content: "Buy  Milk" });
    const b = await createCapture({ content: " buy milk " });
    expect(b.duplicate).toBe(true);
    expect(b.capture.id).toBe(a.capture.id);
    expect(listCaptures()).toHaveLength(1);
  });
  it("allows the same text again once the first is archived", async () => {
    const a = await createCapture({ content: "again" });
    updateCapture(a.capture.id, { archived: true });
    const b = await createCapture({ content: "again" });
    expect(b.duplicate).toBe(false);
    expect(b.capture.id).not.toBe(a.capture.id);
  });
  it("keeps a hint only if the project exists and the date is valid", async () => {
    const p = createProject({ name: "Garden" });
    const ok = await createCapture({ content: "one", hintProjectId: p.id, hintDue: "2026-03-01" });
    expect(ok.capture).toMatchObject({ hint_project_id: p.id, hint_due: "2026-03-01" });
    const bad = await createCapture({ content: "two", hintProjectId: "ghost", hintDue: "tomorrow" });
    expect(bad.capture).toMatchObject({ hint_project_id: null, hint_due: null });
  });
  it("extracts text from an attached file and stores the file", async () => {
    const { capture } = await createCapture({ files: [{ name: "My Notes.md", data: Buffer.from("# Heading\n\nbody text") }] });
    expect(capture.kind).toBe("file");
    expect(capture.content).toContain("body text");
    expect(capture.attachments).toHaveLength(1);
    const f = attachmentFile(capture.attachments[0].id);
    expect(fs.readFileSync(f.fullPath, "utf8")).toContain("body text");
    expect(f.mime).toBe("text/markdown");
    expect(f.filename).toBe(capture.attachments[0].filename);
  });
  it("labels several files and keeps the typed text first", async () => {
    const { capture } = await createCapture({ content: "context", files: [{ name: "a.txt", data: Buffer.from("alpha") }, { name: "b.txt", data: Buffer.from("beta") }] });
    expect(capture.content.startsWith("context")).toBe(true);
    expect(capture.content).toContain("### a.txt");
    expect(capture.content).toContain("### b.txt");
    expect(capture.attachments).toHaveLength(2);
  });
  it("describes an image-only capture by its file name", async () => {
    const { capture } = await createCapture({ files: [{ name: "photo.png", data: PNG }] });
    expect(capture.content).toBe("[Attached: photo.png]");
  });
  it("refuses unsupported, disguised and oversized files without leaving anything behind", async () => {
    await expect(createCapture({ files: [{ name: "a.docx", data: Buffer.from("x") }] })).rejects.toMatchObject({ status: 415 });
    await expect(createCapture({ files: [{ name: "virus.png", data: Buffer.from("MZ\x90\x00 not an image") }] })).rejects.toMatchObject({ status: 415 });
    await expect(createCapture({ files: [{ name: "x.pdf", data: Buffer.from("%PDF-1.4 broken") }] })).rejects.toMatchObject({ status: 422 });
    await expect(createCapture({ files: [{ name: "big.txt", data: Buffer.alloc(getConfig().maxUploadBytes + 1, "a") }] })).rejects.toMatchObject({ status: 413 });
    await expect(createCapture({ content: "ok", files: [{ name: "fine.txt", data: Buffer.from("fine") }, { name: "bad.exe", data: Buffer.from("x") }] })).rejects.toMatchObject({ status: 415 });
    expect(listCaptures()).toEqual([]);
  });
  it("sanitises file names that try to climb out of the attachments folder", async () => {
    const { capture } = await createCapture({ files: [{ name: "../../escape.txt", data: Buffer.from("x") }] });
    const f = attachmentFile(capture.attachments[0].id);
    expect(f.fullPath.startsWith(getConfig().attachmentsDir)).toBe(true);
    expect(capture.attachments[0].filename).not.toMatch(/[\\/]/);
  });
});

describe("listing, updating and deleting", () => {
  it("filters by status, kind and text with wildcards escaped, and separates archived", async () => {
    await createCapture({ content: "100% sure", kind: "idea" });
    await createCapture({ content: "plain thing" });
    expect(listCaptures({ q: "100%" })).toHaveLength(1);
    expect(listCaptures({ q: "%" })).toHaveLength(1);
    expect(listCaptures({ kind: "idea" })).toHaveLength(1);
    expect(listCaptures({ status: "proposed" })).toHaveLength(0);
    const first = listCaptures()[0];
    updateCapture(first.id, { archived: true });
    expect(listCaptures()).toHaveLength(1);
    expect(listCaptures({ archived: true })).toHaveLength(1);
  });
  it("updates only the fields given and rejects an unknown capture", async () => {
    const { capture } = await createCapture({ content: "keep original" });
    const u = updateCapture(capture.id, { content: "edited" });
    expect(u).toMatchObject({ content: "edited", original_content: "keep original", status: "new" });
    expect(() => updateCapture("nope", { content: "x" })).toThrow(/not found/i);
  });
  it("setting a proposal moves it to review", async () => {
    const { capture } = await createCapture({ content: "x" });
    const u = updateCapture(capture.id, { proposal: { ...goodProposal, tasks: [] } });
    expect(u.status).toBe("proposed");
    expect(u.proposal?.title).toBe(goodProposal.title);
  });
  it("deleting removes the row and moves attachments to .trash", async () => {
    const { capture } = await createCapture({ content: "x", files: [{ name: "a.txt", data: Buffer.from("keep") }] });
    const att = attachmentFile(capture.attachments[0].id).fullPath;
    deleteCapture(capture.id);
    expect(getCapture(capture.id)).toBeNull();
    expect(fs.existsSync(att)).toBe(false);
    expect(fs.readdirSync(`${getConfig().attachmentsDir}/.trash`)).toHaveLength(1);
    expect(() => deleteCapture(capture.id)).toThrow(/not found/i);
    expect(() => attachmentFile("nope")).toThrow(/not found/i);
  });
});

describe("processCapture", () => {
  it("stores a cleaned proposal for review", async () => {
    setProvider(fakeProvider({
      json: {
        ...goodProposal, related_projects: ["Garden", "Invented project"], next_action: "Buy tomato seeds",
        tasks: [{ title: "  Buy   tomato seeds " }, { title: "Dig the bed", due_date: "2026-04-01" }, { title: "dig the bed" }, { title: "Water", due_date: "soon" }],
      },
    }));
    createProject({ name: "Garden" });
    const { capture } = await createCapture({ content: "grow tomatoes" });
    const done = await processCapture(capture.id);
    expect(done.status).toBe("proposed");
    expect(done.model).toBe("fake-chat");
    expect(done.proposal!.related_projects).toEqual(["Garden"]);
    expect(done.proposal!.tasks).toEqual([{ title: "Dig the bed", due_date: "2026-04-01" }, { title: "Water", due_date: undefined }]);
  });
  it("keeps at most three tasks", async () => {
    setProvider(fakeProvider({ json: { ...goodProposal, tasks: ["A", "B", "C", "D"].map((title) => ({ title })) } }));
    const { capture } = await createCapture({ content: "x" });
    expect((await processCapture(capture.id)).proposal!.tasks.map((x) => x.title)).toEqual(["A", "B", "C"]);
  });
  it("fails the whole proposal when the model returns more than four tasks", async () => {
    setProvider(fakeProvider({ json: { ...goodProposal, tasks: ["A", "B", "C", "D", "E"].map((title) => ({ title })) } }));
    const { capture } = await createCapture({ content: "x" });
    expect((await processCapture(capture.id)).status).toBe("failed");
  });
  it("does not offer archived projects to the model", async () => {
    const p = fakeProvider({ json: { ...goodProposal, related_projects: ["Old"] } });
    setProvider(p);
    const old = createProject({ name: "Old" });
    const { updateProject } = await import("../src/lib/projects.ts");
    updateProject(old.id, { status: "archived" });
    const { capture } = await createCapture({ content: "x" });
    expect((await processCapture(capture.id)).proposal!.related_projects).toEqual([]);
  });
  it("records a friendly failure when the model is down, and keeps the original", async () => {
    setProvider(fakeProvider({ down: true }));
    const { capture } = await createCapture({ content: "precious" });
    const failed = await processCapture(capture.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/Cannot reach Ollama/);
    expect(failed.content).toBe("precious");
  });
  it("records a failure when the model's answer has the wrong shape", async () => {
    setProvider(fakeProvider({ json: { title: "" } }));
    const { capture } = await createCapture({ content: "x" });
    const failed = await processCapture(capture.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/expected format/);
  });
  it("refuses to start a capture that is already processing, but retries a stale one", async () => {
    setProvider(fakeProvider({ json: goodProposal }));
    const { capture } = await createCapture({ content: "x" });
    const { getDb } = await import("../src/lib/db.ts");
    getDb().prepare("UPDATE captures SET status='processing', updated_at=? WHERE id=?").run(new Date().toISOString(), capture.id);
    await expect(processCapture(capture.id)).rejects.toMatchObject({ status: 409 });
    getDb().prepare("UPDATE captures SET status='processing', updated_at=? WHERE id=?").run(new Date(Date.now() - 10 * 60_000).toISOString(), capture.id);
    expect((await processCapture(capture.id)).status).toBe("proposed");
    await expect(processCapture("nope")).rejects.toMatchObject({ status: 404 });
  });
  it("processAllPending stops early when Ollama is unreachable", async () => {
    setProvider(fakeProvider({ down: true }));
    await createCapture({ content: "one" });
    await createCapture({ content: "two" });
    await createCapture({ content: "three" });
    const r = await processAllPending();
    expect(r.failed).toBe(1);
    expect(listCaptures({ status: "new" })).toHaveLength(2);
  });
  it("processAllPending processes every new capture when the model works", async () => {
    setProvider(fakeProvider({ json: goodProposal }));
    await createCapture({ content: "one" });
    await createCapture({ content: "two" });
    expect(await processAllPending()).toEqual({ processed: 2, failed: 0 });
    expect(captureCounts()).toMatchObject({ awaitingReview: 2, unprocessed: 0, failed: 0, total: 2 });
  });
});

describe("acceptCapture", () => {
  const accept = (over = {}) => AcceptInput.parse({ title: "A note", body: "body", ...over });
  it("creates the note, links projects, and creates only the tasks that were approved", async () => {
    const p = createProject({ name: "Garden" });
    const { capture } = await createCapture({ content: "raw" });
    const { note, taskIds } = acceptCapture(capture.id, accept({ tags: ["x"], project_ids: [p.id], tasks: [{ title: "Do it", due_date: "2026-05-01" }, { title: "Another", priority: "high" }] }));
    expect(getNote(note.id)).toMatchObject({ title: "A note", tags: ["x"], sourceType: "capture", sourceRef: `capture:${capture.id}` });
    expect(taskIds).toHaveLength(2);
    expect(listTasks({}).map((t) => t.title).sort()).toEqual(["Another", "Do it"]);
    expect(getCapture(capture.id)).toMatchObject({ status: "accepted", note_id: note.id });
  });
  it("falls back to the capture text for an empty body and appends the source link once", async () => {
    const { capture } = await createCapture({ content: "the raw text", url: "https://example.com/p" });
    const { note } = acceptCapture(capture.id, accept({ body: "   " }));
    expect(getNote(note.id)!.body).toContain("the raw text");
    expect(getNote(note.id)!.body).toContain("Source: https://example.com/p");
    const second = await createCapture({ content: "see https://example.com/q", url: "https://example.com/q" });
    const again = acceptCapture(second.capture.id, accept({ title: "B", body: "see https://example.com/q" }));
    expect(getNote(again.note.id)!.body.match(/example\.com\/q/g)).toHaveLength(1);
  });
  it("cannot be accepted twice, and rejects unknown captures", async () => {
    const { capture } = await createCapture({ content: "x" });
    acceptCapture(capture.id, accept());
    expect(() => acceptCapture(capture.id, accept())).toThrow(/already/);
    expect(() => acceptCapture("nope", accept())).toThrow(/not found/i);
  });
  it("validates its input", () => {
    expect(() => accept({ title: "   " })).toThrow();
    expect(() => accept({ tasks: [{ title: "x", due_date: "05/01/2026" }] })).toThrow();
    expect(() => accept({ tasks: Array.from({ length: 11 }, (_, i) => ({ title: `t${i}` })) })).toThrow();
  });
});
