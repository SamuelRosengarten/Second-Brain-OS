import { loadEnv } from "./_env.ts";
loadEnv();
const { runScout } = await import("../src/lib/scout.ts");
const { closeDb } = await import("../src/lib/db.ts");

// Usage: npm run scout
// Starts one session of your Managed Agent (cloud), stores new postings in the local database. Sends nothing to anyone.
try {
  const r = await runScout();
  console.log(`Found ${r.found}, added ${r.added} new${r.skipped ? `, ${r.skipped} unusable` : ""}.`);
  if (r.notes) console.log(r.notes);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  closeDb();
}
