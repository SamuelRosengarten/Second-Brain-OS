import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Automated WCAG 2.2 A/AA scan (axe-core) of every page, in both themes, on desktop and phone.
// It catches roughly a third of real-world issues (contrast, names, roles, landmarks, tap-target size);
// keyboard order and screen-reader wording still need a manual pass.
const PASSWORD = "e2e-test-password-123";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Findings are collected across all pages so one run shows everything, then asserted once at the end.
async function scan(page: Page, label: string, found: string[]) {
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of r.violations) {
    const nodes = v.nodes.slice(0, 3).map((n) => `      ${n.target.join(" ")}  ${(n.failureSummary ?? "").split("\n")[1] ?? ""}`).join("\n");
    found.push(`${label}: ${v.id} (${v.impact}) ${v.help} [${v.nodes.length}]\n${nodes}`);
  }
}

// The e2e data dir is shared by every spec, so everything seeded here is deleted again afterwards (other specs count tasks and overdue items).
const created: string[] = [];

async function seed(page: Page): Promise<{ note: string; project: string; capture: string }> {
  const post = async (url: string, data: unknown) => {
    const r = (await (await page.request.post(url, { headers: { "x-sbos": "1" }, data })).json()) as Record<string, any>;
    const item = r.note ?? r.project ?? r.task ?? r.capture;
    if (item?.id) created.push(`${url}/${item.id}`);
    return r;
  };
  const note = await post("/api/notes", { title: "A11y sample note", body: "## Heading\n\nSome **bold** text, a [link](https://example.com) and a list:\n\n- one\n- two\n", tags: ["sample"], summary: "Sample" });
  const project = await post("/api/projects", { name: "A11y sample project", goals: "Check accessibility" });
  await post("/api/tasks", { title: "Overdue sample task", priority: "high", due_date: "2020-01-02", project_id: project.project?.id });
  await post("/api/tasks", { title: "Plain sample task", priority: "low" });
  const capture = await post("/api/captures", { content: "A11y sample capture about a garden", process: false });
  return { note: note.note.id, project: project.project.id, capture: capture.capture.id };
}

for (const theme of ["dark", "light"] as const) {
  test(`accessibility scan, ${theme} theme`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const found: string[] = [];
    try {
    await page.addInitScript((t) => localStorage.setItem("sbos-theme", t), theme);

    await page.goto("/login");
    await scan(page, `/login (${theme})`, found);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Quick capture").or(page.getByRole("navigation", { name: "Mobile" })).first()).toBeVisible();

    const ids = await seed(page);
    const paths = ["/", "/capture", "/capture?title=Shared&text=https://example.com/x", "/inbox", `/inbox/${ids.capture}`, "/knowledge", `/knowledge/${ids.note}`,
      "/projects", `/projects/${ids.project}`, "/tasks", "/ai", "/search?q=sample", "/settings", "/automations", "/more"];
    for (const p of paths) {
      await page.goto(p);
      await scan(page, `${p} (${theme})`, found);
    }

    // transient UI: task edit dialog and the command palette
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Plain sample task", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, `task dialog (${theme})`, found);
    await page.keyboard.press("Escape");
    await page.goto("/");
    await page.keyboard.press("Control+k");
    if (await page.getByRole("dialog").isVisible().catch(() => false)) await scan(page, `command palette (${theme})`, found);
    } finally {
      for (const url of created.splice(0).reverse()) await page.request.delete(url, { headers: { "x-sbos": "1" } }).catch(() => undefined);
      if (process.env.A11Y_REPORT) fs.appendFileSync(process.env.A11Y_REPORT, `##### ${info.project.name} ${theme}\n${found.join("\n")}\n`);
    }
    expect(found.join("\n"), "axe violations").toBe("");
  });
}
