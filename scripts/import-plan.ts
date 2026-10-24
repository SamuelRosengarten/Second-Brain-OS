import fs from "node:fs";
import { loadEnv } from "./_env.ts";
loadEnv();
const { parsePlan, replaceWithPlan } = await import("../src/lib/plan-import.ts");
const { createBackup } = await import("../src/lib/backup.ts");
const { closeDb } = await import("../src/lib/db.ts");

// Usage: npm run import-plan -- <plan.md> [--name Synapse-OS] [--yes]
// Deletes ALL projects and tasks, then imports the plan into one new project. Without --yes it only shows what it would do.
const args = process.argv.slice(2);
const nameAt = args.indexOf("--name");
const name = nameAt >= 0 ? args[nameAt + 1] : "Synapse-OS";
const file = args.find((a, i) => !a.startsWith("--") && i !== (nameAt >= 0 ? nameAt + 1 : -1));
if (!file) {
  console.error("Usage: npm run import-plan -- <plan.md> [--name Synapse-OS] [--yes]");
  process.exit(1);
}
const plan = parsePlan(fs.readFileSync(file, "utf8"));
console.log(`Parsed ${plan.length} tasks, ${plan[0].start} to ${plan.map((t) => t.due).sort().at(-1)}.`);
if (!args.includes("--yes")) {
  console.log(`Dry run. Re-run with --yes to back up, delete every project and task, and create "${name}".`);
  process.exit(0);
}
const backup = await createBackup();
console.log(`Backup written: ${backup.dir}`);
const r = replaceWithPlan(name, plan);
console.log(`Removed ${r.removedProjects} projects and ${r.removedTasks} tasks; created "${name}" with ${r.tasks.length} tasks.`);
closeDb();
