import { expect, test } from "@playwright/test";
import { login, seedDesignData } from "./seed";

test("plan: week view shows the seeded tasks, the inspector shows dependencies, timeline and graph render", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const seed = await seedDesignData(page);
  try {
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
    const week = page.getByRole("list", { name: "Days of the week" });
    await expect(week).toBeVisible();
    await expect(page.getByText("Finish the ProAnima entity-relationship diagram").first()).toBeVisible();

    // selecting a task opens the inspector with its place in the dependency chain
    await page.getByText("Write SQL for adoption tables").first().click();
    const inspector = page.getByRole("complementary", { name: "Write SQL for adoption tables" });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("heading", { name: "Depends on" })).toBeVisible();

    await page.getByRole("link", { name: "Timeline" }).click();
    await expect(page).toHaveURL(/view=timeline/);
    await expect(page.getByRole("region", { name: /Workflow timeline/ })).toBeVisible();

    await page.getByRole("link", { name: "Graph" }).click();
    await expect(page).toHaveURL(/view=graph/);
    await expect(page.getByRole("group", { name: "Show in graph" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();

    // the old addresses still land on the new page
    await page.goto("/workflow");
    await expect(page).toHaveURL(/\/plan\?view=timeline/);
    await page.goto("/pipeline");
    await expect(page).toHaveURL(/\/plan$/);
  } finally {
    await seed.cleanup();
  }
});
