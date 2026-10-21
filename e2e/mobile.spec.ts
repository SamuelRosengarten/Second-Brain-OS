import { expect, test } from "@playwright/test";

test("phone layout: bottom navigation, no horizontal scroll, capture works", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  const nav = page.getByRole("navigation", { name: "Mobile" });
  await expect(nav).toBeVisible();
  for (const label of ["Home", "Capture", "Search", "Inbox", "More"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

  for (const path of ["/", "/capture", "/inbox", "/knowledge", "/projects", "/tasks", "/ai", "/settings", "/more"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }

  await nav.getByRole("link", { name: "Capture" }).click();
  await page.getByLabel("Capture content").fill("phone capture test");
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Save capture" }).click();
  await expect(page.getByRole("link", { name: /Open in inbox/ })).toBeVisible();
});
