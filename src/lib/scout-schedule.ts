import { z } from "zod";
import { getDb } from "./db.ts";
import { runScout } from "./scout.ts";
import { log, newId, nowIso } from "./util.ts";

export interface Schedule { enabled: boolean; times: string[]; days: number[]; last_fired: string | null }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ScheduleInput = z.object({
  enabled: z.boolean(),
  times: z.array(z.string().regex(HHMM)).min(1).max(6),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
}).strict();

export function getSchedule(): Schedule {
  const r = getDb().prepare("SELECT enabled, times, days, last_fired FROM scout_schedule WHERE id = 1").get() as { enabled: number; times: string; days: string; last_fired: string | null };
  return { enabled: !!r.enabled, times: JSON.parse(r.times), days: JSON.parse(r.days), last_fired: r.last_fired };
}

export function saveSchedule(input: z.infer<typeof ScheduleInput>): Schedule {
  const times = [...new Set(input.times)].sort();
  const days = [...new Set(input.days)].sort();
  getDb().prepare("UPDATE scout_schedule SET enabled = ?, times = ?, days = ? WHERE id = 1").run(input.enabled ? 1 : 0, JSON.stringify(times), JSON.stringify(days));
  return getSchedule();
}

// All times are this PC's local time. A slot key sorts chronologically as a string.
const pad = (n: number) => String(n).padStart(2, "0");
const slotKey = (d: Date, t: string) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${t}`;
const slotDate = (d: Date, t: string) => {
  const [h, m] = t.split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
};

/** A slot that was missed (PC asleep, app restarted) still runs if it is less than this old. */
export const GRACE_MS = 15 * 60_000;

/** The latest slot that is due right now and has not run yet, or null. */
export function dueSlot(s: Schedule, now = new Date()): string | null {
  if (!s.enabled || !s.days.includes(now.getDay())) return null;
  const due = s.times
    .filter((t) => {
      const age = now.getTime() - slotDate(now, t).getTime();
      return age >= 0 && age < GRACE_MS;
    })
    .map((t) => slotKey(now, t))
    .filter((key) => !s.last_fired || key > s.last_fired)
    .sort();
  return due.length ? due[due.length - 1] : null;
}

export function nextRun(s: Schedule, now = new Date()): Date | null {
  if (!s.enabled) return null;
  for (let i = 0; i < 8; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!s.days.includes(day.getDay())) continue;
    const upcoming = s.times.map((t) => slotDate(day, t)).filter((d) => d.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime());
    if (upcoming.length) return upcoming[0];
  }
  return null;
}

/** Same bookkeeping as the manual "Run scout" job, so the run shows up in Automations too. */
export async function runScheduledScout(): Promise<void> {
  const db = getDb();
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  if (db.prepare("SELECT 1 FROM job_runs WHERE job = 'run-scout' AND status = 'running' AND started_at > ?").get(since)) return;
  const id = newId();
  db.prepare("INSERT INTO job_runs (id, job, status, started_at) VALUES (?, 'run-scout', 'running', ?)").run(id, nowIso());
  try {
    const r = await runScout();
    db.prepare("UPDATE job_runs SET status = 'ok', detail = ?, finished_at = ? WHERE id = ?")
      .run(`Scheduled: found ${r.found}, added ${r.added} new${r.skipped ? `, ${r.skipped} unusable` : ""}. ${r.notes}`.slice(0, 300), nowIso(), id);
  } catch (e) {
    db.prepare("UPDATE job_runs SET status = 'error', detail = ?, finished_at = ? WHERE id = ?").run(e instanceof Error ? e.message.slice(0, 300) : "failed", nowIso(), id);
  }
}

/** Claims the due slot first (atomic, so a second server on the same data never double-runs), then runs. */
export function tick(now = new Date()): Promise<void> | null {
  const key = dueSlot(getSchedule(), now);
  if (!key) return null;
  const claimed = getDb().prepare("UPDATE scout_schedule SET last_fired = ? WHERE id = 1 AND (last_fired IS NULL OR last_fired < ?)").run(key, key).changes;
  return claimed ? runScheduledScout() : null;
}

/** Called once when the server starts. Checks every 30 seconds; does nothing unless the schedule is enabled. */
export function startScoutScheduler(): void {
  const g = globalThis as { __sbosScoutTimer?: ReturnType<typeof setInterval> };
  if (g.__sbosScoutTimer) return;
  g.__sbosScoutTimer = setInterval(() => {
    try {
      tick()?.catch((e) => log("error", "scout.schedule.failed", { message: e instanceof Error ? e.message : String(e) }));
    } catch (e) {
      log("error", "scout.schedule.failed", { message: e instanceof Error ? e.message : String(e) });
    }
  }, 30_000);
  g.__sbosScoutTimer.unref?.();
}
