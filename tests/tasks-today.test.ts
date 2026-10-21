import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, isYmd, ymd } from "../src/lib/dates.ts";
import { buildBriefing } from "../src/lib/briefing.ts";
import { createTask, listTasks, updateTask } from "../src/lib/projects.ts";
import { cleanup, freshEnv } from "./helpers.ts";

describe("date helpers", () => {
  it("accepts only real calendar dates", () => {
    expect(isYmd("2026-10-21")).toBe(true);
    expect(isYmd("2026-02-31")).toBe(false);
    expect(isYmd("2026-2-1")).toBe(false);
    expect(isYmd("tomorrow")).toBe(false);
    expect(isYmd(null)).toBe(false);
  });
  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-21", 7)).toBe("2026-10-28");
  });
  it("formats the local calendar date", () => {
    expect(ymd(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("a caller-supplied 'today'", () => {
  let dir: string;
  beforeEach(() => { dir = freshEnv(); });
  afterEach(() => cleanup(dir));

  it("decides overdue / today / soon for tasks and the briefing", () => {
    createTask({ title: "Yesterday", due_date: "2026-10-20" });
    createTask({ title: "Today", due_date: "2026-10-21" });
    createTask({ title: "In a week", due_date: "2026-10-28" });
    createTask({ title: "Later", due_date: "2026-10-29" });
    const titles = (f: Parameters<typeof listTasks>[0]) => listTasks(f).map((t) => t.title);

    const today = "2026-10-21";
    expect(titles({ due: "overdue", today })).toEqual(["Yesterday"]);
    expect(titles({ due: "today", today })).toEqual(["Today"]);
    expect(titles({ due: "soon", today })).toEqual(["Today", "In a week"]);

    // A device that is a day ahead sees the same rows one step later.
    const ahead = "2026-10-22";
    expect(titles({ due: "overdue", today: ahead })).toEqual(["Yesterday", "Today"]);
    expect(titles({ due: "today", today: ahead })).toEqual([]);

    const b = buildBriefing(ahead);
    expect(b.today).toBe(ahead);
    expect(b.counts.overdue).toBe(2);
    expect(b.counts.dueToday).toBe(0);
    expect(b.dueSoon.map((t) => t.title)).toEqual(["In a week", "Later"]);
  });

  it("moves a due date and clears it with PATCH semantics", () => {
    const t = createTask({ title: "Snooze me", due_date: "2026-10-21" });
    expect(updateTask(t.id, { due_date: "2026-10-22" }).due_date).toBe("2026-10-22");
    expect(updateTask(t.id, { due_date: null }).due_date).toBeNull();
    // Editing other fields leaves the date alone.
    updateTask(t.id, { due_date: "2026-10-25" });
    const edited = updateTask(t.id, { title: "Renamed", priority: "high", description: "why" });
    expect(edited).toMatchObject({ title: "Renamed", priority: "high", description: "why", due_date: "2026-10-25" });
  });
});
