import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e-test-password-123";
const SHOTS = "test-results/shots";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Quick capture").or(page.getByRole("navigation", { name: "Mobile" })).first()).toBeVisible();
}

/** WCAG 2.2 A/AA scan of what is on screen right now; findings are collected and asserted at the end of each test. */
async function axe(page: Page, label: string, found: string[]) {
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  for (const v of r.violations) {
    const nodes = v.nodes.slice(0, 3).map((n) => `      ${n.target.join(" ")}  ${(n.failureSummary ?? "").split("\n")[1] ?? ""}`).join("\n");
    found.push(`${label}: ${v.id} (${v.impact}) ${v.help} [${v.nodes.length}]\n${nodes}`);
  }
}

const created: string[] = [];
async function post(page: Page, url: string, data: unknown): Promise<Record<string, any>> {
  const res = await page.request.post(url, { headers: { "x-sbos": "1" }, data });
  const r = (await res.json().catch(() => ({}))) as Record<string, any>;
  const item = r.project ?? r.task ?? r.note;
  if (item?.id && !url.includes("/deps")) created.push(`${url}/${item.id}`);
  return r;
}

/** Seeds four projects, dependent tasks, a note with a tag and a project link, so every part of the page has something to show. */
async function seed(page: Page) {
  const proj = async (name: string) => (await post(page, "/api/projects", { name, goals: name })).project.id as string;
  const li = await proj("LinkedIn Profile");
  const dg = await proj("Death Guard Learn");
  const pf = await proj("Portfolio");
  const cc = await proj("Code Coach");
  const task = async (title: string, project: string, due: string | null, extra: Record<string, unknown> = {}) =>
    (await post(page, "/api/tasks", { title, project_id: project, due_date: due, ...extra })).task.id as string;
  // Titles sort by due date, so the AI fake (which links T1 -> T2) points at the first two tasks listed below.
  const d1 = await task("Draft the next lesson", dg, inDays(-1));
  const c1 = await task("Add edge-case tests for hash()", cc, inDays(3));
  const p1 = await task("Replace the placeholder projects section", pf, inDays(4));
  const p2 = await task("Update the headline and About section", pf, inDays(4));
  const p3 = await task("Redeploy to gh-pages", pf, inDays(4));
  const l1 = await task("Rewrite headline around my internship search", li, inDays(5));
  const c2 = await task("Add a unit test for packModels()", cc, inDays(3));
  const l2 = await task("Message contacts about internship openings", li, inDays(7));
  const d2 = await task("Write a quiz for the lesson", dg, inDays(8));
  const l3 = await task("Follow target companies", li, null);
  const dep = (b: string, a: string) => post(page, `/api/tasks/${b}/deps`, { depends_on: a });
  await dep(c2, c1);
  await dep(p2, p1);
  await dep(p3, p1);
  await dep(p3, p2);
  await dep(l2, l1);
  await dep(d2, d1);
  const note = (await post(page, "/api/notes", { title: "Internship search 2027", body: "x", tags: ["internship"] })).note.id as string;
  await page.request.put(`/api/projects/${li}`, { headers: { "x-sbos": "1" }, data: { note_id: note, action: "link" } });
  return { li, dg, pf, cc, d1, c1, p1, p2, p3, l1, l2, d2, c2, l3, note };
}

