// End-to-end smoke test against a RUNNING instance (real HTTP, real cookies, real Ollama if available).
//   SBOS_URL=http://127.0.0.1:3000 SBOS_SMOKE_PASSWORD=... npm run smoke
// It creates test data (prefixed "SMOKE") in the instance you point it at. Use a scratch data dir.
const BASE = process.env.SBOS_URL || "http://127.0.0.1:3000";
const PASSWORD = process.env.SBOS_SMOKE_PASSWORD;
const SKIP_AI = process.env.SBOS_SMOKE_SKIP_AI === "1";
if (!PASSWORD) {
  console.error("Set SBOS_SMOKE_PASSWORD");
  process.exit(2);
}

let cookie = "";
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
};
async function call(path, { method = "GET", body, form, headers = {} } = {}) {
  const h = { "x-sbos": "1", ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method: method === "GET" && payload ? "POST" : method, headers: h, body: payload, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return res;
}
const j = async (res) => res.json().catch(() => ({}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- auth & security gates
ok("health is public", (await fetch(BASE + "/api/health")).status === 200);
ok("API requires auth", (await fetch(BASE + "/api/captures")).status === 401);
ok("page redirects to /login when signed out", (await fetch(BASE + "/inbox", { redirect: "manual" })).status === 307 || (await fetch(BASE + "/inbox", { redirect: "manual" })).status === 308 || (await fetch(BASE + "/inbox", { redirect: "manual" })).headers.get("location")?.includes("/login"));
ok("login without CSRF header rejected", (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) })).status === 403);
ok("wrong password rejected", (await call("/api/auth/login", { body: { password: "definitely-wrong-password" } })).status === 401);
const login = await call("/api/auth/login", { body: { password: PASSWORD } });
ok("login succeeds", login.status === 200 && cookie.startsWith("sbos_session="));
ok("cookie is HttpOnly + SameSite=Strict", /HttpOnly/i.test(login.headers.get("set-cookie") || "") && /SameSite=Strict/i.test(login.headers.get("set-cookie") || ""));
ok("cross-origin POST rejected", (await call("/api/tasks", { method: "POST", body: { title: "x" }, headers: { origin: "https://evil.example" } })).status === 403);

// --- capture -> proposal -> note
const marker = `SMOKE ${Date.now()}`;
const created = await j(await call("/api/captures", { body: { kind: "idea", content: `${marker}: Build a small raised-bed tomato garden behind the house. Need to check sunlight and buy cedar boards.` } }));
const capId = created.capture?.id;
ok("capture saved before AI", !!capId && created.capture.status === "new");
const dup = await j(await call("/api/captures", { body: { kind: "idea", content: `${marker}: Build a small raised-bed tomato garden behind the house. Need to check sunlight and buy cedar boards.` } }));
ok("duplicate submission detected", dup.duplicate === true && dup.capture.id === capId);

let proposal = null;
if (!SKIP_AI) {
  const t0 = Date.now();
  const proc = await j(await call(`/api/captures/${capId}/process`, { body: {} }));
  ok("AI processing returns a proposal", proc.capture?.status === "proposed", `${((Date.now() - t0) / 1000).toFixed(1)}s, model ${proc.capture?.model}${proc.capture?.error ? ", error: " + proc.capture.error : ""}`);
  proposal = proc.capture?.proposal;
  if (proposal) console.log("      proposal:", JSON.stringify({ title: proposal.title, category: proposal.category, tags: proposal.tags, next: proposal.next_action, conf: proposal.confidence }));
}
const accepted = await j(await call(`/api/captures/${capId}/accept`, {
  body: {
    title: proposal?.title || `${marker} tomato garden`,
    body: proposal?.note_markdown || `${marker}\n\nBuild a small raised-bed tomato garden behind the house.`,
    summary: proposal?.summary || "", category: proposal?.category || "idea", tags: proposal?.tags || ["garden"],
    tasks: [{ title: `${marker} buy cedar boards`, priority: "high" }],
  },
}));
const noteId = accepted.note?.id;
ok("capture accepted into a Markdown note", !!noteId && accepted.taskIds?.length === 1);

// --- search + Q&A
const hits = await j(await call("/api/search?q=" + encodeURIComponent("tomato garden")));
ok("note is found by search", hits.hits?.some((h) => h.noteId === noteId), `semantic.used=${hits.semantic?.used}`);
if (!SKIP_AI) {
  const res = await call("/api/chat", { body: { message: "What do I need to buy for my tomato garden?", useLibrary: true } });
  const text = await res.text();
  const events = text.trim().split("\n").map((l) => JSON.parse(l));
  const meta = events.find((e) => e.type === "meta");
  const err = events.find((e) => e.type === "error");
  const answer = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  ok("grounded chat retrieves the note as a source", meta?.sources?.some((s) => s.noteId === noteId));
  ok("chat streamed an answer", answer.length > 10 && !err, err ? err.message : `${answer.length} chars`);
  if (answer) console.log("      answer:", answer.slice(0, 220).replace(/\s+/g, " "));
}

// --- projects & tasks & briefing
const proj = await j(await call("/api/projects", { body: { name: `${marker} Garden`, goals: "Harvest tomatoes" } }));
ok("project created", !!proj.project?.id);
await call(`/api/projects/${proj.project.id}`, { method: "PUT", body: { note_id: noteId, action: "link" } });
const today = new Date().toLocaleDateString("sv");
const task = await j(await call("/api/tasks", { body: { title: `${marker} water seedlings`, due_date: today, project_id: proj.project.id } }));
ok("task created and linked to project", task.task?.project_id === proj.project.id);
const brief = await j(await call("/api/briefing"));
ok("briefing reflects real data", brief.counts?.dueToday >= 1 && brief.notes?.some((n) => /no calendar/i.test(n)));
const detail = await j(await call(`/api/projects/${proj.project.id}`));
ok("project shows note, task and activity", detail.notes?.length === 1 && detail.tasks?.length === 1 && detail.activity?.length >= 2);

// --- Claude handoff (local only)
const pkg = await j(await call("/api/claude/package", { body: { noteIds: [noteId], question: "What should I do first?" } }));
ok("Claude context package built locally", pkg.markdown?.includes("What should I do first?"));

// --- hardening probes
const trav = await call("/api/notes/..%2F..%2Fetc%2Fpasswd");
ok("path-traversal id is just a 404", trav.status === 404 || trav.status === 400);
const bad = await call("/api/captures", { body: { content: "x", url: "javascript:alert(1)" } });
ok("non-http URL rejected", bad.status === 400);
const exe = new FormData();
exe.set("content", "file test");
exe.append("files", new Blob(["MZ"]), "evil.exe");
ok("executable upload rejected", (await call("/api/captures", { form: exe })).status === 415);

// --- backup
const bk = await j(await call("/api/backup", { body: {} }));
ok("backup created", bk.backup?.files > 0, bk.backup?.dir);

// --- pages render
for (const p of ["/", "/inbox", "/capture", "/search", "/knowledge", "/projects", "/tasks", "/ai", "/automations", "/settings", "/more", `/inbox/${capId}`, `/knowledge/${noteId}`, `/projects/${proj.project.id}`]) {
  const r = await call(p);
  ok(`page ${p} renders`, r.status === 200);
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
