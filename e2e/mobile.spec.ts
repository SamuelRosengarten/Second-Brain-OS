import { expect, test } from "@playwright/test";

test("phone layout: bottom navigation, no horizontal scroll, capture works", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  const nav = page.getByRole("navigation", { name: "Mobile" });
  await expect(nav).toBeVisible();
  for (const label of ["Today", "Postings", "Notes", "Plan", "Ask"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

  for (const path of ["/", "/capture", "/inbox", "/postings", "/knowledge", "/projects", "/plan", "/plan?view=timeline", "/plan?view=graph", "/tasks", "/ai", "/settings", "/automations"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }

  await page.goto("/");
  await page.getByRole("link", { name: /Capture a thought, task or link/ }).click();
  await expect(page).toHaveURL(/\/capture$/);
  await expect(nav).toBeHidden(); // the capture screen is full height, without the tab bar
  await page.getByLabel("What is on your mind?").fill("phone capture test");
  await page.getByText("Let my local AI tidy it up").click();
  await expect(page.getByRole("switch")).not.toBeChecked();
  await page.getByRole("button", { name: "Save to inbox" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("phone: an overdue task keeps its title readable and the edit dialog keeps Save in view without raising the keyboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();

  const title = "Call the dentist about the appointment next week";
  const created = await page.request.post("/api/tasks", {
    headers: { "x-sbos": "1" },
    data: { title, priority: "high", due_date: "2020-01-02" },
  });
  const { task } = (await created.json()) as { task: { id: string } };
  try {
    await page.goto("/tasks");
    const row = page.locator("main li").filter({ hasText: title });
    const titleButton = row.getByRole("button", { name: title, exact: true });
    await expect(titleButton).toBeVisible();
    expect((await titleButton.boundingBox())!.width).toBeGreaterThan(150);
    // every action stays inside the screen
    const viewport = page.viewportSize()!;
    for (const name of [`Move ${title} to tomorrow`, `Start ${title}`, `Delete ${title}`]) {
      const box = (await row.getByRole("button", { name }).boundingBox())!;
      expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width);
    }

    await titleButton.click();
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel("Title")).not.toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await page.request.delete(`/api/tasks/${task.id}`, { headers: { "x-sbos": "1" } });
  }
});
