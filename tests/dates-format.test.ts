import { describe, expect, it } from "vitest";
import { capitalize, dayOfWeek, dowDay, isoWeek, numberWord, shortMonthDay, weekStart } from "../src/lib/dates.ts";

describe("date helpers for the Today page", () => {
  it("finds the Monday of a week and the day of week", () => {
    expect(weekStart("2026-10-21")).toBe("2026-10-19"); // a Wednesday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week that started Monday
    expect(weekStart("2026-03-01")).toBe("2026-02-23");
    expect(dayOfWeek("2026-10-21")).toBe(3);
  });
  it("computes ISO week numbers", () => {
    expect(isoWeek("2026-10-21")).toBe(43);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53); // 2026 has 53 ISO weeks
    expect(isoWeek("2024-12-30")).toBe(1);
  });
  it("formats short dates and number words", () => {
    expect(dowDay("2026-10-22")).toBe("Thu 22");
    expect(shortMonthDay("2026-10-21")).toBe("Oct 21");
    expect([0, 1, 2, 10, 11].map(numberWord)).toEqual(["no", "one", "two", "ten", "11"]);
    expect(capitalize("two tasks")).toBe("Two tasks");
  });
});
