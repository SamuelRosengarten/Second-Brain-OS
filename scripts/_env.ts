import fs from "node:fs";

/** CLI scripts do not run inside Next, so load .env.local ourselves (existing environment variables win). */
export function loadEnv(): void {
  for (const f of [".env.local", ".env"]) {
    if (fs.existsSync(f)) {
      try {
        process.loadEnvFile(f);
      } catch {
        // malformed env file: ignore, defaults apply
      }
    }
  }
}