test("workflow: timeline, dependencies, critical path, AI suggestions, dragging, graph, themes", async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark" });
  const found: string[] = [];
  await login(page);
  try {
    const s = await seed(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/workflow");
    await expect(page.getByRole("heading", { name: "Workflow", level: 1 })).toBeVisible();

    // lanes, chips with status badges, and the day-load numbers
    await expect(page.getByRole("button", { name: /^Rewrite headline around my internship search Ready/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Message contacts about internship openings Blocked/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Draft the next lesson Overdue/ })).toBeVisible();
    await expect(page.getByText("The number under each date is how many tasks are due that day")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/workflow-timeline-dark.png` });
    await axe(page, "timeline (dark)", found);

    // critical path: the longest unfinished chain (Portfolio: placeholder -> headline -> redeploy)
    await page.getByRole("button", { name: "Critical path" }).click();
    await expect(page.getByText(/3 tasks decide your finish date, ending/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/workflow-critical-dark.png` });
    await axe(page, "critical path (dark)", found);
    await page.getByRole("button", { name: "Critical path" }).click();

    // AI suggestions: nothing is linked until you accept; low-confidence ones are hidden behind a button
    await page.getByRole("button", { name: "Find links with AI" }).click();
    const panel = page.getByRole("region", { name: "Suggested dependencies" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("1 dependency suggested by your local AI. Nothing changes until you accept.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Show 1 low-confidence suggestion" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/workflow-suggestions-dark.png` });
    await axe(page, "suggestions panel (dark)", found);
    const before = (await (await page.request.get("/api/workflow")).json()).deps.length;
    await panel.getByRole("button", { name: /^Accept/ }).first().click();
    await expect(panel.getByText("No confident suggestions right now.")).toBeVisible();
    expect((await (await page.request.get("/api/workflow")).json()).deps.length).toBe(before + 1);
    await panel.getByRole("button", { name: "Show 1 low-confidence suggestion" }).click();
    await panel.getByRole("button", { name: /^Dismiss/ }).click();
    await expect(panel).toHaveCount(0);

    // pin a task: the details panel shows what it depends on and lets you add or remove dependencies
    await page.getByRole("button", { name: /^Update the headline and About section/ }).click();
    const details = page.getByRole("region", { name: "Details" });
    await expect(details.getByText("pinned")).toBeVisible();
    await expect(details.getByRole("button", { name: "Replace the placeholder projects section", exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Remove dependency on Replace the placeholder projects section" }).click();
    await expect(details.getByText("Nothing, ready to start")).toBeVisible();
    await details.getByLabel("Add a dependency").selectOption({ label: "Replace the placeholder projects section" });
    await details.getByRole("button", { name: "Add", exact: true }).click();
    await expect(details.getByRole("button", { name: "Replace the placeholder projects section", exact: true })).toBeVisible();
    // a loop is refused with a clear message: the placeholder task cannot wait for the headline task
    const loop = await page.request.post(`/api/tasks/${s.p1}/deps`, { headers: { "x-sbos": "1" }, data: { depends_on: s.p2 } });
    expect(loop.status()).toBe(400);
    expect((await loop.json()).error).toMatch(/loop/);

    // dragging a chip two days to the right changes its real due date; Undo date changes puts it back
    const chip = page.getByRole("button", { name: /^Rewrite headline around my internship search/ });
    const box = (await chip.boundingBox())!;
    const colW = Math.floor((await page.locator("section[aria-label='Timeline'] [role=region]").first().evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().width) - 40) / 14);
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 30 + colW, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + 30 + colW * 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => ((await (await page.request.get(`/api/tasks?status=open`)).json()).tasks as { id: string; due_date: string }[]).find((t) => t.id === s.l1)?.due_date).toBe(inDays(7));
    await page.getByRole("button", { name: "Undo date changes" }).click();
    await expect.poll(async () => ((await (await page.request.get(`/api/tasks?status=open`)).json()).tasks as { id: string; due_date: string }[]).find((t) => t.id === s.l1)?.due_date).toBe(inDays(5));

    // keyboard: focus a chip and press the right arrow to push it one day
    await page.getByRole("button", { name: /^Follow target companies/ }).count();
    await page.getByRole("button", { name: /^Message contacts about internship openings/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => ((await (await page.request.get(`/api/tasks?status=open`)).json()).tasks as { id: string; due_date: string }[]).find((t) => t.id === s.l2)?.due_date).toBe(inDays(8));

    // ticking the circle completes the task
    await page.getByRole("button", { name: "Mark done: Rewrite headline around my internship search" }).click();
    await expect.poll(async () => ((await (await page.request.get(`/api/tasks`)).json()).tasks as { id: string; status: string }[]).find((t) => t.id === s.l1)?.status).toBe("done");

    // graph view
    await page.getByRole("button", { name: "Graph" }).click();
    await expect(page.getByRole("button", { name: /^Task: Redeploy to gh-pages/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Note: Internship search 2027" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tag: #internship" })).toBeVisible();
    await page.getByRole("button", { name: /^Task: Redeploy to gh-pages/ }).hover();
    await expect(page.getByRole("region", { name: "Details" }).getByText("preview, click to pin")).toBeVisible();
    await page.mouse.move(5, 5);
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Note: Internship search 2027" })).toHaveCount(0);
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.reload(); // nothing pinned: a clean picture of the whole graph (the view choice is remembered)
    await expect(page.getByRole("button", { name: /^Task: Redeploy to gh-pages/ })).toBeVisible();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `${SHOTS}/workflow-graph-dark.png` });
    await axe(page, "graph (dark)", found);

    // light theme
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.screenshot({ path: `${SHOTS}/workflow-graph-light.png` });
    await axe(page, "graph (light)", found);
    await page.getByRole("button", { name: "Timeline" }).click();
    await page.screenshot({ path: `${SHOTS}/workflow-timeline-light.png` });
    await axe(page, "timeline (light)", found);
    await page.getByRole("button", { name: "Critical path" }).click();
    await axe(page, "critical path (light)", found);
    await page.getByRole("button", { name: /^Update the headline and About section/ }).click();
    await axe(page, "details pinned (light)", found);
    expect(found.join("\n"), "axe violations").toBe("");
  } finally {
    for (const url of created.splice(0).reverse()) await page.request.delete(url, { headers: { "x-sbos": "1" } }).catch(() => undefined);
  }
});

test("workflow on a phone: agenda with big tap targets, move dialog, inspector sheet and a touch-sized graph", async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark" });
  const found: string[] = [];
  await login(page);
  try {
    const s = await seed(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/workflow");
    await expect(page.getByRole("heading", { name: "Workflow", level: 1 })).toBeVisible();
    const noOverflow = async (what: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal overflow: ${what}`).toBeLessThanOrEqual(0);

    // the timeline becomes a vertical agenda, grouped by day
    await expect(page.getByRole("region", { name: /^Overdue, 1 tasks/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Today/ }).or(page.getByRole("region", { name: /^Overdue/ })).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Message contacts about internship openings/ })).toBeVisible();
    await expect(page.getByText("Waits for Rewrite headline around my internship search")).toBeVisible();
    await noOverflow("agenda");
    await page.screenshot({ path: `${SHOTS}/workflow-phone-agenda.png` });
    await axe(page, "phone agenda (dark)", found);

    // every interactive control in the agenda is at least 44px tall
    const small = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Timeline'] button")].map((b) => ({ n: (b.getAttribute("aria-label") ?? b.textContent ?? "").slice(0, 30), h: b.getBoundingClientRect().height })).filter((x) => x.h < 44));
    expect(small).toEqual([]);

    // move a task with the calendar button
    await page.getByRole("button", { name: "Move date of Draft the next lesson" }).click();
    const dlg = page.getByRole("dialog", { name: "Move due date" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Tomorrow" }).click();
    await expect.poll(async () => ((await (await page.request.get(`/api/tasks?status=open`)).json()).tasks as { id: string; due_date: string }[]).find((t) => t.id === s.d1)?.due_date).toBe(inDays(1));

    // tapping a task opens its details in a sheet
    await page.getByRole("button", { name: /^Update the headline and About section/ }).click();
    const sheet = page.getByRole("dialog", { name: "Details" });
    await expect(sheet.getByText("pinned")).toBeVisible();
    await expect(sheet.getByText("Depends on")).toBeVisible();
    await page.waitForTimeout(500); // let the sheet finish its open animation
    await page.screenshot({ path: `${SHOTS}/workflow-phone-details.png` });
    await axe(page, "phone details sheet (dark)", found);
    await page.keyboard.press("Escape");

    // controls wrap and stay usable
    await page.getByRole("button", { name: "Critical path" }).click();
    await expect(page.getByText(/tasks decide your finish date/)).toBeVisible();
    await noOverflow("critical path");
    await page.getByRole("button", { name: "Critical path" }).click();

    // graph at phone size: fits the screen, nodes are 36px touch targets, tapping pins and labels the neighbours
    await page.getByRole("button", { name: "Graph" }).click();
    await expect(page.getByRole("button", { name: /^Task: Redeploy to gh-pages/ })).toBeVisible();
    await noOverflow("graph");
    const nodeSize = await page.evaluate(() => Math.min(...[...document.querySelectorAll("section[aria-label='Graph'] button[aria-label^='Task:']")].map((b) => b.getBoundingClientRect().width)));
    expect(nodeSize).toBeGreaterThanOrEqual(36);
    await page.screenshot({ path: `${SHOTS}/workflow-phone-graph.png`, fullPage: true });
    await page.getByRole("button", { name: /^Task: Redeploy to gh-pages/ }).click();
    await expect(page.getByRole("dialog", { name: "Details" })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/workflow-phone-graph-selected.png` });
    await axe(page, "phone graph + sheet (dark)", found);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.evaluate(() => window.scrollTo(0, 0)); // the fixed bottom bar can cover part of a tall graph while scrolled; that is not a defect
    await axe(page, "phone graph (light)", found);
    await page.getByRole("button", { name: "Timeline" }).click();
    await axe(page, "phone agenda (light)", found);
    expect(found.join("\n"), "axe violations").toBe("");
  } finally {
    for (const url of created.splice(0).reverse()) await page.request.delete(url, { headers: { "x-sbos": "1" } }).catch(() => undefined);
  }
});
