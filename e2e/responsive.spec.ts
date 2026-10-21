import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const WIDTHS = [375, 390, 430, 768, 1024, 1440];
const PAGES = ["/", "/inbox", "/capture", "/knowledge", "/projects", "/tasks", "/ai", "/automations", "/settings", "/more"];
const SHOTS = path.join("test-results", "shots");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Quick capture")).toBeVisible();
}

test("every page fits every common viewport width (no horizontal overflow) and screenshots are saved", async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await login(page);
  const problems: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    for (const p of PAGES) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) problems.push(`${p} @${width}px overflows by ${overflow}px`);
      if (["/", "/inbox", "/knowledge", "/tasks", "/ai"].includes(p) && [375, 768, 1440].includes(width)) {
        await page.screenshot({ path: path.join(SHOTS, `${p === "/" ? "home" : p.slice(1)}-${width}.png`) });
      }
    }
  }
  expect(problems).toEqual([]);
});

test("phone: tap targets are comfortable, the capture action is reachable, and dialogs fit the screen", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 375, height: 667 });
  for (const p of ["/capture", "/tasks", "/inbox", "/knowledge"]) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button, [role=tab], nav a")]
        .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest("dialog") && !el.closest("[hidden]"))
        .map((el) => ({ el: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), r: (el as HTMLElement).getBoundingClientRect() }))
        .filter((x) => x.r.height < 30 || x.r.width < 30)
        .map((x) => `${x.el} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
    );
    expect(small, `small tap targets on ${p}`).toEqual([]);
  }
  // the big center Capture action sits inside the bottom nav, within thumb reach
  const nav = page.getByRole("navigation", { name: "Mobile" });
  const box = await nav.getByRole("link", { name: "Capture" }).boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  expect(box!.y).toBeGreaterThan(667 - 120);
  // dialog fits within the viewport and scrolls internally
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "New note" }).first().click();
  const dlg = await page.getByRole("dialog", { name: "New note" }).boundingBox();
  expect(dlg!.width).toBeLessThanOrEqual(375);
  expect(dlg!.y + dlg!.height).toBeLessThanOrEqual(667);
});

test("keyboard: skip link, visible focus ring, and palette opens from the sidebar search button", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tasks");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByRole("combobox", { name: "Search commands and notes" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open command palette" })).toBeFocused();
});
