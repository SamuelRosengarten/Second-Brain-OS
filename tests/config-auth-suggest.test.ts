import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, assertSameOrigin, json, route } from "../src/lib/api.ts";
import {
  clearLoginFailures, createSessionToken, hashPassword, isAuthenticated, loginAllowed, parseCookies, recordLoginFailure, SESSION_COOKIE, sessionCookie, setPassword, verifyPassword, verifySessionToken,
} from "../src/lib/auth.ts";
import { getConfig, sessionSecretProblem } from "../src/lib/config.ts";
import { readForm } from "../src/lib/http.ts";
import { setProvider } from "../src/lib/ollama.ts";
import { createProject, createTask } from "../src/lib/projects.ts";
import { MAX_SUGGESTIONS, similarTitles, SuggestInput, suggestTasks } from "../src/lib/task-suggestions.ts";
import { cleanup, fakeProvider, freshEnv } from "./helpers.ts";

let dir: string;
const saved = { ...process.env };
beforeEach(() => { dir = freshEnv(); });
afterEach(() => { cleanup(dir); process.env = { ...saved }; });

describe("getConfig", () => {
  it("puts every folder under the data directory", () => {
    const c = getConfig();
    for (const p of [c.dbPath, c.vaultDir, c.attachmentsDir, c.importsDir, c.exportsDir, c.backupsDir]) expect(p.startsWith(c.dataDir)).toBe(true);
  });
  it("has local-only defaults and strips a trailing slash from the Ollama URL", () => {
    delete process.env.OLLAMA_URL;
    expect(getConfig().ollamaUrl).toBe("http://127.0.0.1:11434");
    process.env.OLLAMA_URL = "http://box:11434/";
    expect(getConfig().ollamaUrl).toBe("http://box:11434");
  });
  it("parses the origin list, trimming blanks", () => {
    process.env.SBOS_ALLOWED_ORIGINS = " https://a.example , ,https://b.example ";
    expect(getConfig().allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    process.env.SBOS_ALLOWED_ORIGINS = "";
    expect(getConfig().allowedOrigins).toEqual([]);
  });
  it("reads secure cookies only from exactly 1", () => {
    process.env.SBOS_SECURE_COOKIES = "1";
    expect(getConfig().secureCookies).toBe(true);
    process.env.SBOS_SECURE_COOKIES = "true";
    expect(getConfig().secureCookies).toBe(false);
  });
  it("converts the upload limit from MB with a floor of 1 MB", () => {
    process.env.SBOS_MAX_UPLOAD_MB = "2";
    expect(getConfig().maxUploadBytes).toBe(2 * 1024 * 1024);
    delete process.env.SBOS_MAX_UPLOAD_MB;
    expect(getConfig().maxUploadBytes).toBe(25 * 1024 * 1024);
    for (const odd of ["0", "-5"]) {
      process.env.SBOS_MAX_UPLOAD_MB = odd;
      expect(getConfig().maxUploadBytes).toBe(1024 * 1024);
    }
  });
  it("rejects a short or placeholder session secret", () => {
    process.env.SBOS_SESSION_SECRET = "short";
    expect(sessionSecretProblem()).toMatch(/at least 32/);
    process.env.SBOS_SESSION_SECRET = "change-me-" + "x".repeat(40);
    expect(sessionSecretProblem()).toMatch(/placeholder/);
    process.env.SBOS_SESSION_SECRET = "a".repeat(40);
    expect(sessionSecretProblem()).toBeNull();
    delete process.env.SBOS_SESSION_SECRET;
    expect(sessionSecretProblem()).toMatch(/at least 32/);
  });
});

describe("passwords", () => {
  it("never stores the same hash twice for the same password", () => {
    expect(hashPassword("correct horse battery")).not.toBe(hashPassword("correct horse battery"));
    expect(hashPassword("correct horse battery")).toMatch(/^scrypt\$32768\$8\$1\$/);
  });
  it("verifies only the right password and rejects malformed hashes", () => {
    const h = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("correct horse batterY", h)).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
    expect(verifyPassword("x", "scrypt$32768$8$1$AAAA")).toBe(false);
  });
  it("requires at least 12 characters", () => {
    expect(() => setPassword("short")).toThrow(/12/);
    expect(() => setPassword("exactly12chr")).not.toThrow();
  });
});

