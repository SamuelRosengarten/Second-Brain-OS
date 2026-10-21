import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { login, seedDesignData } from "./seed";

const SHOTS = "test-results/shots";

test("redesign: every screen, desktop and phone, dark", async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  const seed = await seedDesignData(page);
  try {
    // ---------- desktop ----------
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)\.|Working late\./ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^New capture/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Focus" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-today.png` });

    await page.goto("/capture");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-capture.png` });

    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
    await expect(page.getByText(/REVIEW 1 OF 3/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-inbox.png` });

    await page.goto(`/knowledge/${seed.ids.n1}`);
    await expect(page.getByRole("heading", { name: "Weekly planning ritual", level: 1 })).toBeVisible();
    await expect(page.getByText("Linked from")).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-notes.png` });

    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /^Finish the ProAnima entity-relationship diagram/ }).first().click();
    await expect(page.getByText("Selected task")).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-plan-week.png` });
    await page.goto("/plan?view=timeline");
    await expect(page.getByRole("region", { name: "Timeline", exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-plan-timeline.png` });
    await page.goto("/plan?view=graph");
    await expect(page.getByRole("button", { name: /^Task: Finish the ProAnima/ })).toBeVisible();
    await page.getByRole("button", { name: /^Task: Finish the ProAnima/ }).click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-plan-graph.png` });

    await page.goto("/ai");
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    await page.getByLabel("Message").fill("Where does adoption status live in the ER model?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Based on your notes, buy cedar boards")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Save as note" })).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/rd-desktop-ask.png` });

    // ---------- phone ----------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Focus" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-phone-today.png` });
    await page.goto("/capture");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/rd-phone-capture.png` });
    await page.goto("/inbox/review");
    await expect(page.getByText("1 OF 3")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/rd-phone-review.png` });
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/rd-phone-inbox.png` });
    await page.goto("/knowledge");
    await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/rd-phone-notes.png` });
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Days" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-phone-plan.png` });
    await page.goto("/plan?view=graph");
    await expect(page.getByRole("button", { name: /^Task: Finish the ProAnima/ })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/rd-phone-plan-graph.png` });
    await page.goto(`/knowledge/${seed.ids.n1}`);
    await expect(page.getByRole("heading", { name: "Weekly planning ritual", level: 1 })).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/rd-phone-note.png`, fullPage: true });
    await page.goto("/ai");
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    await page.getByLabel("Message").fill("Where does adoption status live in the ER model?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Based on your notes, buy cedar boards")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/rd-phone-ask.png` });
  } finally {
    await seed.cleanup();
  }
});
