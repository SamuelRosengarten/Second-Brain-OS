import { describe, expect, it } from "vitest";
import { DAY_LIMIT_MIN, LIMIT_PCT, fmtHours, loadSegments, overBy, suggestRebalance } from "../src/components/plan/plan-utils.ts";

const task = (id: string, due: string | null, min: number | null, status = "todo") => ({ id, title: `Task ${id}`, due_date: due, status, estimate_min: min });
const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

describe("daily limit", () => {
  it("is five hours, drawn at 80% of the bar", () => {
    expect(DAY_LIMIT_MIN).toBe(300);
    expect(LIMIT_PCT).toBe(80);
    expect(overBy(315)).toBe(15);
    expect(overBy(120)).toBe(0);
    expect(fmtHours(315)).toBe("5h15");
  });

  it("folds everything past the limit into one hatched piece", () => {
    const segs = loadSegments([{ min: 120, color: "a", done: false }, { min: 180, color: "b", done: true }, { min: 20, color: "c", done: false }]);
    expect(segs.map((s) => [s.color, s.over, s.faded])).toEqual([["a", false, false], ["b", false, true], ["var(--warn)", true, false]]);
    expect(segs[2].w).toBeCloseTo((20 / 375) * 100);
  });

  it("splits a task that straddles the limit", () => {
    const segs = loadSegments([{ min: 240, color: "a", done: false }, { min: 120, color: "b", done: false }]);
    expect(segs).toHaveLength(3);
    expect(segs[1].w).toBeCloseTo((60 / 375) * 100);
    expect(segs[2].over).toBe(true);
  });
});

describe("suggestRebalance", () => {
  const none = () => [] as string[];

  it("moves the smallest task that clears the overage to the freest later day", () => {
    const tasks = [task("a", "2026-10-23", 120), task("b", "2026-10-23", 180), task("c", "2026-10-23", 20), task("d", "2026-10-24", 120), task("e", "2026-10-25", 30)];
    const mv = suggestRebalance(tasks, WEEK, "2026-10-21", none);
    expect(mv).toMatchObject({ taskId: "c", from: "2026-10-23", to: "2026-10-25", over: 20, freeOnTarget: 270 });
  });

  it("leaves a week that fits alone, and days before today", () => {
    expect(suggestRebalance([task("a", "2026-10-19", 400), task("b", "2026-10-22", 60)], WEEK, "2026-10-21", none)).toBeNull();
  });

  it("never moves a task past a day on which something waiting for it is due", () => {
    const tasks = [task("a", "2026-10-23", 200), task("b", "2026-10-23", 120)];
    const dues = (id: string) => (id === "a" ? ["2026-10-24"] : []);
    // b is the smallest task that clears the 20m overage, and nothing waits for it
    expect(suggestRebalance(tasks, WEEK, "2026-10-21", dues)?.taskId).toBe("b");
    const only = [task("a", "2026-10-23", 290), task("f", "2026-10-23", 30, "done")];
    // something waiting on "a" is due Sat 24, so it may not move to Sat or later
    expect(suggestRebalance(only, WEEK, "2026-10-21", () => ["2026-10-24"])).toBeNull();
    // due Sun 25: Sat 24 is still early enough
    expect(suggestRebalance(only, WEEK, "2026-10-21", () => ["2026-10-25"])?.to).toBe("2026-10-24");
  });

  it("skips done tasks, tasks without an estimate and dismissed moves", () => {
    const tasks = [task("a", "2026-10-23", 320, "done"), task("b", "2026-10-23", null), task("c", "2026-10-23", 290)];
    expect(suggestRebalance(tasks, WEEK, "2026-10-21", none)?.taskId).toBe("c");
    expect(suggestRebalance(tasks, WEEK, "2026-10-21", none, (m) => m.taskId === "c")).toBeNull();
  });
});
