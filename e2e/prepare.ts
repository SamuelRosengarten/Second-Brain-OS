// Creates a fresh scratch data dir with a known test password before the e2e app server starts.
import fs from "node:fs";

const dir = process.env.SBOS_DATA_DIR;
if (!dir || !/sbos-e2e/.test(dir)) throw new Error("Refusing to run: SBOS_DATA_DIR must be an sbos-e2e scratch directory");
fs.rmSync(dir, { recursive: true, force: true });
const { setPassword } = await import("../src/lib/auth.ts");
const { closeDb } = await import("../src/lib/db.ts");
setPassword(process.env.E2E_PASSWORD ?? "e2e-test-password-123");
closeDb();
console.log("e2e data prepared");
