import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaError, OllamaProvider, pullHint } from "../src/lib/ollama.ts";

const BASE = "http://ollama.test:11434";
type Call = { url: string; init: RequestInit; body: Record<string, unknown> | null };
let calls: Call[];

/** Replaces fetch with a scripted sequence of responses (or errors), recording each request. */
function script(...replies: (Response | Error | ((c: Call) => Response))[]) {
  calls = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = { url, init, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(call) : r;
  }));
}
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const status = (code: number, text = "") => new Response(text, { status: code });
const ndjson = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });
const collect = async (g: AsyncGenerator<string>) => { const out: string[] = []; for await (const s of g) out.push(s); return out; };

let p: OllamaProvider;
beforeEach(() => { p = new OllamaProvider(BASE); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("pullHint", () => {
  it("includes the size for known models, with or without a tag", () => {
    expect(pullHint("nomic-embed-text")).toBe("Run: ollama pull nomic-embed-text  (about 274 MB of disk space)");
    expect(pullHint("llama3.2:3b")).toContain("about 2 GB");
    expect(pullHint("mystery:1b")).toBe("Run: ollama pull mystery:1b");
  });
});

describe("requests and errors", () => {
  it("reads the model list", async () => {
    script(ok({ models: [{ name: "a", size: 5 }, { name: "b", size: 7 }] }));
    expect(await p.listModels()).toEqual([{ name: "a", sizeBytes: 5 }, { name: "b", sizeBytes: 7 }]);
    expect(calls[0].url).toBe(`${BASE}/api/tags`);
  });
  it("treats a missing models array as empty", async () => {
    script(ok({}));
    expect(await p.listModels()).toEqual([]);
  });
  it("health reports ok, and an error message instead of throwing when Ollama is down", async () => {
    script(ok({ models: [] }));
    expect(await p.health()).toEqual({ ok: true, models: [] });
    script(new TypeError("fetch failed"));
    const h = await p.health();
    expect(h.ok).toBe(false);
    expect(h.error).toContain(`Cannot reach Ollama at ${BASE}`);
  });
  it("maps a network failure to 'unavailable' with a hint", async () => {
    script(new TypeError("fetch failed"));
    await expect(p.listModels()).rejects.toMatchObject({ code: "unavailable", hint: expect.stringContaining("Start Ollama") });
  });
  it("maps a 404 for a named model to 'model_missing' with the pull command", async () => {
    script(status(404, "model not found"));
    await expect(p.embed("nomic-embed-text", ["x"])).rejects.toMatchObject({ code: "model_missing", message: 'Model "nomic-embed-text" is not installed.', hint: expect.stringContaining("ollama pull nomic-embed-text") });
  });
  it("maps other failures to 'bad_response', keeping the status and trimming the body", async () => {
    script(status(500, "x".repeat(500)));
    const e = (await p.listModels().catch((err) => err)) as OllamaError;
    expect(e).toBeInstanceOf(OllamaError);
    expect(e.code).toBe("bad_response");
    expect(e.message.startsWith("Ollama returned 500: ")).toBe(true);
    expect(e.message.length).toBeLessThan(260);
  });
  it("times out when Ollama does not answer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); })));
    const pending = p.listModels().catch((e) => e as OllamaError);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toMatchObject({ code: "timeout" });
  });
  it("lets a caller's own abort through as the original error, not a timeout", async () => {
    const ctl = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); })));
    const pending = collect(p.chatStream("m", [{ role: "user", content: "hi" }], ctl.signal)).catch((e) => e as Error);
    ctl.abort();
    const e = await pending;
    expect(e).not.toBeInstanceOf(OllamaError);
    expect((e as Error).name).toBe("AbortError");
  });
});

describe("capabilities", () => {
  it("returns what the server reports, and [] when unknown", async () => {
    script(ok({ capabilities: ["completion", "tools"] }));
    expect(await p.capabilities("m")).toEqual(["completion", "tools"]);
    script(ok({}));
    expect(await p.capabilities("m")).toEqual([]);
    script(status(500, "old server"));
    expect(await p.capabilities("m")).toEqual([]);
    script(new TypeError("down"));
    expect(await p.capabilities("m")).toEqual([]);
  });
  it("still reports a model that is not installed", async () => {
    script(status(404));
    await expect(p.capabilities("ghost")).rejects.toMatchObject({ code: "model_missing" });
  });
});

