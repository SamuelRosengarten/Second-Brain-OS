import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { processAllPending } from "@/lib/captures";
import { getDb } from "@/lib/db";
import { reindexVault } from "@/lib/notes";
import { runScout } from "@/lib/scout";
import { embedPending } from "@/lib/search";
import { newId, nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const GET = route({}, () => ({ runs: getDb().prepare("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 30").all() }));

/** Fixed, narrowly scoped jobs. No model-supplied arguments or commands are ever executed. */
const JOBS = {
  "process-pending": async () => {
    const r = await processAllPending();
    return { detail: `Processed ${r.processed} capture(s), ${r.failed} failed.`, failed: r.failed > 0 && r.failed === r.processed };
  },
  "reindex-vault": async () => {
    const r = reindexVault();
    return { detail: `Scanned ${r.scanned}: ${r.added} added, ${r.updated} updated, ${r.removed} removed${r.errors.length ? `, ${r.errors.length} error(s)` : ""}.`, failed: false };
  },
  "build-embeddings": async () => {
    const r = await embedPending(2000);
    return { detail: r.error ? `Embedded ${r.embedded}. ${r.error} ${r.hint ?? ""}` : `Embedded ${r.embedded} chunk(s).`, failed: !!r.error };
  },
  "run-scout": async () => {
    const r = await runScout();
    return { detail: `Found ${r.found}, added ${r.added} new${r.skipped ? `, ${r.skipped} unusable` : ""}. ${r.notes}`.slice(0, 300), failed: false };
  },
} as const;

export const POST = route({ body: z.object({ job: z.enum(["process-pending", "reindex-vault", "build-embeddings", "run-scout"]) }) }, async ({ body }) => {
  const db = getDb();
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  if (db.prepare("SELECT 1 FROM job_runs WHERE job = ? AND status = 'running' AND started_at > ?").get(body.job, since)) {
    throw new ApiError(409, "This job is already running.", "busy");
  }
  const id = newId();
  db.prepare("INSERT INTO job_runs (id, job, status, started_at) VALUES (?, ?, 'running', ?)").run(id, body.job, nowIso());
  try {
    const r = await JOBS[body.job]();
    db.prepare("UPDATE job_runs SET status = ?, detail = ?, finished_at = ? WHERE id = ?").run(r.failed ? "error" : "ok", r.detail, nowIso(), id);
  } catch (e) {
    db.prepare("UPDATE job_runs SET status = 'error', detail = ?, finished_at = ? WHERE id = ?").run(e instanceof Error ? e.message.slice(0, 300) : "failed", nowIso(), id);
  }
  return { run: db.prepare("SELECT * FROM job_runs WHERE id = ?").get(id) };
});
