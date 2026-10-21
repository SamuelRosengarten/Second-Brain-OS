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

const created: string[] = [];
async function post(page: Page, url: string, data: unknown): Promise<Record<string, any>> {
  const r = (await (await page.request.post(url, { headers: { "x-sbos": "1" }, data })).json()) as Record<string, any>;
  const item = r.project ?? r.task;
  if (item?.id) created.push(`${url}/${item.id}`);
  return r;
}

test("pipeline: lanes, markers by due date, horizon columns, opening a task, themes and phone", async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  try {
    const cc = (await post(page, "/api/projects", { name: "Code Coach", goals: "Learn from mistakes", target_date: inDays(40) })).project;
    const li = (await post(page, "/api/projects", { name: "LinkedIn Profile", goals: "Finish the profile" })).project;
    const pf = (await post(page, "/api/projects", { name: "Portfolio" })).project;
    const mk = (title: string, project: string | null, due: string | null, extra: Record<string, unknown> = {}) => post(page, "/api/tasks", { title, project_id: project, due_date: due, ...extra });
    await mk("Fix the overdue bug", cc.id, inDays(-4), { priority: "high" });
    await mk("Data persistence across restarts", cc.id, inDays(2), { status: "doing", priority: "high" });
    await mk("Match dashboard visuals to the theme", cc.id, inDays(9));
    await mk("End-of-session summary", cc.id, inDays(9));
    await mk("Security review", cc.id, inDays(21), { priority: "high" });
    await mk("Export progress report", cc.id, inDays(60), { priority: "low" });
    await mk("Audit the profile", li.id, inDays(-6), { status: "done" });
    await mk("Update headline and About", li.id, inDays(1), { priority: "high" });
    await mk("Add featured projects", li.id, inDays(5));
    await mk("Make the first 20 connections", li.id, inDays(14));
    await mk("Ask two teachers for a recommendation", li.id, null);
    await mk("Redeploy the site", pf.id, inDays(3), { status: "doing" });
    await mk("Replace placeholder photos", pf.id, inDays(12), { priority: "low" });
    await mk("Buy a domain name", null, inDays(30));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pipeline");
    await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
    // summary + one lane per project (plus the "No project" lane)
    await expect(page.getByRole("list", { name: "Pipeline summary" })).toBeVisible();
    for (const name of ["Code Coach", "LinkedIn Profile", "Portfolio", "No project"]) await expect(page.getByRole("group", { name: new RegExp(`^${name}:`) })).toBeVisible();
    // the overdue bug is flagged and a task with a title can be found by its full description
    const overdue = page.getByRole("button", { name: /Fix the overdue bug, overdue, due .*, high priority/i });
    await expect(overdue).toBeVisible();
    await expect(page.getByRole("group", { name: /^Code Coach: Behind/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Audit the profile, done/i })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pipeline-timeline-dark.png` });

    // opening a marker opens the normal edit dialog; Escape closes it again
    await overdue.click();
    await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Fix the overdue bug");
    await page.keyboard.press("Escape");

    // time range + project filter
    await page.getByLabel("Time range").selectOption("14");
    await page.getByLabel("Project filter").selectOption({ label: "Portfolio" });
    await expect(page.getByRole("group", { name: /^Code Coach:/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Redeploy the site/ })).toBeVisible();
    await page.getByLabel("Project filter").selectOption("");
    await page.getByLabel("Time range").selectOption("90");
    await expect(page.getByRole("button", { name: /Export progress report/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pipeline-timeline-3months.png` });

    // horizon view
    await page.getByRole("tab", { name: "By due date" }).click();
    for (const col of ["Overdue", "Today", "Next 7 days", "Next 30 days", "Later", "No date"]) await expect(page.getByRole("region", { name: /Tasks grouped/ }).getByRole("heading", { name: col })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Overdue, \d+ tasks/ }).getByText("Fix the overdue bug")).toBeVisible();
    await expect(page.getByRole("region", { name: /^No date, \d+ tasks/ }).getByText("Ask two teachers")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pipeline-horizon-dark.png` });

    // light theme (the data-theme attribute overrides the emulated dark scheme)
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.screenshot({ path: `${SHOTS}/pipeline-horizon-light.png` });
    await page.getByRole("tab", { name: "Timeline" }).click();
    await page.getByLabel("Time range").selectOption("42");
    await page.screenshot({ path: `${SHOTS}/pipeline-timeline-light.png` });

    // phone: no page-level horizontal overflow, both views usable
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pipeline");
    await page.waitForLoadState("networkidle");
    for (const tab of ["By due date", "Timeline"]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow in ${tab}`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/pipeline-phone-${tab === "Timeline" ? "timeline" : "horizon"}.png` });
    }
  } finally {
    for (const url of created.splice(0).reverse()) await page.request.delete(url, { headers: { "x-sbos": "1" } }).catch(() => undefined);
    await page.request.delete("/api/tasks/none", { headers: { "x-sbos": "1" } }).catch(() => undefined);
  }
});
