import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e-test-password-123";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
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
  await expect(page.locator("ul li")).toHaveCount(1);
});

test("projects: create, add task, link note, briefing", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill("E2E Garden");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("link", { name: /E2E Garden/ }).click();
  await page.getByLabel("New task title").fill("Water seedlings");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Water seedlings", { exact: true })).toBeVisible();
  await page.getByLabel("Note to link").selectOption({ label: "E2E tomato garden" });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByRole("link", { name: "E2E tomato garden" })).toBeVisible();
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
