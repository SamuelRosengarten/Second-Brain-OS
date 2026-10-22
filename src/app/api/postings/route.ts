import { route } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listPostings, listSaved } from "@/lib/scout";
import { getSchedule, nextRun } from "@/lib/scout-schedule";

export const dynamic = "force-dynamic";
// draftTo is YOUR own address (env), so email drafts can only ever be addressed to you.
export const GET = route({}, () => {
  const schedule = getSchedule();
  return {
    postings: listPostings(),
    saved: listSaved(),
    schedule,
    nextRun: nextRun(schedule)?.toISOString() ?? null,
    draftTo: process.env.SBOS_DRAFT_TO?.trim() || null,
    runs: getDb().prepare("SELECT id, status, found, added, usage_json, notes, error, started_at, finished_at FROM scout_runs ORDER BY started_at DESC LIMIT 5").all(),
  };
});