describe("sessions and cookies", () => {
  beforeEach(() => setPassword("a long enough password"));
  it("accepts a fresh token until it expires after seven days", () => {
    const now = Date.now();
    const t = createSessionToken(now);
    expect(verifySessionToken(t, now + 1000)).toBe(true);
    expect(verifySessionToken(t, now + 7 * 86400_000 - 5000)).toBe(true);
    expect(verifySessionToken(t, now + 7 * 86400_000 + 5000)).toBe(false);
  });
  it("rejects empty, malformed, truncated and tampered tokens", () => {
    const t = createSessionToken();
    const [payload, sig] = t.split(".");
    for (const bad of [undefined, null, "", "abc", ".", `${payload}.`, `.${sig}`, `${payload}.${sig}x`, `${payload}.${sig.slice(0, -2)}`]) expect(verifySessionToken(bad)).toBe(false);
    const forged = Buffer.from(JSON.stringify({ exp: 9_999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBe(false);
  });
  it("is invalid under a different secret, or once the password changes", () => {
    const t = createSessionToken();
    process.env.SBOS_SESSION_SECRET = "z".repeat(40);
    expect(verifySessionToken(t)).toBe(false);
    process.env.SBOS_SESSION_SECRET = saved.SBOS_SESSION_SECRET ?? "test-secret-test-secret-test-secret-1234567890";
    process.env.SBOS_SESSION_SECRET = "test-secret-test-secret-test-secret-1234567890";
    expect(verifySessionToken(t)).toBe(true);
    setPassword("another long password");
    expect(verifySessionToken(t)).toBe(false);
  });
  it("two tokens made together differ", () => {
    expect(createSessionToken(1000)).not.toBe(createSessionToken(1000));
  });
  it("isAuthenticated finds the cookie among others and survives garbage", () => {
    const t = createSessionToken();
    expect(isAuthenticated(`a=1; ${SESSION_COOKIE}=${encodeURIComponent(t)}; b=2`)).toBe(true);
    expect(isAuthenticated(null)).toBe(false);
    expect(isAuthenticated("garbage")).toBe(false);
    expect(isAuthenticated(`${SESSION_COOKIE}=%E0%A4%A`)).toBe(false);
  });
  it("parseCookies decodes values, keeps '=' inside them, and skips malformed ones", () => {
    expect(parseCookies("a=1; b=x%20y; c=k=v; bad=%E0%A4%A; novalue")).toEqual({ a: "1", b: "x y", c: "k=v" });
    expect(parseCookies(null)).toEqual({});
  });
  it("builds a strict HttpOnly cookie, secure only when configured, and can clear it", () => {
    const c = sessionCookie("TOKEN");
    expect(c).toContain("sbos_session=TOKEN");
    for (const attr of ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=604800"]) expect(c).toContain(attr);
    expect(c).not.toContain("Secure");
    process.env.SBOS_SECURE_COOKIES = "1";
    expect(sessionCookie("TOKEN")).toContain("; Secure");
    const cleared = sessionCookie("TOKEN", true);
    expect(cleared).toContain("sbos_session=;");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).not.toContain("TOKEN");
  });
});

describe("login throttle", () => {
  it("blocks the eighth failure inside the window, per key, and recovers after it", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 7; i++) recordLoginFailure("ip-a", t0 + i);
    expect(loginAllowed("ip-a", t0 + 10)).toBe(true);
    recordLoginFailure("ip-a", t0 + 8);
    expect(loginAllowed("ip-a", t0 + 10)).toBe(false);
    expect(loginAllowed("ip-b", t0 + 10)).toBe(true);
    expect(loginAllowed("ip-a", t0 + 16 * 60_000)).toBe(true);
    clearLoginFailures("ip-a");
    expect(loginAllowed("ip-a", t0 + 10)).toBe(true);
  });
  it("starts a fresh window after the old one lapses", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 8; i++) recordLoginFailure("ip-c", t0);
    expect(loginAllowed("ip-c", t0 + 1)).toBe(false);
    recordLoginFailure("ip-c", t0 + 20 * 60_000);
    expect(loginAllowed("ip-c", t0 + 20 * 60_000 + 1)).toBe(true);
    clearLoginFailures("ip-c");
  });
});

