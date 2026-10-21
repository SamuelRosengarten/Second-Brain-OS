import { addDays, shortMonthDay } from "@/lib/dates";

/** A planned day is "full" at this many minutes: the load bar reaches 100% and turns amber near it. */
export const DAY_CAPACITY_MIN = 6 * 60;

/** 315 -> "5h15", 120 -> "2h", 30 -> "30m", 0 -> "0h". */
export function fmtHours(min: number): string {
  if (min <= 0) return "0h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Load as 0..100 for the little bar under a day. */
export const loadPct = (min: number): number => Math.max(0, Math.min(100, Math.round((min / DAY_CAPACITY_MIN) * 100)));
export const isHeavy = (min: number): boolean => min >= DAY_CAPACITY_MIN * 0.85;

/** "19 – 25 OCT" (or "26 OCT – 1 NOV" across a month boundary). */
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const [sm, sd] = shortMonthDay(start).split(" ");
  const [em, ed] = shortMonthDay(end).split(" ");
  return sm === em ? `${sd} – ${ed} ${em}`.toUpperCase() : `${sd} ${sm} – ${ed} ${em}`.toUpperCase();
}

/** A short form of a task title for chips ("after: ER diagram"). */
export const shortTitle = (t: string, max = 24): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
