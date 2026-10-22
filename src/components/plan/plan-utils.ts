import { addDays, shortMonthDay } from "@/lib/dates";

/** A planned day is full at this many minutes. Anything beyond it shows as "over". */
export const DAY_LIMIT_MIN = 5 * 60;
/** The load bar spans 125% of the limit, so the limit marker sits at 80% and there is room to show what is over. */
export const LOAD_SCALE_MIN = 375;
export const LIMIT_PCT = (DAY_LIMIT_MIN / LOAD_SCALE_MIN) * 100;

/** 315 -> "5h15", 120 -> "2h", 30 -> "30m", 0 -> "0h". */
export function fmtHours(min: number): string {
  if (min <= 0) return "0h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Minutes beyond the daily limit (0 when the day fits). */
export const overBy = (min: number): number => Math.max(0, min - DAY_LIMIT_MIN);

export interface LoadSegment { w: number; color: string; faded: boolean; over: boolean }

/**
 * The coloured pieces of a day's load bar, one per task, in order. The part of the day beyond the limit is
 * folded into a single trailing "over" piece, drawn hatched. Widths are percentages of the bar.
 */
export function loadSegments(items: { min: number; color: string; done: boolean }[]): LoadSegment[] {
  const segs: LoadSegment[] = [];
  let used = 0;
  let over = 0;
  for (const it of items) {
    const inside = Math.max(0, Math.min(it.min, DAY_LIMIT_MIN - used));
    if (inside > 0) segs.push({ w: (inside / LOAD_SCALE_MIN) * 100, color: it.color, faded: it.done, over: false });
    over += it.min - inside;
    used += it.min;
  }
  if (over > 0) segs.push({ w: (Math.min(over, LOAD_SCALE_MIN - DAY_LIMIT_MIN) / LOAD_SCALE_MIN) * 100, color: "var(--warn)", faded: false, over: true });
  return segs;
}

export interface RebalanceMove { taskId: string; title: string; from: string; to: string; over: number; freeOnTarget: number }

/**
 * When a day from today on is over the limit, propose moving one open task to a later day that has room for it.
 * Picks the smallest task that clears the overage (else the largest), and the day with the most free time.
 * A task is never pushed past a day on which something waiting for it is due.
 */
export function suggestRebalance(
  tasks: { id: string; title: string; due_date: string | null; status: string; estimate_min?: number | null }[],
  days: string[],
  today: string,
  dependentDues: (id: string) => string[],
  skip: (move: { taskId: string; to: string }) => boolean = () => false,
): RebalanceMove | null {
  const load = new Map(days.map((d) => [d, tasks.filter((t) => t.due_date === d).reduce((n, t) => n + (t.estimate_min ?? 0), 0)]));
  for (const from of days) {
    if (from < today) continue;
    const over = overBy(load.get(from) ?? 0);
    if (over === 0) continue;
    const open = tasks.filter((t) => t.due_date === from && t.status !== "done" && (t.estimate_min ?? 0) > 0);
    const fits = open.filter((t) => t.estimate_min! >= over).sort((a, b) => a.estimate_min! - b.estimate_min!);
    const ordered = fits.length > 0 ? fits : [...open].sort((a, b) => b.estimate_min! - a.estimate_min!);
    for (const t of ordered) {
      const targets = days
        .filter((d) => d > from && DAY_LIMIT_MIN - (load.get(d) ?? 0) >= t.estimate_min! && dependentDues(t.id).every((due) => due > d) && !skip({ taskId: t.id, to: d }))
        .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || (a < b ? -1 : 1));
      if (targets.length > 0) return { taskId: t.id, title: t.title, from, to: targets[0], over, freeOnTarget: DAY_LIMIT_MIN - (load.get(targets[0]) ?? 0) };
    }
  }
  return null;
}

/** "19 – 25 OCT" (or "26 OCT – 1 NOV" across a month boundary). */
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const [sm, sd] = shortMonthDay(start).split(" ");
  const [em, ed] = shortMonthDay(end).split(" ");
  return sm === em ? `${sd} – ${ed} ${em}`.toUpperCase() : `${sd} ${sm} – ${ed} ${em}`.toUpperCase();
}

/** A short form of a task title for chips ("after: ER diagram"). */
export const shortTitle = (t: string, max = 24): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
