import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Runs against a production build (`npm run build` first), a scratch data dir and a fake Ollama.
// Uses the installed Google Chrome (no browser download). Your real data is never touched.
const dataDir = path.join(os.tmpdir(), "sbos-e2e-data");
const env = {
  SBOS_DATA_DIR: dataDir,
  SBOS_SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234567890",
  SBOS_SECURE_COOKIES: "0",
  SBOS_ALLOWED_ORIGINS: "",
  OLLAMA_URL: "http://127.0.0.1:11500",
  FAKE_OLLAMA_PORT: "11500",
  SBOS_CHAT_MODEL: "fake-chat",
  SBOS_EMBED_MODEL: "fake-embed",
  E2E_PASSWORD: "e2e-test-password-123",
};

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", channel: "chrome", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" }, testIgnore: /mobile\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" }, testMatch: /(mobile|a11y)\.spec\.ts/ },
  ],
  webServer: [
    { command: "node e2e/fake-ollama.mjs", url: "http://127.0.0.1:11500/api/tags", env, reuseExistingServer: false },
    {
      command: "node --experimental-strip-types e2e/prepare.ts && npx next start -H 127.0.0.1 -p 3100",
      url: "http://127.0.0.1:3100/api/health",
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
