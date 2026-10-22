import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dueSlot, getSchedule, nextRun, saveSchedule, ScheduleInput, type Schedule } from "../src/lib/scout-schedule.ts";
import { cleanup, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

// Thursday 22 Oct 2026, local time
const at = (h: number, m: number) => new Date(2026, 9, 22, h, m, 0);
const sched = (over: Partial<Schedule> = {}): Schedule => ({ enabled: true, times: ["12:00"], days: [0, 1, 2, 3, 4, 5, 6], last_fired: null, ...over });

describe("scout schedule", () => {
  it("is off by default and saves sorted, de-duplicated times", () => {
    expect(getSchedule().enabled).toBe(false);
    const s = saveSchedule({ enabled: true, times: ["15:00", "12:00", "12:00"], days: [5, 1, 1] });
    expect(s).toMatchObject({ enabled: true, times: ["12:00", "15:00"], days: [1, 5] });
  });
  it("validates times and days", () => {
    expect(ScheduleInput.safeParse({ enabled: true, times: ["25:00"], days: [1] }).success).toBe(false);
    expect(ScheduleInput.safeParse({ enabled: true, times: [], days: [1] }).success).toBe(false);
    expect(ScheduleInput.safeParse({ enabled: true, times: ["12:00"], days: [7] }).success).toBe(false);
  });
  it("is due from the slot until 15 minutes later, once", () => {
    expect(dueSlot(sched(), at(11, 59))).toBeNull();
    expect(dueSlot(sched(), at(12, 0))).toBe("2026-10-22 12:00");
    expect(dueSlot(sched(), at(12, 14))).toBe("2026-10-22 12:00");
    expect(dueSlot(sched(), at(12, 15))).toBeNull();
    expect(dueSlot(sched({ last_fired: "2026-10-22 12:00" }), at(12, 5))).toBeNull();
  });
  it("respects disabled and day-of-week", () => {
    expect(dueSlot(sched({ enabled: false }), at(12, 1))).toBeNull();
    expect(dueSlot(sched({ days: [1, 2] }), at(12, 1))).toBeNull(); // Thursday is 4
  });
  it("does not rerun an earlier slot after a later one fired", () => {
    const s = sched({ times: ["12:00", "12:10"], last_fired: "2026-10-22 12:10" });
    expect(dueSlot(s, at(12, 12))).toBeNull();
  });
  it("finds the next run", () => {
    expect(nextRun(sched({ times: ["12:00", "15:00"] }), at(13, 0))).toEqual(at(15, 0));
    expect(nextRun(sched({ times: ["12:00"], days: [5] }), at(13, 0))).toEqual(new Date(2026, 9, 23, 12, 0));
    expect(nextRun(sched({ enabled: false }), at(13, 0))).toBeNull();
  });
});
