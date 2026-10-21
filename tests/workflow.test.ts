import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptCapture, AcceptInput, createCapture, deleteCapture, getCapture, listCaptures, processCapture, updateCapture } from "../src/lib/captures.ts";
import { getConfig } from "../src/lib/config.ts";
import { getNote, listNotes, reindexVault, updateNote, deleteNote } from "../src/lib/notes.ts";
import { OllamaProvider, setProvider } from "../src/lib/ollama.ts";
import { search, embedPending, embeddingStatus } from "../src/lib/search.ts";
import { createProject, createTask, listTasks, projectDetail, updateTask, linkNote } from "../src/lib/projects.ts";
import { buildBriefing } from "../src/lib/briefing.ts";
import { cleanup, fakeProvider, freshEnv, goodProposal } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

describe("capture -> note workflow", () => {
  it("persists the capture before AI, processes, accepts into a Markdown note, and finds it by search", async () => {
    const { capture, duplicate } = await createCapture({ content: "Grow tomato plants in the backyard garden this spring", kind: "idea" });
    expect(duplicate).toBe(false);
    expect(capture.status).toBe("new");
    expect(getCapture(capture.id)!.original_content).toContain("tomato");

    setProvider(fakeProvider({ json: goodProposal }));
    const processed = await processCapture(capture.id);
    expect(processed.status).toBe("proposed");
    expect(processed.proposal!.title).toBe("Backyard tomato garden");
    expect(processed.original_content).toBe(capture.original_content); // untouched

    const { note, taskIds } = acceptCapture(capture.id, AcceptInput.parse({
      title: processed.proposal!.title, body: processed.proposal!.note_markdown, summary: processed.proposal!.summary,
      tags: processed.proposal!.tags, category: "idea", tasks: [{ title: "Buy tomato seeds" }],
    }));
    expect(taskIds).toHaveLength(1);
    const file = path.join(getConfig().vaultDir, note.path);
    const md = fs.readFileSync(file, "utf8");
    expect(md).toMatch(/^---\nid: /);
    expect(md).toContain("## Next action");
    expect(getCapture(capture.id)!.status).toBe("accepted");
    expect(() => acceptCapture(capture.id, AcceptInput.parse({ title: "x", body: "y" }))).toThrow(/already/);

    const res = await search("tomato seeds");
    expect(res.hits[0].noteId).toBe(note.id);
    expect(res.hits[0].path).toBe(note.path);
    expect(res.semantic.used).toBe(false); // no embeddings yet -> keyword fallback
  });

  it("rejects duplicate submissions", async () => {
    const a = await createCapture({ content: "Same   thought" });
    const b = await createCapture({ content: "same thought" });
    expect(b.duplicate).toBe(true);
    expect(b.capture.id).toBe(a.capture.id);
    expect(listCaptures()).toHaveLength(1);
  });

  it("keeps the capture when Ollama is down, then retries successfully", async () => {
    const { capture } = await createCapture({ content: "An idea that must never be lost" });
    setProvider(fakeProvider({ down: true }));
    const failed = await processCapture(capture.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/Cannot reach Ollama/);
    expect(failed.original_content).toBe("An idea that must never be lost");

    setProvider(fakeProvider({ json: goodProposal }));
    expect((await processCapture(capture.id)).status).toBe("proposed");
  });

  it("records a clear error when the model returns malformed output", async () => {
    const { capture } = await createCapture({ content: "Some content" });
    setProvider(fakeProvider({ json: { title: "only a title" } }));
    const r = await processCapture(capture.id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/expected format/);
  });

  it("drops related projects the model invented", async () => {
    createProject({ name: "Garden" });
    const { capture } = await createCapture({ content: "garden stuff" });
    setProvider(fakeProvider({ json: { ...goodProposal, related_projects: ["Garden", "Made Up"] } }));
    expect((await processCapture(capture.id)).proposal!.related_projects).toEqual(["Garden"]);
  });

  it("reports a missing Ollama server through the real provider (nothing listening)", async () => {
    setProvider(new OllamaProvider("http://127.0.0.1:9"));
    const { capture } = await createCapture({ content: "offline test" });
    const r = await processCapture(capture.id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Cannot reach Ollama/);
  });

  it("reports a missing model with the exact pull command", async () => {
    const server = (await import("node:http")).createServer((_req, res) => { res.statusCode = 404; res.end("not found"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      setProvider(new OllamaProvider(`http://127.0.0.1:${port}`));
      const { capture } = await createCapture({ content: "model missing test" });
      const r = await processCapture(capture.id, "qwen3.5:9b");
      expect(r.error).toContain("ollama pull qwen3.5:9b");
    } finally { server.close(); }
  });

  it("edits, archives and deletes captures; attachments are validated", async () => {
    const { capture } = await createCapture({ content: "edit me" });
    expect(updateCapture(capture.id, { content: "edited" }).content).toBe("edited");
    expect(getCapture(capture.id)!.original_content).toBe("edit me");
    updateCapture(capture.id, { archived: true });
    expect(listCaptures()).toHaveLength(0);
    expect(listCaptures({ archived: true })).toHaveLength(1);

    await expect(createCapture({ files: [{ name: "evil.exe", data: Buffer.from("MZ") }] })).rejects.toMatchObject({ status: 415 });
    await expect(createCapture({ files: [{ name: "fake.pdf", data: Buffer.from("not a pdf") }] })).rejects.toMatchObject({ status: 415 });
    const withFile = await createCapture({ files: [{ name: "../../notes.txt", data: Buffer.from("file body") }] });
    expect(withFile.capture.attachments[0].filename).toBe("notes.txt");
    expect(withFile.capture.content).toContain("file body");
    const stored = fs.readdirSync(path.join(getConfig().attachmentsDir, new Date().toISOString().slice(0, 7)));
    expect(stored.some((f) => f.endsWith("notes.txt"))).toBe(true);
    deleteCapture(withFile.capture.id);
    expect(getCapture(withFile.capture.id)).toBeNull();
  });
});

describe("notes + search", () => {
  it("edits, reindexes from files, trashes on delete", async () => {
    setProvider(fakeProvider());
    const { capture } = await createCapture({ content: "x" });
    const { note } = acceptCapture(capture.id, AcceptInput.parse({ title: "Budget plan", body: "Monthly budget and invoice tracking", tags: ["Money"] }));
    expect(getNote(note.id)!.tags).toEqual(["money"]);

    updateNote(note.id, { body: "Monthly budget with python scripts" });
    expect((await search("python")).hits).toHaveLength(1);
    expect((await search("invoice")).hits).toHaveLength(0);

    // external edit + new file appear after reindex; DB wipe is recoverable
    fs.writeFileSync(path.join(getConfig().vaultDir, "external.md"), "# External note\n\nwritten in another editor with zebra");
    const r = reindexVault();
    expect(r.added).toBe(1);
    expect((await search("zebra")).hits[0].title).toBe("External note");

    deleteNote(note.id);
    expect(getNote(note.id)).toBeNull();
    expect(fs.existsSync(path.join(getConfig().vaultDir, ".trash", note.path))).toBe(true);
    expect(listNotes().map((n) => n.title)).toEqual(["External note"]);
  });

  it("uses semantic search when embeddings exist and falls back when Ollama is gone", async () => {
    setProvider(fakeProvider());
    const { capture } = await createCapture({ content: "seed" });
    acceptCapture(capture.id, AcceptInput.parse({ title: "Growing tomato", body: "Water the tomato plants every morning" }));
    acceptCapture(capture.id.length ? (await createCapture({ content: "other" })).capture.id : "", AcceptInput.parse({ title: "Finance", body: "Pay the invoice and review the budget" }));
    expect(embeddingStatus().embedded).toBe(0);
    expect((await embedPending()).embedded).toBeGreaterThan(0);

    const hit = await search("garden tomato water");
    expect(hit.semantic.used).toBe(true);
    expect(hit.hits[0].title).toBe("Growing tomato");

    setProvider(fakeProvider({ down: true }));
    const fallback = await search("tomato");
    expect(fallback.semantic.used).toBe(false);
    expect(fallback.hits[0].title).toBe("Growing tomato");
  });

  it("is safe against FTS operator injection", async () => {
    expect((await search('" OR * NEAR( AND')).hits).toEqual([]);
    expect((await search("NOT")).hits).toEqual([]);
  });
});

describe("projects, tasks, briefing", () => {
  it("links notes/tasks to projects and builds a truthful briefing", async () => {
    const empty = buildBriefing();
    expect(empty.counts.openTasks).toBe(0);
    expect(empty.notes[0]).toBe("Nothing needs attention right now.");

    const p = createProject({ name: "Website", goals: "Ship v1" });
    const yesterday = new Date(Date.now() - 86400_000);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const t1 = createTask({ title: "Overdue", due_date: iso(yesterday), project_id: p.id, priority: "high" });
    createTask({ title: "Today", due_date: iso(new Date()) });
    createTask({ title: "No date" });
    const { capture } = await createCapture({ content: "n" });
    const { note } = acceptCapture(capture.id, AcceptInput.parse({ title: "Spec", body: "b" }));
    linkNote(p.id, note.id);

    const b = buildBriefing();
    expect(b.counts).toMatchObject({ openTasks: 3, overdue: 1, dueToday: 1, activeProjects: 1 });
    expect(b.overdue[0].id).toBe(t1.id);
    expect(b.notes.join(" ")).toContain("no calendar is connected");

    const done = updateTask(t1.id, { status: "done" });
    expect(done.completed_at).not.toBeNull();
    expect(updateTask(t1.id, { status: "todo" }).completed_at).toBeNull();
    expect(listTasks({ status: "open", priority: "high" })).toHaveLength(1);
    const d = projectDetail(p.id)!;
    expect(d.tasks).toHaveLength(1);
    expect(d.notes).toHaveLength(1);
    expect(d.activity.length).toBeGreaterThan(2);
  });

  it("validates input", () => {
    expect(() => createTask({ title: "" })).toThrow();
    expect(() => createTask({ title: "x", due_date: "tomorrow" })).toThrow();
    expect(() => createTask({ title: "x", project_id: "nope" })).toThrow(/Unknown project/);
  });
});

describe("share-sheet style captures", () => {
  it("treats a lone link as a link capture, but leaves text and explicit kinds alone", async () => {
    const link = (await createCapture({ content: "  https://example.com/article?x=1  " })).capture;
    expect(link).toMatchObject({ kind: "link", url: "https://example.com/article?x=1" });
    const sentence = (await createCapture({ content: "Read https://example.com/b later" })).capture;
    expect(sentence).toMatchObject({ kind: "text", url: "" });
    const explicit = (await createCapture({ content: "https://example.com/c", kind: "excerpt" })).capture;
    expect(explicit).toMatchObject({ kind: "excerpt", url: "" });
    // the same link twice is still a duplicate
    expect((await createCapture({ content: "https://example.com/article?x=1" })).duplicate).toBe(true);
  });
});
