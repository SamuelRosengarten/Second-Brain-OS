import { expect, test } from "@playwright/test";

// A phone-sized window: the sync pill lives in the phone header.
test.use({ viewport: { width: 390, height: 844 } });

test("a capture made while the server is unreachable waits on the device, shows a pill, and is sent when it is back", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/capture");
  await page.getByLabel("What is on your mind?").fill("offline capture e2e");
  await page.getByText("Let my local AI tidy it up").click(); // off: no model needed

  // the server "goes away" for captures only, so the rest of the app keeps working
  await page.route("**/api/captures", (route) => route.abort("connectionrefused"));
  await page.getByRole("button", { name: "Save to inbox" }).click();
  await expect(page).toHaveURL(/\/$/);
  const pill = page.getByRole("button", { name: /1 capture waiting to sync/ });
  await expect(pill).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sbos.capture-queue") ?? "[]").length)).toBe(1);

  // still down: tapping the pill retries and the capture stays queued
  await pill.click();
  await expect(pill).toBeVisible();

  // back online: the pill sends it and disappears
  await page.unroute("**/api/captures");
  await pill.click();
  await expect(pill).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sbos.capture-queue") ?? "[]").length)).toBe(0);
  await expect.poll(async () => JSON.stringify(await (await page.request.get("/api/captures")).json())).toContain("offline capture e2e");
});
