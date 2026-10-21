import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { route } from "../src/lib/api.ts";
import { createSessionToken, hashPassword, setPassword, verifyPassword, verifySessionToken, SESSION_COOKIE, loginAllowed, recordLoginFailure } from "../src/lib/auth.ts";
import { chatStream } from "../src/lib/chat.ts";
import { AcceptInput, acceptCapture, createCapture } from "../src/lib/captures.ts";
import { getConfig } from "../src/lib/config.ts";
import { createBackup, restoreBackup, exportAll } from "../src/lib/backup.ts";
import { importFiles } from "../src/lib/importer.ts";
import { getNote, listNotes } from "../src/lib/notes.ts";
import { setProvider } from "../src/lib/ollama.ts";
import { buildContextPackage } from "../src/lib/claude-handoff.ts";
import { search } from "../src/lib/search.ts";
import { cleanup, fakeProvider, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

const h = route({ body: z.object({ a: z.string().min(1) }) }, ({ body }) => ({ echo: body.a }));
const req = (method: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request("http://localhost:3000/api/x", { method, headers: { host: "localhost:3000", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("password + session", () => {
  it("hashes and verifies passwords, rejects short ones", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored).not.toContain("correct");
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(() => setPassword("short")).toThrow();
  });
  it("sessions are signed, expire, and die when the password changes", () => {
    setPassword("a-very-long-password");
    const t = createSessionToken();
    expect(verifySessionToken(t)).toBe(true);
    expect(verifySessionToken(t + "x")).toBe(false);
    expect(verifySessionToken(t.split(".")[0] + ".AAAA")).toBe(false);
    expect(verifySessionToken(t, Date.now() + 8 * 24 * 3600_000)).toBe(false);
    setPassword("another-long-password");
    expect(verifySessionToken(t)).toBe(false);
  });
  it("throttles repeated login failures", () => {
    for (let i = 0; i < 8; i++) recordLoginFailure("ip-x");
    expect(loginAllowed("ip-x")).toBe(false);
    expect(loginAllowed("other")).toBe(true);
  });
});

describe("route wrapper", () => {
  it("refuses everything until a password is configured", async () => {
    const res = await h(req("POST", { "x-sbos": "1" }, { a: "x" }));
    expect(res.status).toBe(503);
  });
  it("requires auth, CSRF header, same origin, and valid bodies", async () => {
    setPassword("a-very-long-password");
    const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;
    expect((await h(req("POST", { "x-sbos": "1" }, { a: "x" }))).status).toBe(401);
    expect((await h(req("POST", { cookie }, { a: "x" }))).status).toBe(403); // no CSRF header
    expect((await h(req("POST", { cookie, "x-sbos": "1", origin: "https://evil.example" }, { a: "x" }))).status).toBe(403);
    expect((await h(req("POST", { cookie, "x-sbos": "1" }, { a: "" }))).status).toBe(400);
    const ok = await h(req("POST", { cookie, "x-sbos": "1", origin: "http://localhost:3000" }, { a: "hi" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ echo: "hi" });
  });
  it("hides internal error details", async () => {
    setPassword("a-very-long-password");
    const boom = route({}, () => { throw new Error("secret path C:\\Users\\x\\db"); });
    const res = await boom(req("GET", { cookie: `${SESSION_COOKIE}=${createSessionToken()}` }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

async function readStream(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

describe("grounded chat", () => {
  it("retrieves sources, passes them to the model and stores them", async () => {
    const fp = fakeProvider({ chatChunks: ["It is ", "in [1]."] });
    setProvider(fp);
    const { capture } = await createCapture({ content: "seed" });
    acceptCapture(capture.id, AcceptInput.parse({ title: "Router setup", body: "The router admin password is stored in the safe." }));
    const events = await readStream(chatStream({ message: "where is the router password", useLibrary: true }));
    expect(events[0]).toMatchObject({ type: "meta", grounded: true });
    expect((events[0].sources as { title: string }[])[0].title).toBe("Router setup");
    expect(events.at(-1)!.type).toBe("done");
    expect(fp.chatCalls[0].system).toContain("Router setup");
    expect(fp.chatCalls[0].system).toContain("LIBRARY PASSAGES");
  });
  it("tells the model when nothing relevant was found", async () => {
    const fp = fakeProvider();
    setProvider(fp);
    const events = await readStream(chatStream({ message: "what is the airspeed of a swallow", useLibrary: true }));
    expect((events[0].sources as unknown[]).length).toBe(0);
    expect(fp.chatCalls[0].system).toContain("NO relevant passages were retrieved");
  });
  it("streams a clear error when Ollama is unavailable and keeps the user message", async () => {
    setProvider(fakeProvider({ down: true }));
    const events = await readStream(chatStream({ message: "hello", useLibrary: false }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "unavailable" });
  });
});

describe("import, backup, restore, export", () => {
  it("imports md/txt, flags duplicates and unsupported files without losing the rest", async () => {
    const out = await importFiles([
      { name: "a.md", data: Buffer.from("# Alpha\n\nalpha content") },
      { name: "a-copy.md", data: Buffer.from("# Alpha\n\nalpha content") },
      { name: "b.docx", data: Buffer.from("PK") },
      { name: "c.txt", data: Buffer.from("plain text note") },
      { name: "bin.txt", data: Buffer.from([0x4d, 0x5a, 0, 0]) },
    ]);
    expect(out.map((o) => o.status)).toEqual(["imported", "duplicate", "unsupported", "imported", "failed"]);
    expect(out[2].error).toMatch(/Word/);
    expect(listNotes()).toHaveLength(2);
    expect(fs.readdirSync(getConfig().importsDir).length).toBe(2); // originals preserved
    expect((await search("alpha")).hits[0].title).toBe("Alpha");
  });

  it("backs up and restores the database, notes and attachments", async () => {
    const { capture } = await createCapture({ content: "important thought", files: [{ name: "doc.txt", data: Buffer.from("attached text") }] });
    const { note } = acceptCapture(capture.id, AcceptInput.parse({ title: "Keep me", body: "precious body" }));
    const backup = await createBackup();
    expect(fs.existsSync(path.join(backup.dir, "sbos.db"))).toBe(true);

    // disaster: delete everything
    fs.rmSync(path.join(getConfig().vaultDir, note.path));
    const { closeDb } = await import("../src/lib/db.ts");
    closeDb();
    fs.writeFileSync(getConfig().dbPath, "corrupt");

    const { safetyCopy } = restoreBackup(backup.name);
    expect(fs.existsSync(safetyCopy)).toBe(true);
    expect(getNote(note.id)!.body.trim()).toBe("precious body");
    expect(fs.readdirSync(path.join(getConfig().attachmentsDir, new Date().toISOString().slice(0, 7))).length).toBe(1);
    expect(() => restoreBackup("../../etc")).toThrow();
    const ex = exportAll();
    expect(fs.readdirSync(path.join(ex.dir, "notes")).some((f) => f.endsWith(".md"))).toBe(true);
  });
});

describe("Claude handoff", () => {
  it("builds a reviewable package from selected notes only", async () => {
    const { capture } = await createCapture({ content: "s" });
    const { note } = acceptCapture(capture.id, AcceptInput.parse({ title: "Alpha", body: "alpha body" }));
    const pkg = buildContextPackage({ noteIds: [note.id], question: "What next?" });
    expect(pkg.markdown).toContain("alpha body");
    expect(pkg.markdown).toContain("What next?");
    expect(pkg.included).toHaveLength(1);
    expect(() => buildContextPackage({ noteIds: [], question: "x" })).toThrow();
  });
});
