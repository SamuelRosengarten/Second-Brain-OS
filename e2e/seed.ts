import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-test-password-123";

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Seeds the same kind of data the redesign mock-ups show: five projects, tasks across the week with estimates and dependencies,
 * a few notes with tags, and captures waiting for review. Everything created is returned so a test can remove it afterwards.
 */
export async function seedDesignData(page: Page) {
  const created: string[] = [];
  const H = { "x-sbos": "1" };
  const post = async (url: string, data: unknown) => {
    const res = await page.request.post(url, { headers: H, data });
    const r = (await res.json().catch(() => ({}))) as Record<string, any>;
    const item = r.project ?? r.task ?? r.note ?? r.capture;
    if (item?.id && !url.includes("/deps")) created.push(`${url}/${item.id}`);
    return r;
  };
  const project = async (name: string) => (await post("/api/projects", { name, goals: name })).project.id as string;
  const sb = await project("Second Brain OS");
  const pa = await project("ProAnima");
  const inn = await project("Internship");
  const po = await project("Portfolio app");
  const le = await project("Leatherwork");
  const sc = await project("School");
  const task = async (title: string, pid: string | null, due: string | null, extra: Record<string, unknown> = {}) =>
    (await post("/api/tasks", { title, project_id: pid, due_date: due, ...extra })).task.id as string;
  const t = {
    portfolioLink: await task("Send portfolio link to two internship contacts", inn, inDays(-2), { priority: "high", estimate_min: 20 }),
    er: await task("Finish the ProAnima entity-relationship diagram", pa, inDays(0), { priority: "high", estimate_min: 120 }),
    deps: await task("Wire task dependencies into the Plan view", sb, inDays(0), { estimate_min: 180 }),
    reply: await task("Reply to team about DB naming", pa, inDays(0), { estimate_min: 15 }),
    tutoring: await task("Prepare examples for Thursday tutoring", sc, inDays(1), { estimate_min: 60 }),
    sql: await task("Write SQL for adoption tables", pa, inDays(1), { estimate_min: 120 }),
    paint: await task("Order edge paint and waxed thread", le, inDays(2), { estimate_min: 10 }),
    stats: await task("Portfolio: GitHub stats card", po, inDays(2), { estimate_min: 120 }),
    graph: await task("Graph view prototype", sb, inDays(2), { estimate_min: 180 }),
    backup: await task("Check the weekly backup ran", sb, inDays(2), { estimate_min: 10 }),
    cut: await task("Cut card holder v3 pieces", le, inDays(3), { estimate_min: 120 }),
    review: await task("Weekly review: plan next week", null, inDays(4), { estimate_min: 30 }),
    done: await task("Fix inbox filter bug", sb, inDays(-1), { status: "done", estimate_min: 60 }),
  };
  const dep = (b: string, a: string) => post(`/api/tasks/${b}/deps`, { depends_on: a });
  await dep(t.sql, t.er);
  await dep(t.graph, t.deps);
  await dep(t.er, t.reply);

  const n1 = (await post("/api/notes", { title: "Weekly planning ritual", body: "A week planned on Sunday is a week I do not have to plan every morning.\n\n## The ritual\n\n1. Empty the inbox.\n2. Pick three outcomes.\n3. Place tasks on days in Plan.\n\nSee also [[ER model: adoption requests]].", tags: ["planning", "routine"], summary: "Sunday evening: empty the inbox, pick three outcomes, then place tasks on days." })).note.id as string;
  const n2 = (await post("/api/notes", { title: "ER model: adoption requests", body: "Animal 1-N Request, Request N-1 Adopter. Status lives on Request, not Animal.", tags: ["database"], summary: "Status lives on Request, not Animal." })).note.id as string;
  await post("/api/notes", { title: "Bodycam: recoil feel", body: "Camera shake should lead the muzzle by one frame.", tags: ["godot"], summary: "Camera shake should lead the muzzle by one frame, then settle over 120 ms." });
  await page.request.put(`/api/projects/${sb}`, { headers: H, data: { note_id: n1, action: "link" } });
  await page.request.put(`/api/projects/${pa}`, { headers: H, data: { note_id: n2, action: "link" } });

  // Captures: the fake local model proposes a title, tags and tasks for these.
  for (const content of [
    "When I find something in Safari on my phone I want one tap to send it here. Maybe an iOS Shortcut that posts to the share endpoint with the token?",
    "Shorten the pocket by 4 mm, keep the 3.85 mm stitch line, test on the scrap leather first.",
    "Article: spaced repetition for notes. Worth trying for the weekly review.",
  ]) await post("/api/captures", { content, process: true });
  await expect.poll(async () => ((await (await page.request.get("/api/captures?status=proposed")).json()).captures as unknown[]).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  const cleanup = async () => {
    for (const url of created.splice(0).reverse()) await page.request.delete(url, { headers: H }).catch(() => undefined);
  };
  return { ids: { sb, pa, inn, po, le, sc, n1, n2, ...t }, cleanup };
}
