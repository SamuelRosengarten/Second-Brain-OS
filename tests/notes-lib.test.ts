import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/lib/config.ts";
import { chunkMarkdown, cleanTags, createNote, deleteNote, getNote, listNotes, listTags, parseMarkdown, reindexVault, renderMarkdown, updateNote } from "../src/lib/notes.ts";
import { cleanup, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

describe("frontmatter", () => {
  it("round-trips values with quotes, colons and unicode", () => {
    const meta = { id: "a", title: 'He said "hi": ok', summary: "Résumé: ✓", tags: ["a", "b"] };
    const text = renderMarkdown(meta, "Body line\n");
    const back = parseMarkdown(text);
    expect(back.meta).toMatchObject(meta);
    expect(back.body).toBe("Body line\n");
  });
  it("renders only known keys, in a fixed order", () => {
    const text = renderMarkdown({ title: "T", id: "x", unknown: "dropped" }, "b");
    expect(text.split("\n").slice(0, 4)).toEqual(["---", 'id: "x"', 'title: "T"', "---"]);
    expect(text).not.toContain("unknown");
  });
  it("treats text without frontmatter as all body", () => {
    expect(parseMarkdown("# Just text\n")).toEqual({ meta: {}, body: "# Just text\n" });
  });
  it("accepts unquoted, hand-written values and CRLF line endings", () => {
    const parsed = parseMarkdown("---\r\ntitle: Plain title\r\ntags: [\"x\"]\r\n---\r\n\r\nHello");
    expect(parsed.meta.title).toBe("Plain title");
    expect(parsed.meta.tags).toEqual(["x"]);
    expect(parsed.body).toBe("Hello");
  });
  it("ignores malformed frontmatter lines", () => {
    expect(parseMarkdown("---\nnot a pair\n: nothing\ntitle: ok\n---\nbody").meta).toEqual({ title: "ok" });
  });
});

describe("cleanTags", () => {
  it("lowercases, strips #, hyphenates spaces and de-duplicates", () => {
    expect(cleanTags(["#Garden", "garden", "Deep Work", "  "])).toEqual(["garden", "deep-work"]);
  });
  it("accepts a comma separated string and ignores other types", () => {
    expect(cleanTags("a, b ,#c")).toEqual(["a", "b", "c"]);
    expect(cleanTags(42)).toEqual([]);
    expect(cleanTags(undefined)).toEqual([]);
  });
  it("drops tags over 40 characters and caps the list at 20", () => {
    expect(cleanTags(["x".repeat(41), "ok"])).toEqual(["ok"]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
  });
});

describe("chunkMarkdown", () => {
  it("returns nothing for an empty body", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("\n\n  \n")).toEqual([]);
  });
  it("tracks the current heading", () => {
    const chunks = chunkMarkdown("# One\n\nalpha\n\n## Two\n\nbeta");
    expect(chunks.map((c) => c.heading)).toEqual(["One", "Two"]);
    expect(chunks[1].text).toContain("beta");
  });
  it("splits long paragraphs and never exceeds the limit", () => {
    const chunks = chunkMarkdown("x".repeat(2500), 1000);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1000);
    expect(chunks.map((c) => c.text).join("")).toBe("x".repeat(2500));
  });
  it("packs short paragraphs together up to the limit", () => {
    const paras = Array.from({ length: 10 }, (_, i) => `para ${i} ${"y".repeat(80)}`).join("\n\n");
    const chunks = chunkMarkdown(paras, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(10);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(300);
  });
});

describe("note storage", () => {
  it("writes a Markdown file with frontmatter and returns the same note", () => {
    const n = createNote({ title: "My Garden Plan", body: "Plant tomatoes.", tags: ["Garden"], category: "life", summary: "A plan" });
    const file = path.join(getConfig().vaultDir, n.path);
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain(`id: "${n.id}"`);
    expect(text).toContain("Plant tomatoes.");
    expect(getNote(n.id)).toMatchObject({ title: "My Garden Plan", tags: ["garden"], category: "life", fileMissing: false });
    expect(getNote(n.id)!.body.trim()).toBe("Plant tomatoes.");
  });
  it("names an empty title Untitled and keeps same-title notes in separate files", () => {
    const a = createNote({ title: "  ", body: "a" });
    const b = createNote({ title: "Same", body: "1" });
    const c = createNote({ title: "Same", body: "2" });
    expect(a.title).toBe("Untitled");
    expect(b.path).not.toBe(c.path);
  });
  it("never lets a title escape the vault", () => {
    const n = createNote({ title: "../../evil", body: "x" });
    expect(n.path).not.toMatch(/[\\/]/);
    expect(fs.existsSync(path.join(getConfig().vaultDir, n.path))).toBe(true);
  });
  it("updates only the fields given", () => {
    const n = createNote({ title: "T", body: "one", tags: ["a"], summary: "s" });
    const u = updateNote(n.id, { body: "two" });
    expect(u).toMatchObject({ title: "T", body: "two", tags: ["a"], summary: "s" });
    expect(updateNote(n.id, { tags: [] }).tags).toEqual([]);
    expect(updateNote(n.id, { title: "   " }).title).toBe("T");
    expect(getNote(n.id)!.body.trim()).toBe("two");
  });
  it("refuses to update a missing note, or one whose file is gone", () => {
    expect(() => updateNote("nope", { body: "x" })).toThrow(/not found/i);
    const n = createNote({ title: "T", body: "b" });
    fs.rmSync(path.join(getConfig().vaultDir, n.path));
    expect(getNote(n.id)).toMatchObject({ fileMissing: true, body: "" });
    expect(() => updateNote(n.id, { body: "x" })).toThrow(/missing/i);
  });
  it("deleting moves the file to .trash instead of erasing it", () => {
    const n = createNote({ title: "Doomed", body: "keep me" });
    deleteNote(n.id);
    expect(getNote(n.id)).toBeNull();
    const trash = path.join(getConfig().vaultDir, ".trash");
    expect(fs.readdirSync(trash)).toHaveLength(1);
    expect(fs.readFileSync(path.join(trash, fs.readdirSync(trash)[0]), "utf8")).toContain("keep me");
    expect(() => deleteNote(n.id)).toThrow(/not found/i);
  });
});

