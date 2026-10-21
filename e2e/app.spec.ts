import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e-test-password-123";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Quick capture")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("signed-out visitors are sent to login and a wrong password is rejected", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect password")).toBeVisible();
});

test("capture -> AI proposal -> note -> search -> task", async ({ page }) => {
  await login(page);

  // capture (saved before AI), then process
  await page.goto("/capture");
  await page.getByLabel("Capture content").fill("Build a raised-bed tomato garden and buy cedar boards for it");
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Save capture" }).click();
  await page.getByRole("link", { name: /Open in inbox/ }).click();
  await expect(page.getByText("Your capture")).toBeVisible();
  await page.getByRole("button", { name: "Process with local AI" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("E2E tomato garden");

  // accept with a task
  await page.getByLabel("Also create a task from this action").check();
  await page.getByRole("button", { name: "Save as note" }).click();
  await expect(page).toHaveURL(/\/knowledge\/.+/);
  await expect(page.getByRole("heading", { name: "E2E tomato garden" })).toBeVisible();
  await expect(page.getByText(/vault\/e2e-tomato-garden/)).toBeVisible();

  // keyword search finds it and shows where it came from
  await page.goto("/knowledge");
  await page.getByLabel("Search your library").fill("cedar");
  await expect(page.getByText("E2E tomato garden").first()).toBeVisible();
  await expect(page.getByText(/\.md$/).first()).toBeVisible();

  // task created from the suggested action
  await page.goto("/tasks");
  await expect(page.getByText("Buy cedar boards")).toBeVisible();
  await page.getByRole("button", { name: "Complete Buy cedar boards" }).click();
  await page.getByLabel("Status filter").selectOption("done");
  await expect(page.getByText("Buy cedar boards")).toBeVisible();
});

test("duplicate captures are not stored twice", async ({ page }) => {
  await login(page);
  for (let i = 0; i < 2; i++) {
    await page.goto("/capture");
    await page.getByLabel("Capture content").fill("Exactly the same thought");
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "Save capture" }).click();
    await expect(page.getByRole("link", { name: /Open in inbox/ })).toBeVisible();
  }
  await page.goto("/inbox");
  await page.getByLabel("Search inbox").fill("Exactly the same thought");
  await expect(page.locator("main ul li")).toHaveCount(1);
});

test("projects: create, add task, link note, briefing", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill("E2E Garden");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.locator("main").getByRole("link", { name: /E2E Garden/ }).click();
  await page.getByLabel("New task title").fill("Water seedlings");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Water seedlings", { exact: true })).toBeVisible();
  await page.getByLabel("Note to link").selectOption({ label: "E2E tomato garden" });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.locator("main").getByRole("link", { name: "E2E tomato garden" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Calendar events are not shown: no calendar is connected.")).toBeVisible();
});

test("AI workspace: new conversation does not crash; grounded answer cites the note; refusal path works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.goto("/ai");
  // regression: clicking this once crashed the whole page
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByText("Ask anything")).toBeVisible();

  await page.getByLabel("Message").fill("What should I buy for the garden?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Based on your notes, buy cedar boards [1].")).toBeVisible();
  await expect(page.getByText("Uses your library")).toBeVisible();
  await page.getByText(/Used \d+ library passage/).click();
  await expect(page.getByRole("link", { name: /\[1\] E2E tomato garden/ })).toBeVisible();

  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByLabel("Answer from my library").uncheck();
  await page.getByLabel("Message").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Plain local reply.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Claude handoff builds a reviewable package locally", async ({ page }) => {
  await login(page);
  await page.goto("/ai");
  await page.getByRole("tab", { name: "Claude handoff" }).click();
  await page.getByLabel("E2E tomato garden").check();
  await page.getByLabel("Your question").fill("What next?");
  await page.getByRole("button", { name: "Build package" }).click();
  await expect(page.getByLabel("Context package preview")).toHaveValue(/cedar boards[\s\S]*What next\?/);
});