describe("chatJson", () => {
  it("sends the schema, low temperature and think:false, and parses the answer", async () => {
    script(ok({ message: { content: '{"a":1}' } }));
    const schema = { type: "object" };
    expect(await p.chatJson("m", [{ role: "user", content: "hi" }], schema)).toEqual({ a: 1 });
    expect(calls[0].url).toBe(`${BASE}/api/chat`);
    expect(calls[0].body).toMatchObject({ model: "m", stream: false, format: schema, think: false, options: { temperature: 0.2 } });
  });
  it("retries once without think when the model rejects it, and only then", async () => {
    script(status(400, '"qwen" does not support think'), ok({ message: { content: "{}" } }));
    expect(await p.chatJson("m", [], {})).toEqual({});
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toHaveProperty("think", false);
    expect(calls[1].body).not.toHaveProperty("think");
  });
  it("does not retry on unrelated errors", async () => {
    script(status(500, "boom"));
    await expect(p.chatJson("m", [], {})).rejects.toMatchObject({ code: "bad_response" });
    expect(calls).toHaveLength(1);
  });
  it("rejects an answer that is not JSON, and an empty one", async () => {
    script(ok({ message: { content: "Sure! Here you go" } }));
    await expect(p.chatJson("m", [], {})).rejects.toMatchObject({ code: "bad_response", message: "The model did not return valid JSON." });
    script(ok({}));
    await expect(p.chatJson("m", [], {})).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("chatStream", () => {
  it("yields each piece of content and asks for a large context window", async () => {
    script(ndjson(['{"message":{"content":"Hel"}}\n{"message":{"content":"lo"}}\n', '{"done":true}\n']));
    expect(await collect(p.chatStream("m", [{ role: "user", content: "hi" }]))).toEqual(["Hel", "lo"]);
    expect(calls[0].body).toMatchObject({ stream: true, options: { num_ctx: 8192 } });
  });
  it("reassembles a line split across network chunks, including multi-byte characters", async () => {
    const line = '{"message":{"content":"héllo ✓"}}\n';
    const bytes = new TextEncoder().encode(line);
    const cut = line.indexOf("é") + 1; // inside the two-byte sequence
    script(new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close(); } })));
    expect(await collect(p.chatStream("m", []))).toEqual(["héllo ✓"]);
  });
  it("skips blank lines and events with no content", async () => {
    script(ndjson(['\n\n{"message":{"content":""}}\n{"message":{"role":"assistant"}}\n{"message":{"content":"ok"}}\n']));
    expect(await collect(p.chatStream("m", []))).toEqual(["ok"]);
  });
  it("raises the error an event carries, after the pieces before it", async () => {
    script(ndjson(['{"message":{"content":"a"}}\n{"error":"model crashed"}\n']));
    const out: string[] = [];
    await expect((async () => { for await (const s of p.chatStream("m", [])) out.push(s); })()).rejects.toMatchObject({ code: "bad_response", message: "model crashed" });
    expect(out).toEqual(["a"]);
  });
  it("fails clearly when there is no body", async () => {
    script(new Response(null, { status: 200 }));
    await expect(collect(p.chatStream("m", []))).rejects.toMatchObject({ code: "bad_response" });
  });
  it("keeps a final event that arrives without a trailing newline", async () => {
    script(ndjson(['{"message":{"content":"first"}}\n{"message":{"content":"last"}}']));
    expect(await collect(p.chatStream("m", []))).toEqual(["first", "last"]);
  });
});

describe("embed", () => {
  it("returns one vector per input", async () => {
    script(ok({ embeddings: [[1, 0], [0, 1]] }));
    expect(await p.embed("e", ["a", "b"])).toEqual([[1, 0], [0, 1]]);
    expect(calls[0].body).toEqual({ model: "e", input: ["a", "b"] });
  });
  it("rejects a response with the wrong number of vectors or none", async () => {
    script(ok({ embeddings: [[1]] }));
    await expect(p.embed("e", ["a", "b"])).rejects.toMatchObject({ code: "bad_response" });
    script(ok({}));
    await expect(p.embed("e", ["a"])).rejects.toMatchObject({ code: "bad_response" });
  });
});