describe("listing", () => {
  it("filters by text with LIKE wildcards escaped", () => {
    createNote({ title: "100% done", body: "x" });
    createNote({ title: "Plain", body: "x" });
    expect(listNotes({ q: "100%" }).map((n) => n.title)).toEqual(["100% done"]);
    expect(listNotes({ q: "_" })).toEqual([]);
  });
  it("filters by tag and category, and sorts by title", () => {
    createNote({ title: "banana", body: "x", tags: ["fruit"], category: "food" });
    createNote({ title: "Apple", body: "x", tags: ["fruit"], category: "food" });
    createNote({ title: "Car", body: "x", tags: ["vehicle"], category: "stuff" });
    expect(listNotes({ tag: "fruit", sort: "title" }).map((n) => n.title)).toEqual(["Apple", "banana"]);
    expect(listNotes({ category: "stuff" }).map((n) => n.title)).toEqual(["Car"]);
  });
  it("ignores an unknown sort key rather than injecting it", () => {
    createNote({ title: "A", body: "x" });
    expect(() => listNotes({ sort: "title; DROP TABLE notes" as never })).not.toThrow();
    expect(listNotes()).toHaveLength(1);
  });
  it("pages results and caps the page size", () => {
    for (let i = 0; i < 5; i++) createNote({ title: `N${i}`, body: "x" });
    expect(listNotes({ limit: 2 })).toHaveLength(2);
    expect(listNotes({ limit: 2, offset: 4 })).toHaveLength(1);
    expect(listNotes({ limit: 100000 })).toHaveLength(5);
  });
  it("counts tags, most used first", () => {
    createNote({ title: "1", body: "x", tags: ["a", "b"] });
    createNote({ title: "2", body: "x", tags: ["b"] });
    expect(listTags()).toEqual([{ tag: "b", count: 2 }, { tag: "a", count: 1 }]);
  });
});

describe("reindexVault", () => {
  it("picks up files dropped into the vault, including subfolders, and skips dot folders", () => {
    const vault = getConfig().vaultDir;
    fs.mkdirSync(path.join(vault, "sub"), { recursive: true });
    fs.mkdirSync(path.join(vault, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(vault, "sub", "outside.md"), "# From Obsidian\n\nhello #idea");
    fs.writeFileSync(path.join(vault, ".hidden", "skip.md"), "# Skip me");
    fs.writeFileSync(path.join(vault, "readme.txt"), "not markdown");
    const r = reindexVault();
    expect(r).toMatchObject({ scanned: 1, added: 1, updated: 0, removed: 0, errors: [] });
    expect(listNotes().map((n) => n.title)).toEqual(["From Obsidian"]);
  });
  it("is idempotent, notices edits, and forgets deleted files without touching others", () => {
    const a = createNote({ title: "Keep", body: "stays" });
    const b = createNote({ title: "Remove", body: "goes" });
    expect(reindexVault()).toMatchObject({ added: 0, updated: 0, removed: 0 });
    fs.appendFileSync(path.join(getConfig().vaultDir, a.path), "\nmore text\n");
    expect(reindexVault()).toMatchObject({ updated: 1 });
    fs.rmSync(path.join(getConfig().vaultDir, b.path));
    expect(reindexVault()).toMatchObject({ removed: 1 });
    expect(getNote(a.id)!.body).toContain("more text");
    expect(getNote(b.id)).toBeNull();
  });
  it("does not modify the files it indexes", () => {
    const vault = getConfig().vaultDir;
    fs.mkdirSync(vault, { recursive: true });
    const file = path.join(vault, "plain.md");
    fs.writeFileSync(file, "no frontmatter here\n");
    reindexVault();
    expect(fs.readFileSync(file, "utf8")).toBe("no frontmatter here\n");
  });
  it("falls back to the first heading, then the file name, for the title", () => {
    const vault = getConfig().vaultDir;
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "a.md"), "intro\n\n# Heading Title\n");
    fs.writeFileSync(path.join(vault, "my-file-name.md"), "no heading");
    reindexVault();
    expect(listNotes().map((n) => n.title).sort()).toEqual(["Heading Title", "my-file-name"]);
  });
});