test("settings, automations and backup work; sign out ends the session", async ({ page }) => {
  await login(page);
  await page.goto("/automations");
  await page.getByRole("button", { name: "Run now" }).nth(1).click(); // build semantic index (fake embedder)
  await expect(page.getByText(/Embedded \d+ chunk/)).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Create backup" }).click();
  await expect(page.getByText(/Backup created/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login$/);
});

test("command palette: Ctrl+K opens, filters, navigates with the keyboard and closes with Escape", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Search commands and notes" });
  await expect(input).toBeFocused();
  await input.fill("tasks");
  await expect(page.getByRole("option", { name: /Tasks/ }).first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tasks$/);
  await page.keyboard.press("Control+k");
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
  // live note results come from the real library
  await page.keyboard.press("Control+k");
  await input.fill("tomato");
  await expect(page.getByRole("option", { name: /E2E tomato garden/ })).toBeVisible();
  await page.getByRole("option", { name: /E2E tomato garden/ }).click();
  await expect(page).toHaveURL(/\/knowledge\/.+/);
});

test("note editor: write, safe Markdown preview, save, and rendered view", async ({ page }) => {
  await login(page);
  await page.goto("/knowledge?new=1");
  await page.getByLabel("Title").fill("Editor test note");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/.+/);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Note body (Markdown)").fill(["## Plan", "", "- **bold item**", "- [bad](javascript:alert(1))", "", "<script>window.__pwned = 1</script>"].join(String.fromCharCode(10)));
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".md strong")).toHaveText("bold item");
  await expect(page.locator('.md a[href^="javascript"]')).toHaveCount(0);
  await expect(page.getByText("<script>window.__pwned = 1</script>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Note saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(page.locator(".md h2")).toHaveText("Plan");
});

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("tasks: edit, move to tomorrow with undo, delete with undo", async ({ page }) => {
  await login(page);
  await page.goto("/tasks");
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));
  await page.getByLabel("New task title").fill("Edit me");
  await page.getByLabel("Due date").fill(today);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const row = page.locator("main li").filter({ hasText: "Edit me" });
  await expect(row.getByText("Today", { exact: true })).toBeVisible();

  // snooze, then undo
  await row.getByRole("button", { name: "Move Edit me to tomorrow" }).click();
  await expect(row.getByText(tomorrow)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByText("Today", { exact: true })).toBeVisible();

  // edit every field that matters
  await row.getByRole("button", { name: "Edit me", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit task" });
  await dialog.getByLabel("Title").fill("Edited task");
  await dialog.getByLabel("Notes").fill("details here");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByRole("button", { name: "Tomorrow" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const edited = page.locator("main li").filter({ hasText: "Edited task" });
  await expect(edited.getByText("details here")).toBeVisible();
  await expect(edited.getByText(tomorrow)).toBeVisible();
  await expect(edited.getByText("High", { exact: true }).first()).toBeVisible();

  // delete, then undo: the task comes back with the same fields
  await edited.getByRole("button", { name: "Delete Edited task" }).click();
  await expect(page.locator("main li").filter({ hasText: "Edited task" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  const restored = page.locator("main li").filter({ hasText: "Edited task" });
  await expect(restored.getByText(tomorrow)).toBeVisible();
  await expect(restored.getByText("details here")).toBeVisible();

  // clean up (no undo this time)
  await restored.getByRole("button", { name: "Delete Edited task" }).click();
  await expect(page.locator("main li").filter({ hasText: "Edited task" })).toHaveCount(0);
});

// Two zones a day apart from each other, so at least one differs from the server's calendar date at any hour.
for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
  test.describe(`device in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test("Home and Tasks use the device's own 'today'", async ({ page }) => {
      await login(page);
      await page.goto("/tasks");
      const deviceToday = await page.evaluate(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      });
      await page.getByLabel("New task title").fill(`Due on the device today ${timezoneId}`);
      await page.getByLabel("Due date").fill(deviceToday);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const row = page.locator("main li").filter({ hasText: `Due on the device today ${timezoneId}` });
      await expect(row.getByText("Today", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Today · 1$/ })).toBeVisible();

      await page.goto("/");
      await expect(page.getByText(/\b1 due today/)).toBeVisible();
      await expect(page.getByText(/\b0 overdue/)).toBeVisible();

      await page.goto("/tasks");
      await page.locator("main li").filter({ hasText: `Due on the device today ${timezoneId}` }).getByRole("button", { name: /^Delete / }).click();
    });
  });
}

test("installable on a home screen: manifest and icons are public and valid", async ({ request, page }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ display: "standalone", start_url: "/", name: "Second Brain OS" });
  for (const icon of m.icons as { src: string; type: string }[]) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain(icon.type);
  }
  expect((await request.get("/apple-touch-icon.png")).ok()).toBe(true);
  await page.goto("/login");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Second Brain");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});