describe("assertSameOrigin", () => {
  const req = (method: string, headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method, headers });
  it("lets reads through without a header", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(() => assertSameOrigin(req(m, {}))).not.toThrow();
  });
  it("requires the custom header on writes", () => {
    expect(() => assertSameOrigin(req("POST", {}))).toThrow(/CSRF/);
    expect(() => assertSameOrigin(req("POST", { "x-sbos": "0" }))).toThrow(/CSRF/);
    expect(() => assertSameOrigin(req("DELETE", { "x-sbos": "1" }))).not.toThrow();
  });
  it("accepts the request's own host over http or https, and configured origins only", () => {
    expect(() => assertSameOrigin(req("POST", { "x-sbos": "1", host: "localhost:3000", origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { "x-sbos": "1", host: "localhost:3000", origin: "https://localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { "x-sbos": "1", host: "localhost:3000", origin: "https://evil.example" }))).toThrow(/Cross-origin/);
    process.env.SBOS_ALLOWED_ORIGINS = "https://box.ts.net";
    expect(() => assertSameOrigin(req("POST", { "x-sbos": "1", host: "127.0.0.1:3000", origin: "https://box.ts.net" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { "x-sbos": "1", host: "localhost:3000", origin: "null" }))).toThrow(/Cross-origin/);
  });
});

describe("route wrapper responses", () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { method: "POST", body, headers: { "x-sbos": "1", ...headers } });
  it("json() never lets the browser cache", () => {
    const r = json({ a: 1 }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("turns bad JSON into 400, oversized bodies into 413, and unexpected throws into a generic 500", async () => {
    const open = route({ public: true, body: (await import("zod")).z.object({ a: (await import("zod")).z.number() }) }, ({ body }) => ({ a: body.a }));
    expect((await open(post("{nope"))).status).toBe(400);
    expect((await open(post(JSON.stringify({ a: "x" })))).status).toBe(400);
    expect((await open(post("x".repeat(2 * 1024 * 1024 + 1)))).status).toBe(413);
    const ok = await open(post(JSON.stringify({ a: 2 })));
    expect(await ok.json()).toEqual({ a: 2 });
    const boom = route({ public: true }, () => { throw new Error("secret path C:\\private"); });
    const res = await boom(post(""));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("private");
  });
  it("runs a public route's guard before reading the body, and passes ApiError through", async () => {
    let bodyRead = false;
    const guarded = route({ public: true, guard: () => { throw new ApiError(401, "no token", "unauthenticated"); }, body: (await import("zod")).z.object({}) }, () => { bodyRead = true; });
    const res = await guarded(post("{}"));
    expect(res.status).toBe(401);
    expect(bodyRead).toBe(false);
  });
  it("returns { ok: true } for a handler that returns nothing, and resolves route params", async () => {
    const r = route({ public: true }, ({ params }) => (params.id === "7" ? undefined : { id: params.id }));
    expect(await (await r(post(""), { params: Promise.resolve({ id: "7" }) })).json()).toEqual({ ok: true });
    expect(await (await r(post(""), { params: Promise.resolve({ id: "8" }) })).json()).toEqual({ id: "8" });
  });
});

describe("readForm", () => {
  const formReq = (form: FormData, headers: Record<string, string> = {}) => new Request("http://localhost/api/upload", { method: "POST", body: form, headers });
  it("separates fields from files", async () => {
    const form = new FormData();
    form.set("kind", "idea");
    form.append("files", new File(["hello"], "a.txt"));
    const { fields, files } = await readForm(formReq(form));
    expect(fields).toEqual({ kind: "idea" });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("a.txt");
    expect(files[0].data.toString()).toBe("hello");
  });
  it("rejects an oversized file with 413", async () => {
    process.env.SBOS_MAX_UPLOAD_MB = "1";
    const form = new FormData();
    form.append("files", new File([new Uint8Array(1024 * 1024 + 1)], "big.bin"));
    await expect(readForm(formReq(form))).rejects.toMatchObject({ status: 413, code: "too_large" });
  });
  it("rejects a huge declared length before reading, and non-form bodies with 400", async () => {
    process.env.SBOS_MAX_UPLOAD_MB = "1";
    await expect(readForm(new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-length": String(10 * 1024 * 1024) } }))).rejects.toMatchObject({ status: 413 });
    await expect(readForm(new Request("http://localhost/x", { method: "POST", body: "plain", headers: { "content-type": "text/plain" } }))).rejects.toMatchObject({ status: 400, code: "bad_form" });
  });
});

describe("similarTitles", () => {
  it("matches identical titles regardless of case and spacing", () => {
    expect(similarTitles("Buy milk", "  buy   MILK ")).toBe(true);
    expect(similarTitles("", "")).toBe(false);
  });
  it("matches a reworded copy but not a different task", () => {
    expect(similarTitles("Write the quarterly budget report", "Write quarterly budget reports for the team")).toBe(true);
    expect(similarTitles("Write the quarterly budget report", "Water the tomato plants")).toBe(false);
  });
  it("needs three shared words, so short titles only match when identical", () => {
    expect(similarTitles("Call mum", "Call mum today")).toBe(false);
    expect(similarTitles("Call mum", "Call mum")).toBe(true);
  });
  it("folds simple plurals", () => {
    expect(similarTitles("Review pull requests today", "Review pull request today again")).toBe(true);
  });
});

describe("suggestTasks", () => {
  const model = (tasks: Record<string, unknown>[]) => fakeProvider({ json: { tasks: tasks.map((t) => ({ title: "t", description: "", priority: "medium", due_date: "", project: "", ...t })) } });
  const ask = (over: Record<string, unknown> = {}) => suggestTasks(SuggestInput.parse({ request: "plan my week", today: "2026-06-10", ...over }));
  it("validates its input", () => {
    expect(() => SuggestInput.parse({ request: "   " })).toThrow();
    expect(() => SuggestInput.parse({ request: "x".repeat(2001) })).toThrow();
  });
  it("returns cleaned suggestions with real projects and dates only", async () => {
    const p = createProject({ name: "Garden" });
    setProvider(model([
      { title: "  Plant   the seeds ", project: "garden", due_date: "2026-06-12", priority: "high", description: " soon " },
      { title: "Invent a project", project: "Ghost", due_date: "2026-02-31" },
      { title: "Old date", due_date: "2020-01-01" },
      { title: "   " },
    ]));
    const r = await ask();
    expect(r.suggestions).toEqual([
      { title: "Plant the seeds", description: "soon", priority: "high", due_date: "2026-06-12", project_id: p.id, project_name: "Garden" },
      { title: "Invent a project", description: "", priority: "medium", due_date: null, project_id: null, project_name: null },
      { title: "Old date", description: "", priority: "medium", due_date: null, project_id: null, project_name: null },
    ]);
  });
  it("skips copies of open tasks and of its own earlier suggestions, but not of finished tasks", async () => {
    createTask({ title: "Write the quarterly budget report" });
    createTask({ title: "Book dentist appointment next week", status: "done" });
    setProvider(model([
      { title: "Write quarterly budget reports for the team" },
      { title: "Book dentist appointment next week" },
      { title: "Clean the garage thoroughly this weekend" },
      { title: "Clean garage thoroughly this weekend please" },
    ]));
    const r = await ask();
    expect(r.suggestions.map((s) => s.title)).toEqual(["Book dentist appointment next week", "Clean the garage thoroughly this weekend"]);
    expect(r.skippedDuplicates).toBe(2);
  });
  it("forces the chosen project onto every task and rejects an unknown or archived one", async () => {
    const p = createProject({ name: "Garden" });
    setProvider(model([{ title: "One", project: "other" }, { title: "Two" }]));
    expect((await ask({ projectId: p.id })).suggestions.every((s) => s.project_id === p.id)).toBe(true);
    await expect(ask({ projectId: "ghost" })).rejects.toMatchObject({ status: 400 });
  });
  it(`never returns more than ${MAX_SUGGESTIONS}`, async () => {
    setProvider(model(["Paint fence", "Order seeds", "Call plumber", "Renew passport", "Email landlord", "Sharpen knives", "Defrost freezer", "Update résumé", "Book flights", "Sort receipts", "Backup laptop", "Prune roses"].map((title) => ({ title }))));
    expect((await ask()).suggestions).toHaveLength(MAX_SUGGESTIONS);
  });
  it("answers 502 when the model's output has the wrong shape, and does not save anything", async () => {
    setProvider(fakeProvider({ json: { tasks: "nope" } }));
    await expect(ask()).rejects.toMatchObject({ status: 502, code: "bad_model_output" });
    const { listTasks } = await import("../src/lib/projects.ts");
    expect(listTasks()).toEqual([]);
  });
  it("passes today's date and the project names to the model", async () => {
    createProject({ name: "Garden" });
    const spy = vi.fn(async (_m: string, messages: { role: string; content: string }[]) => { void messages; return { tasks: [] }; });
    const p = fakeProvider();
    p.chatJson = spy as never;
    setProvider(p);
    await ask();
    const system = spy.mock.calls[0][1][0].content;
    expect(system).toContain("Today is 2026-06-10");
    expect(system).toContain('"Garden"');
    expect(spy.mock.calls[0][1][1]).toEqual({ role: "user", content: "plan my week" });
  });
});
