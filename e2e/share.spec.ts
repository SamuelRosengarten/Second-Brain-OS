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
  await expect(page.getByLabel("What is on your mind?")).toHaveValue("Great article");
  await expect(page.getByText("https://example.com/a")).toBeVisible();

  // shared text with its own link
  await page.goto("/capture?text=Remember%20this&url=https%3A%2F%2Fexample.com%2Fb");
  await expect(page.getByLabel("What is on your mind?")).toHaveValue("Remember this");
  await expect(page.getByText("https://example.com/b")).toBeVisible();

  // a lone link opens as a link capture
  await page.goto("/capture?url=https%3A%2F%2Fexample.com%2Fc");
  await expect(page.getByLabel("Paste a link")).toHaveValue("https://example.com/c");
});
