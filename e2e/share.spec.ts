import { expect, test } from "@playwright/test";

test("web share target: the manifest declares it and /capture opens prefilled from ?title&text&url", async ({ page, request }) => {
  const manifest = (await (await request.get("/manifest.webmanifest")).json()) as { share_target?: { action: string; method: string; params: Record<string, string> } };
  expect(manifest.share_target).toEqual({ action: "/capture", method: "GET", params: { title: "title", text: "text", url: "url" } });

  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  // a page shared from Chrome on Android: title + the link in `text`
  await page.goto("/capture?title=Great%20article&text=https%3A%2F%2Fexample.com%2Fa");
  await expect(page.getByLabel("Web link (optional)")).toHaveValue("https://example.com/a");
  await expect(page.getByLabel("Capture content")).toHaveValue("Great article");

  // shared text with its own link
  await page.goto("/capture?text=Remember%20this&url=https%3A%2F%2Fexample.com%2Fb");
  await expect(page.getByLabel("Capture content")).toHaveValue("Remember this");
  await expect(page.getByLabel("Web link (optional)")).toHaveValue("https://example.com/b");
});
