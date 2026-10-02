import { describe, expect, it } from "vitest";
import { inRange, parseDate, parseDateRange, parseNumberRange } from "./ranges";

const NOW = new Date(2026, 9, 2, 15, 30).getTime();
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date).getTime();

function matches(range: ReturnType<typeof parseNumberRange>, values: number[]): boolean[] {
  return values.map((value) => (range ? inRange(value, range) : false));
}

describe("parseDate", () => {
  it("reads days, months and years as intervals in local time", () => {
    expect(parseDate("2026-03-04", NOW)).toEqual({ start: day(2026, 3, 4), end: day(2026, 3, 5) });
    expect(parseDate("2026-02", NOW)).toEqual({ start: day(2026, 2, 1), end: day(2026, 3, 1) });
    expect(parseDate("2025", NOW)).toEqual({ start: day(2025, 1, 1), end: day(2026, 1, 1) });
  });

  it("honours times and time zones", () => {
    expect(parseDate("2026-03-04T10:00:00Z", NOW)).toEqual({
      start: Date.UTC(2026, 2, 4, 10),
      end: Date.UTC(2026, 2, 4, 10, 0, 1),
    });
    expect(parseDate("2026-03-04T10:00+02:00", NOW)?.start).toBe(Date.UTC(2026, 2, 4, 8));
    expect(parseDate("2026-03-04T10:00-0130", NOW)?.start).toBe(Date.UTC(2026, 2, 4, 11, 30));
  });

  it("resolves @today with day, week, month and year offsets", () => {
    expect(parseDate("@today", NOW)).toEqual({ start: day(2026, 10, 2), end: day(2026, 10, 3) });
    expect(parseDate("@today-7d", NOW)?.start).toBe(day(2026, 9, 25));
    expect(parseDate("@today-2w", NOW)?.start).toBe(day(2026, 9, 18));
    expect(parseDate("@today-1m", NOW)?.start).toBe(day(2026, 9, 2));
    expect(parseDate("@TODAY+1y", NOW)?.start).toBe(day(2027, 10, 2));
  });

  it("rejects impossible or malformed dates", () => {
    for (const text of ["2026-02-30", "2026-13-01", "2026-01-01T24:00", "yesterday", "@today-7", "26-01-01"]) {
      expect(parseDate(text, NOW)).toBeNull();
    }
  });
});

describe("parseDateRange", () => {
  const range = (text: string) => parseDateRange(text, NOW);
  const inside = (text: string, at: number) => {
    const parsed = range(text);
    return parsed ? inRange(at, parsed) : null;
  };

  it("treats a bare date as that whole day", () => {
    expect(inside("2026-03-04", day(2026, 3, 4) + 1)).toBe(true);
    expect(inside("2026-03-04", day(2026, 3, 5))).toBe(false);
  });

  it("applies comparison operators to the day's edges", () => {
    expect(inside(">2026-03-04", day(2026, 3, 4) + 5)).toBe(false);
    expect(inside(">2026-03-04", day(2026, 3, 5))).toBe(true);
    expect(inside(">=2026-03-04", day(2026, 3, 4))).toBe(true);
    expect(inside("<2026-03-04", day(2026, 3, 4))).toBe(false);
    expect(inside("<2026-03-04", day(2026, 3, 4) - 1)).toBe(true);
    expect(inside("<=2026-03-04", day(2026, 3, 4) + 5)).toBe(true);
  });

  it("reads ranges with open ends", () => {
    expect(inside("2026-03-01..2026-03-31", day(2026, 3, 31) + 5)).toBe(true);
    expect(inside("2026-03-01..2026-03-31", day(2026, 4, 1))).toBe(false);
    expect(inside("2026-03-01..*", day(2030, 1, 1))).toBe(true);
    expect(inside("*..2026-03-01", day(2020, 1, 1))).toBe(true);
  });

  it("rejects backwards, empty and malformed ranges", () => {
    for (const text of ["2026-03-31..2026-03-01", "*..*", "a..b", "2026..2027..2028", ">", ">=x"]) {
      expect(range(text)).toBeNull();
    }
  });
});

describe("parseNumberRange", () => {
  it("compares numbers inclusively where GitHub does", () => {
    expect(matches(parseNumberRange("5"), [4, 5, 6])).toEqual([false, true, false]);
    expect(matches(parseNumberRange(">5"), [5, 6])).toEqual([false, true]);
    expect(matches(parseNumberRange(">=5"), [4, 5])).toEqual([false, true]);
    expect(matches(parseNumberRange("<5"), [4, 5])).toEqual([true, false]);
    expect(matches(parseNumberRange("<=5"), [5, 6])).toEqual([true, false]);
    expect(matches(parseNumberRange("2..4"), [1, 2, 4, 5])).toEqual([false, true, true, false]);
    expect(matches(parseNumberRange("-1.5..*"), [-2, -1.5, 100])).toEqual([false, true, true]);
  });

  it("rejects non-numbers", () => {
    expect(parseNumberRange("five")).toBeNull();
    expect(parseNumberRange("4..2")).toBeNull();
  });
});
