/** Pure YYYY-MM-DD helpers shared by the server and the browser (no Node imports). */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-31). */
export function isYmd(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = YMD.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** Local calendar date of `d` (the clock of whichever machine runs this). */
export function ymd(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Calendar-day arithmetic on a YYYY-MM-DD string; unaffected by DST. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const parts = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1, day: Number(d.slice(8, 10)) });

/** Day of the week of a YYYY-MM-DD date: 0 = Sunday. */
export const dayOfWeek = (d: string): number => { const p = parts(d); return new Date(p.y, p.m, p.day).getDay(); };
/** The Monday on or before `d`. */
export const weekStart = (d: string): string => addDays(d, -((dayOfWeek(d) + 6) % 7));
export const shortDow = (d: string): string => DOW3[dayOfWeek(d)];
export const fullDow = (d: string): string => DOW_FULL[dayOfWeek(d)];
/** "Oct 21". */
export const shortMonthDay = (d: string): string => `${MON3[parts(d).m]} ${parts(d).day}`;
/** "Thu 22". */
export const dowDay = (d: string): string => `${DOW3[dayOfWeek(d)]} ${parts(d).day}`;

/** ISO 8601 week number (weeks start on Monday; week 1 contains the first Thursday). */
export function isoWeek(d: string): number {
  const p = parts(d);
  const date = new Date(Date.UTC(p.y, p.m, p.day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** Small numbers as words for sentences ("two tasks"), larger ones as digits. */
export const numberWord = (n: number): string => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
